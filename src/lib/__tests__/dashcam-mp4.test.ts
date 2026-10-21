import { describe, expect, it, vi } from "vitest";
import { DashcamMP4 } from "@/lib/dashcam-mp4";
import type { SeiData, SeiMetadataType } from "@/lib/dashcam-mp4";

/**
 * Synthetic MP4 builder.
 *
 * The parser walks real box structures, so the fixtures have to be real box
 * structures. The offsets the parser relies on are:
 *
 *   stsd  -> +8  (version/flags + entry count) then the avc1 box
 *   avc1  -> +24 width, +26 height, +78 first child box
 *   avcC  -> +1/+2/+3 profile/compat/level, +6 SPS length, then SPS, PPS
 *   mdhd  -> +0 version, +12 timescale (version 0)
 *   stts  -> +4 entry count, +8 first entry
 */

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Build an ISO BMFF box: 4-byte size + 4-byte type + payload. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

/** mdhd with version 0 and the given timescale. */
function makeMdhd(timescale: number): Uint8Array {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint32(4, 0); // creation_time
  view.setUint32(8, 0); // modification_time
  view.setUint32(12, timescale); // timescale
  view.setUint32(16, 1000); // duration
  return box("mdhd", payload);
}

/** stts with a single run of `count` samples each lasting `delta` ticks. */
function makeStts(count: number, delta: number): Uint8Array {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  view.setUint32(4, 1); // entry_count
  view.setUint32(8, count); // sample_count
  view.setUint32(12, delta); // sample_delta
  return box("stts", payload);
}

/** avcC carrying one SPS and one PPS. */
function makeAvcC(profile = 0x64, compat = 0x00, level = 0x28): Uint8Array {
  const sps = new Uint8Array([0x67, 0x64, 0x00, 0x28]);
  const pps = new Uint8Array([0x68, 0xee, 0x3c, 0x80]);
  const payload = concat([
    new Uint8Array([
      0x01, // configurationVersion
      profile,
      compat,
      level,
      0xff, // lengthSizeMinusOne
      0xe1, // numOfSequenceParameterSets
    ]),
    u16(sps.length),
    sps,
    new Uint8Array([0x01]), // numOfPictureParameterSets
    u16(pps.length),
    pps,
  ]);
  return box("avcC", payload);
}

/** avc1 sample entry: 78 bytes of VisualSampleEntry, then the child boxes. */
function makeAvc1(width: number, height: number, avcC: Uint8Array): Uint8Array {
  const visual = new Uint8Array(78);
  const view = new DataView(visual.buffer);
  view.setUint16(2, 1); // data_reference_index
  view.setUint16(24, width); // width
  view.setUint16(26, height); // height
  return box("avc1", visual, avcC);
}

function makeStsd(avc1: Uint8Array): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(4, 1); // entry_count
  return box("stsd", payload, avc1);
}

interface Mp4Options {
  width?: number;
  height?: number;
  timescale?: number;
  sampleCount?: number;
  sampleDelta?: number;
  mdatPayload?: Uint8Array;
  profile?: number;
  compat?: number;
  level?: number;
}

/** Build a complete, minimal but structurally valid MP4. */
function makeMp4(options: Mp4Options = {}): ArrayBuffer {
  const {
    width = 1920,
    height = 1080,
    timescale = 1000,
    sampleCount = 3,
    sampleDelta = 33,
    mdatPayload = new Uint8Array(0),
    profile = 0x64,
    compat = 0x00,
    level = 0x28,
  } = options;

  const avcC = makeAvcC(profile, compat, level);
  const avc1 = makeAvc1(width, height, avcC);
  const stsd = makeStsd(avc1);
  const stts = makeStts(sampleCount, sampleDelta);
  const stbl = box("stbl", stsd, stts);
  const minf = box("minf", stbl);
  const mdhd = makeMdhd(timescale);
  const mdia = box("mdia", mdhd, minf);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);
  const mdat = box("mdat", mdatPayload);
  const ftyp = box("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d]));

  return concat([ftyp, moov, mdat]).buffer as ArrayBuffer;
}

/** Build a length-prefixed NAL unit. */
function nal(type: number, payload: Uint8Array[]): Uint8Array {
  const body = concat([new Uint8Array([type & 0x1f]), ...payload]);
  return concat([u32(body.length), body]);
}

/**
 * A Tesla SEI NAL unit:
 *   [0] 0x06 nal type (SEI)
 *   [1] 0x05 payload type (user_data_unregistered)
 *   [2] 0xff payload size
 *   [3..] 0x42 padding
 *   then 0x69 marker
 *   then the protobuf payload
 *   then one trailing byte
 */
function seiNal(protobufPayload: Uint8Array, padding = 2): Uint8Array {
  const paddingBytes = new Uint8Array(padding).fill(0x42);
  const body = concat([
    new Uint8Array([0x06, 0x05, 0xff]),
    paddingBytes,
    new Uint8Array([0x69]),
    protobufPayload,
    new Uint8Array([0x80]), // trailing byte, stripped by the parser
  ]);
  return concat([u32(body.length), body]);
}

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
