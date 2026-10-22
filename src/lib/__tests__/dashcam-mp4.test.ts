import { describe, expect, it, vi } from "vitest";
import { DashcamMP4 } from "@/lib/dashcam-mp4";
import type { SeiData, SeiMetadataType } from "@/lib/dashcam-mp4";
import { concat, makeMp4, nal, seiNal, u32 } from "./helpers/mp4-fixture";

/** A decoder that reports the payload it was handed. */
function fakeDecoder(): SeiMetadataType & { calls: number } {
  return {
    calls: 0,
    decode(data: Uint8Array): SeiData {
      this.calls++;
      return { version: data.length, vehicle_speed_mps: data[0] };
    },
  };
}

describe("DashcamMP4 box navigation", () => {
  it("finds a box by name", () => {
    const mp4 = new DashcamMP4(makeMp4());
    const moov = mp4.findBox(0, new Uint8Array(makeMp4()).byteLength, "moov");

    expect(moov.size).toBeGreaterThan(0);
    expect(moov.end).toBeGreaterThan(moov.start);
  });

  it("throws a descriptive error when a box is missing", () => {
    const mp4 = new DashcamMP4(makeMp4());

    expect(() => mp4.findBox(0, 100, "nope")).toThrow('Box "nope" not found');
  });

  it("locates the mdat payload", () => {
    const mp4 = new DashcamMP4(makeMp4({ mdatPayload: new Uint8Array([1, 2, 3, 4]) }));
    const mdat = mp4.findMdat();

    expect(mdat.size).toBe(4);
  });
});

describe("DashcamMP4 video configuration", () => {
  it("reads dimensions, codec, timescale and frame durations", () => {
    const mp4 = new DashcamMP4(
      makeMp4({ width: 1920, height: 1080, timescale: 1000, sampleCount: 3, sampleDelta: 33 }),
    );
    const config = mp4.getConfig();

    expect(config.width).toBe(1920);
    expect(config.height).toBe(1080);
    expect(config.codec).toBe("avc1.640028");
    expect(config.timescale).toBe(1000);
    expect(config.durations).toHaveLength(3);
    expect(config.durations[0]).toBeCloseTo(33);
  });

  it("extracts the SPS and PPS", () => {
    const mp4 = new DashcamMP4(makeMp4());
    const config = mp4.getConfig();

    expect(config.sps).toEqual(new Uint8Array([0x67, 0x64, 0x00, 0x28]));
    expect(config.pps).toEqual(new Uint8Array([0x68, 0xee, 0x3c, 0x80]));
  });

  it("caches the config after the first read", () => {
    const mp4 = new DashcamMP4(makeMp4());

    expect(mp4.getConfig()).toBe(mp4.getConfig());
  });

  it("derives the frame rate from the sample durations", () => {
    const mp4 = new DashcamMP4(makeMp4({ sampleCount: 3, sampleDelta: 33, timescale: 1000 }));

    // 33ms per frame -> ~30.3 fps
    expect(mp4.getFps()).toBeCloseTo(30.3, 1);
  });

  it("falls back to 30 fps when there are no durations", () => {
    const mp4 = new DashcamMP4(makeMp4({ sampleCount: 0 }));
    const config = mp4.getConfig();
    config.durations.length = 0;

    expect(mp4.getFps()).toBe(30);
  });

  it("throws when the moov box is missing", () => {
    const mp4 = new DashcamMP4(new Uint8Array(64).buffer);

    expect(() => mp4.getConfig()).toThrow('Box "moov" not found');
  });
});

describe("DashcamMP4 SEI extraction", () => {
  it("extracts SEI messages and their frame indices", () => {
    const mdatPayload = concat([
      nal(0x05, [new Uint8Array([0x88, 0x84])]), // IDR frame -> frameIndex 1
      seiNal(new Uint8Array([0x0a])),
      nal(0x01, [new Uint8Array([0x41])]), // non-IDR frame -> frameIndex 2
      seiNal(new Uint8Array([0x14])),
    ]);

    const mp4 = new DashcamMP4(makeMp4({ mdatPayload }));
    const decoder = fakeDecoder();
    const messages = mp4.extractSeiMessagesWithFrameIndex(decoder);

    expect(messages).toHaveLength(2);
    expect(messages[0].frameIndex).toBe(1);
    expect(messages[0].sei.vehicle_speed_mps).toBe(0x0a);
    expect(messages[1].frameIndex).toBe(2);
    expect(messages[1].sei.vehicle_speed_mps).toBe(0x14);
  });

  it("strips the trailing byte and the 0x42 padding before decoding", () => {
    const mdatPayload = seiNal(new Uint8Array([0x01, 0x02, 0x03]));
    const mp4 = new DashcamMP4(makeMp4({ mdatPayload }));

    const decoder: SeiMetadataType = {
      decode: vi.fn(() => ({})),
    };
    mp4.extractSeiMessagesWithFrameIndex(decoder);

    const decoded = vi.mocked(decoder.decode).mock.calls[0][0];
    // The protobuf payload is 3 bytes; the trailing 0x80 and the 0x42 padding
    // must not reach the decoder.
    expect(Array.from(decoded)).toEqual([0x01, 0x02, 0x03]);
  });

  it("ignores SEI NAL units with a payload type other than 5", () => {
    // Payload type 1 (pic_timing) rather than 5 (user_data_unregistered).
    const body = concat([
      new Uint8Array([0x06, 0x01, 0xff]),
      new Uint8Array([0x42, 0x42]),
      new Uint8Array([0x69, 0x01, 0x80]),
    ]);
    const mdatPayload = concat([u32(body.length), body]);

    const mp4 = new DashcamMP4(makeMp4({ mdatPayload }));
    const messages = mp4.extractSeiMessagesWithFrameIndex(fakeDecoder());

    expect(messages).toHaveLength(0);
  });

  it("ignores NAL units that are not SEI", () => {
    const mdatPayload = nal(0x01, [new Uint8Array([0x41, 0x11, 0x22])]);
    const mp4 = new DashcamMP4(makeMp4({ mdatPayload }));

    const messages = mp4.extractSeiMessagesWithFrameIndex(fakeDecoder());

    expect(messages).toHaveLength(0);
  });

  it("resyncs past a zero-length NAL prefix", () => {
    // A NAL length of 0 is invalid, but the parser advances past the 4-byte
    // length prefix and tries the next one, so the following SEI still decodes.
    const mdatPayload = concat([u32(0), seiNal(new Uint8Array([0x07]))]);

    const mp4 = new DashcamMP4(makeMp4({ mdatPayload }));
    const messages = mp4.extractSeiMessagesWithFrameIndex(fakeDecoder());

    expect(messages).toHaveLength(1);
    expect(messages[0].sei.vehicle_speed_mps).toBe(0x07);
  });

  it("stops the scan when a NAL length runs past the end of the buffer", () => {
    // An oversized length makes the parser skip `nalSize` bytes forward, which
    // jumps past the rest of the mdat - the remaining SEI is not recovered.
    // Worth pinning down: a corrupt length silently truncates the scan.
    const mdatPayload = concat([u32(0x7fffffff), seiNal(new Uint8Array([0x07]))]);

    const mp4 = new DashcamMP4(makeMp4({ mdatPayload }));
    const messages = mp4.extractSeiMessagesWithFrameIndex(fakeDecoder());

    expect(messages).toHaveLength(0);
  });

  it("keeps the SEI messages decoded before a malformed length", () => {
    const mdatPayload = concat([
      seiNal(new Uint8Array([0x07])),
      u32(0x7fffffff), // runs past the end of the buffer
    ]);

    const mp4 = new DashcamMP4(makeMp4({ mdatPayload }));
    const messages = mp4.extractSeiMessagesWithFrameIndex(fakeDecoder());

    expect(messages).toHaveLength(1);
    expect(messages[0].sei.vehicle_speed_mps).toBe(0x07);
  });

  it("returns an empty array for an empty mdat", () => {
    const mp4 = new DashcamMP4(makeMp4({ mdatPayload: new Uint8Array(0) }));

    expect(mp4.extractSeiMessagesWithFrameIndex(fakeDecoder())).toEqual([]);
  });
});

describe("DashcamMP4.decodeSei", () => {
  it("returns null for a NAL that is too short", () => {
    const mp4 = new DashcamMP4(makeMp4());

    expect(mp4.decodeSei(new Uint8Array([0x06, 0x05]), fakeDecoder())).toBeNull();
  });

  it("returns null when the 0x69 marker is missing", () => {
    const mp4 = new DashcamMP4(makeMp4());
    const nalWithoutMarker = new Uint8Array([0x06, 0x05, 0xff, 0x42, 0x42, 0x01, 0x02, 0x80]);

    expect(mp4.decodeSei(nalWithoutMarker, fakeDecoder())).toBeNull();
  });

  it("returns null when there is no 0x42 padding before the marker", () => {
    const mp4 = new DashcamMP4(makeMp4());
    // The parser requires at least one 0x42 byte before the 0x69 marker.
    const noPadding = new Uint8Array([0x06, 0x05, 0xff, 0x69, 0x01, 0x02, 0x80]);

    expect(mp4.decodeSei(noPadding, fakeDecoder())).toBeNull();
  });

  it("returns null when the decoder throws", () => {
    const mp4 = new DashcamMP4(makeMp4());
    const throwing: SeiMetadataType = {
      decode: () => {
        throw new Error("bad protobuf");
      },
    };
    const nal = new Uint8Array([0x06, 0x05, 0xff, 0x42, 0x69, 0x01, 0x02, 0x80]);

    expect(mp4.decodeSei(nal, throwing)).toBeNull();
  });
});

describe("DashcamMP4.stripEmulationBytes", () => {
  it("removes the 0x03 escape byte after two zero bytes", () => {
    const mp4 = new DashcamMP4(makeMp4());

    expect(
      Array.from(mp4.stripEmulationBytes(new Uint8Array([0x00, 0x00, 0x03, 0x01]))),
    ).toEqual([0x00, 0x00, 0x01]);
  });

  it("keeps a 0x03 that is not preceded by two zero bytes", () => {
    const mp4 = new DashcamMP4(makeMp4());

    expect(
      Array.from(mp4.stripEmulationBytes(new Uint8Array([0x00, 0x01, 0x03, 0x02]))),
    ).toEqual([0x00, 0x01, 0x03, 0x02]);
  });

  it("removes the escape byte after three zero bytes as well", () => {
    const mp4 = new DashcamMP4(makeMp4());

    expect(
      Array.from(mp4.stripEmulationBytes(new Uint8Array([0x00, 0x00, 0x00, 0x03, 0x05]))),
    ).toEqual([0x00, 0x00, 0x00, 0x05]);
  });

  it("leaves data without escape bytes untouched", () => {
    const mp4 = new DashcamMP4(makeMp4());
    const data = new Uint8Array([0x10, 0x20, 0x30]);

    expect(Array.from(mp4.stripEmulationBytes(data))).toEqual([0x10, 0x20, 0x30]);
  });
});
