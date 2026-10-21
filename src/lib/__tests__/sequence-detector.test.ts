import { describe, expect, it } from "vitest";
import {
  detectSequences,
  findMomentForTime,
  toAbsoluteTime,
} from "@/lib/sequence-detector";
import type { CameraVideo, TeslaEvent, VideoMoment } from "@/types/video";

/**
 * Build a VideoMoment fixture.
 *
 * Timestamps are constructed in *local* time (`new Date(y, m, d, h, min, s)`)
 * so the assertions on the human-readable `time` / `timeRange` strings are
 * stable regardless of the timezone the suite runs in.
 */
function makeMoment(
  date: string,
  time: string,
  duration = 60,
): VideoMoment {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const timestamp = new Date(year, month - 1, day, hour, minute, second);

  const video: CameraVideo = {
    file: new File([], `${date}_${time.replace(/:/g, "-")}-front.mp4`),
    angle: "front",
    angleLabel: "Front",
    duration,
    durationFormatted: "1:00",
    size: "1.0 MB",
  };

  return {
    id: `${date}_${time.replace(/:/g, "-")}`,
    timestamp,
    date,
    time,
    dateTime: `${date} ${time}`,
    videos: [video],
    duration,
  };
}

const DATE = "2026-01-15";

/** Clip 1 at 10:30:00, clip 2 at 10:31:00, clip 3 at 10:32:00 - contiguous. */
function threeConsecutiveMoments(): VideoMoment[] {
  return [
    makeMoment(DATE, "10:30:00"),
    makeMoment(DATE, "10:31:00"),
    makeMoment(DATE, "10:32:00"),
  ];
}

describe("detectSequences", () => {
  it("returns an empty array for no moments", () => {
    expect(detectSequences([])).toEqual([]);
  });

  it("returns a single sequence for a single clip", () => {
    const sequences = detectSequences([makeMoment(DATE, "10:30:00")]);

    expect(sequences).toHaveLength(1);
    expect(sequences[0].clipCount).toBe(1);
    expect(sequences[0].totalDuration).toBe(60);
    expect(sequences[0].moments).toHaveLength(1);
  });

  it("merges consecutive 1-minute clips into one sequence", () => {
    const sequences = detectSequences(threeConsecutiveMoments());

    expect(sequences).toHaveLength(1);
    expect(sequences[0].clipCount).toBe(3);
    expect(sequences[0].totalDuration).toBe(180);
    expect(sequences[0].durationFormatted).toBe("3:00");
  });

  it("computes cumulative momentOffsets for seeking", () => {
    const sequences = detectSequences(threeConsecutiveMoments());

    expect(sequences[0].momentOffsets).toEqual([0, 60, 120]);
  });

  it("starts a new sequence when the gap exceeds the 65s threshold", () => {
    const moments = [
      makeMoment(DATE, "10:30:00"),
      makeMoment(DATE, "10:31:00"),
      makeMoment(DATE, "10:32:00"),
      // previous clip ends at 10:33:00 -> 12 minute gap
      makeMoment(DATE, "10:45:00"),
    ];

    const sequences = detectSequences(moments);

    expect(sequences).toHaveLength(2);
    expect(sequences[0].clipCount).toBe(3);
    expect(sequences[1].clipCount).toBe(1);
    expect(sequences[1].timeRange).toBe("10:45:00 - 10:46:00");
  });

  it("merges at exactly the 65s gap threshold", () => {
    // Previous clip: 10:30:00 + 60s -> ends 10:31:00.
    // A clip starting 10:32:05 is exactly 65s after that end.
    const moments = [makeMoment(DATE, "10:30:00"), makeMoment(DATE, "10:32:05")];

    const sequences = detectSequences(moments);

    expect(sequences).toHaveLength(1);
    expect(sequences[0].clipCount).toBe(2);
  });

  it("splits just past the 65s gap threshold", () => {
    // 10:32:06 is 66s after the previous clip ends.
    const moments = [makeMoment(DATE, "10:30:00"), makeMoment(DATE, "10:32:06")];

    const sequences = detectSequences(moments);

    expect(sequences).toHaveLength(2);
  });

  it("merges overlapping clips (negative gap)", () => {
    // Second clip starts before the first one ends.
    const moments = [makeMoment(DATE, "10:30:00"), makeMoment(DATE, "10:30:30")];

    const sequences = detectSequences(moments);

    expect(sequences).toHaveLength(1);
    expect(sequences[0].clipCount).toBe(2);
  });

  it("measures the gap from the previous clip end, not its start", () => {
    // 10:31:00 starts 60s after 10:30:00, but only 0s after the clip ends.
    // A 70s clip would end at 10:31:10, so 10:32:00 is a 50s gap -> merge.
    const moments = [
      makeMoment(DATE, "10:30:00", 70),
      makeMoment(DATE, "10:32:00", 70),
    ];

    const sequences = detectSequences(moments);

    expect(sequences).toHaveLength(1);
  });

  it("keeps moments in chronological order within a sequence", () => {
    const moments = [
      makeMoment(DATE, "10:30:00"),
      makeMoment(DATE, "10:31:00"),
      makeMoment(DATE, "10:32:00"),
    ];

    const sequences = detectSequences(moments);
    const times = sequences[0].moments.map((m) => m.time);

    expect(times).toEqual(["10:30:00", "10:31:00", "10:32:00"]);
  });

  it("attaches an event to the sequence that overlaps it", () => {
    const moments = [
      makeMoment(DATE, "10:30:00"),
      makeMoment(DATE, "10:31:00"),
      makeMoment(DATE, "10:45:00"),
    ];
    const event: TeslaEvent = {
      timestamp: new Date(2026, 0, 15, 10, 30, 30),
      city: "Milan",
      reason: "sideswipe",
      reasonLabel: "Sideswipe",
    };

    const sequences = detectSequences(moments, [event]);

    expect(sequences[0].event).toEqual(event);
    expect(sequences[1].event).toBeUndefined();
  });

  it("leaves sequences without an overlapping event untouched", () => {
    const moments = [makeMoment(DATE, "10:30:00")];
    // 12:00:00 is well outside the 10:30:00 - 10:31:00 clip.
    const event: TeslaEvent = {
      timestamp: new Date(2026, 0, 15, 12, 0, 0),
      reason: "sideswipe",
      reasonLabel: "Sideswipe",
    };

    const sequences = detectSequences(moments, [event]);

    expect(sequences[0].event).toBeUndefined();
  });

  it("derives the display fields of a sequence", () => {
    const sequences = detectSequences(threeConsecutiveMoments());
    const sequence = sequences[0];

    expect(sequence.dateRange).toBe(DATE);
    expect(sequence.timeRange).toBe("10:30:00 - 10:33:00");
    expect(sequence.durationFormatted).toBe("3:00");
    expect(sequence.startTime).toEqual(new Date(2026, 0, 15, 10, 30, 0));
    expect(sequence.endTime).toEqual(new Date(2026, 0, 15, 10, 33, 0));
  });

  it("gives each sequence a distinct id", () => {
    const moments = [makeMoment(DATE, "10:30:00"), makeMoment(DATE, "10:45:00")];

    const sequences = detectSequences(moments);

    expect(sequences[0].id).not.toBe(sequences[1].id);
  });
});

describe("findMomentForTime", () => {
  // Both helpers operate on a VideoSequence, not a raw moment array.
  const sequence = detectSequences(threeConsecutiveMoments())[0];

  it("finds the first moment at the very start", () => {
    const result = findMomentForTime(sequence, 0);

    expect(result.momentIndex).toBe(0);
    expect(result.localTime).toBe(0);
  });

  it("finds the moment containing a time inside the first clip", () => {
    const result = findMomentForTime(sequence, 30);

    expect(result.momentIndex).toBe(0);
    expect(result.localTime).toBe(30);
  });

  it("finds the moment containing a time inside the second clip", () => {
    const result = findMomentForTime(sequence, 75);

    expect(result.momentIndex).toBe(1);
    expect(result.localTime).toBe(15);
  });

  it("finds the moment containing a time inside the third clip", () => {
    const result = findMomentForTime(sequence, 150);

    expect(result.momentIndex).toBe(2);
    expect(result.localTime).toBe(30);
  });

  it("clamps to the first moment for a negative time", () => {
    const result = findMomentForTime(sequence, -10);

    expect(result.momentIndex).toBe(0);
    expect(result.localTime).toBe(-10);
  });

  it("clamps to the last moment for a time past the end", () => {
    const result = findMomentForTime(sequence, 10000);

    expect(result.momentIndex).toBe(2);
    expect(result.localTime).toBe(9880);
  });

  it("finds the moment at an exact clip boundary", () => {
    const result = findMomentForTime(sequence, 60);

    expect(result.momentIndex).toBe(1);
    expect(result.localTime).toBe(0);
  });
});

describe("toAbsoluteTime", () => {
  const sequence = detectSequences(threeConsecutiveMoments())[0];

  it("converts a moment index and local time to an absolute time", () => {
    expect(toAbsoluteTime(sequence, 0, 0)).toBe(0);
    expect(toAbsoluteTime(sequence, 1, 0)).toBe(60);
    expect(toAbsoluteTime(sequence, 1, 15)).toBe(75);
    expect(toAbsoluteTime(sequence, 2, 30)).toBe(150);
  });

  it("round-trips with findMomentForTime", () => {
    for (const absolute of [0, 30, 60, 75, 120, 150, 179]) {
      const { momentIndex, localTime } = findMomentForTime(sequence, absolute);
      expect(toAbsoluteTime(sequence, momentIndex, localTime)).toBe(absolute);
    }
  });

  it("returns 0 for an out-of-range moment index", () => {
    expect(toAbsoluteTime(sequence, -1, 10)).toBe(0);
    expect(toAbsoluteTime(sequence, 99, 10)).toBe(0);
  });
});
