import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import protobuf from "protobufjs";
import { useSeiData } from "@/hooks/useSeiData";
import type { VideoMoment, VideoSequence } from "@/types/video";
import { concat, makeMp4, nal, seiNal } from "@/lib/__tests__/helpers/mp4-fixture";

const PROTO_PATH = resolve(__dirname, "../../../public/dashcam.proto");
const PROTO_TEXT = readFileSync(PROTO_PATH, "utf-8");

/** The same lookup the hook performs, used to encode fixtures. */
const SeiMetadata = protobuf
  .parse(PROTO_TEXT, { keepCase: true })
  .root.lookupType("SeiMetadata");

/** Encode a SeiMetadata message exactly as Tesla would embed it. */
function encodeSei(fields: Record<string, unknown>): Uint8Array {
  return SeiMetadata.encode(SeiMetadata.create(fields)).finish();
}

function makeFile(bytes: ArrayBuffer | Uint8Array, name = "clip.mp4"): File {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Copy into a freshly allocated ArrayBuffer: protobufjs hands back a
  // Uint8Array<ArrayBufferLike>, which is not assignable to BlobPart.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new File([copy.buffer], name, { type: "video/mp4" });
}

function makeMoment(
  file: File,
  index: number,
  duration = 60,
): VideoMoment {
  const date = "2026-01-15";
  const time = `10:${String(30 + index).padStart(2, "0")}:00`;
  return {
    id: `${date}_${time.replace(/:/g, "-")}_${index}`,
    timestamp: new Date(2026, 0, 15, 10, 30 + index, 0),
    date,
    time,
    dateTime: `${date} ${time}`,
    videos: [
      {
        file,
        angle: "front",
        angleLabel: "Front",
        duration,
        durationFormatted: "1:00",
        size: "1.0 MB",
      },
    ],
    duration,
  };
}

function makeSequence(moments: VideoMoment[]): VideoSequence {
  let offset = 0;
  const momentOffsets = moments.map((m) => {
    const current = offset;
    offset += m.duration;
    return current;
  });

  return {
    id: "seq-1",
    moments,
    startTime: moments[0].timestamp,
    endTime: new Date(moments[0].timestamp.getTime() + offset * 1000),
    totalDuration: offset,
    clipCount: moments.length,
    dateRange: "2026-01-15",
    timeRange: "10:30:00 - 10:31:00",
    durationFormatted: "1:00",
    momentOffsets,
  };
}

/** An MP4 whose mdat holds a single SEI message with the given fields. */
function makeMp4WithSei(fields: Record<string, unknown>): ArrayBuffer {
  const payload = encodeSei(fields);
  return makeMp4({
    mdatPayload: concat([
      nal(0x05, [new Uint8Array([0x88, 0x84])]), // IDR frame
      seiNal(payload),
    ]),
  });
}

describe("useSeiData", () => {
  beforeEach(() => {
    // The hook fetches the schema from /dashcam.proto on first use.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PROTO_TEXT, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes a SEI message and exposes the telemetry", async () => {
    const file = makeFile(
      makeMp4WithSei({
        version: 1,
        vehicle_speed_mps: 12.5,
        steering_wheel_angle: -3.25,
        brake_applied: true,
        latitude_deg: 45.4642,
        longitude_deg: 9.19,
      }),
    );
    const sequence = makeSequence([makeMoment(file, 0)]);

    const { result } = renderHook(() => useSeiData(sequence, 0, 0));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.allSeiMessages).toHaveLength(1);

    const sei = result.current.allSeiMessages[0].sei;
    expect(sei.vehicle_speed_mps).toBeCloseTo(12.5, 3);
    expect(sei.steering_wheel_angle).toBeCloseTo(-3.25, 3);
    expect(sei.brake_applied).toBe(true);
    expect(sei.latitude_deg).toBeCloseTo(45.4642, 4);
    expect(result.current.seiData?.vehicle_speed_mps).toBeCloseTo(12.5, 3);
  });

  it("reports the frame rate derived from the MP4 sample durations", async () => {
    const file = makeFile(makeMp4WithSei({ version: 1 }));
    const sequence = makeSequence([makeMoment(file, 0)]);

    const { result } = renderHook(() => useSeiData(sequence, 0, 0));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // 33ms per frame at a 1000 timescale -> ~30.3 fps
    expect(result.current.fps).toBeCloseTo(30.3, 1);
  });

  it("merges SEI messages across every moment in the sequence", async () => {
    const first = makeFile(
      makeMp4WithSei({ version: 1, vehicle_speed_mps: 10 }),
      "first.mp4",
    );
    const second = makeFile(
      makeMp4WithSei({ version: 1, vehicle_speed_mps: 20 }),
      "second.mp4",
    );
    const sequence = makeSequence([
      makeMoment(first, 0),
      makeMoment(second, 1),
    ]);

    const { result } = renderHook(() => useSeiData(sequence, 0, 0));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.allSeiMessages).toHaveLength(2);
    expect(result.current.allSeiMessages[0].sei.vehicle_speed_mps).toBeCloseTo(10, 3);
    expect(result.current.allSeiMessages[1].sei.vehicle_speed_mps).toBeCloseTo(20, 3);
  });

  it("offsets the second moment's frame index by the first moment's length", async () => {
    const first = makeFile(makeMp4WithSei({ version: 1 }), "first.mp4");
    const second = makeFile(makeMp4WithSei({ version: 1 }), "second.mp4");
    const sequence = makeSequence([
      makeMoment(first, 0, 60),
      makeMoment(second, 1, 60),
    ]);

    const { result } = renderHook(() => useSeiData(sequence, 0, 0));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const [first_, second_] = result.current.allSeiMessages;
    // The first SEI sits after one IDR frame, so its index is 1.
    expect(first_.frameIndex).toBe(1);
    // The second moment starts 60 seconds later, at ~30.3 fps.
    const offset = Math.round(60 * result.current.fps);
    expect(second_.frameIndex).toBe(offset + 1);
  });

  it("surfaces an error when the schema cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const file = makeFile(makeMp4WithSei({ version: 1 }));
    const sequence = makeSequence([makeMoment(file, 0)]);

    const { result } = renderHook(() => useSeiData(sequence, 0, 0));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.allSeiMessages).toHaveLength(0);
  });

  it("does nothing for a null sequence", async () => {
    const { result } = renderHook(() => useSeiData(null, 0, 0));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.seiData).toBeNull();
    expect(result.current.allSeiMessages).toHaveLength(0);
  });

  it("does not crash on a file that is not a valid MP4", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const file = makeFile(garbage, "garbage.mp4");
    const sequence = makeSequence([makeMoment(file, 0)]);

    const { result } = renderHook(() => useSeiData(sequence, 0, 0));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // A broken clip is logged and skipped; it must not take down the hook.
    expect(result.current.allSeiMessages).toHaveLength(0);
  });
});
