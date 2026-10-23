import { describe, expect, it } from "vitest";
import {
  clipWallClockMs,
  selectTripForClip,
  spansMultipleTrips,
} from "@/lib/teslamate/match";
import type { TripSummary } from "@/lib/teslamate/types";

function trip(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    id: 1,
    startMs: 0,
    endMs: 1000,
    distanceKm: null,
    durationMin: null,
    speedMaxKmh: null,
    powerMaxKw: null,
    powerMinKw: null,
    ascentM: null,
    descentM: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    startIdealRangeKm: null,
    endIdealRangeKm: null,
    startKm: null,
    endKm: null,
    efficiencyKwhPerKm: null,
    startBatteryPct: null,
    endBatteryPct: null,
    startPlace: null,
    endPlace: null,
    ...overrides,
  };
}

describe("clipWallClockMs", () => {
  // The wall clock of this clip, expressed as UTC components.
  const W = Date.UTC(2026, 0, 15, 12, 0, 0);
  // The same wall clock, as the browser parses a filename timestamp.
  const d = new Date(2026, 0, 15, 12, 0, 0);

  it("uses the browser timezone when the offset is null", () => {
    expect(clipWallClockMs(d, 0, null)).toBe(d.getTime());
  });

  it("reinterprets the wall clock in the recording timezone", () => {
    // Expected values are built from Date.UTC, never from a hard-coded
    // instant, so the assertion holds whatever timezone the suite runs in.
    for (const target of [0, 120, 240, -300]) {
      expect(clipWallClockMs(d, 0, target)).toBe(W - target * 60_000);
    }
  });

  it("shifts by localTime within the clip", () => {
    expect(clipWallClockMs(d, 30, null)).toBe(d.getTime() + 30_000);
    expect(clipWallClockMs(d, 30, 120)).toBe(W - 120 * 60_000 + 30_000);
  });

  it("is correct across a DST transition", () => {
    // 2026-03-29 is a DST transition in Europe. A fixed target offset keeps
    // the expectation independent of the host's zone and its DST rules.
    const w = Date.UTC(2026, 2, 29, 12, 0, 0);
    const dd = new Date(2026, 2, 29, 12, 0, 0);
    expect(clipWallClockMs(dd, 0, 60)).toBe(w - 60 * 60_000);
  });
});

describe("selectTripForClip", () => {
  it("selects the trip the clip sits inside", () => {
    const t = trip({ id: 7, startMs: 1000, endMs: 5000 });
    expect(selectTripForClip(2000, 3000, [t])).toBe(t);
  });

  it("returns null when no trip overlaps the clip", () => {
    const t = trip({ id: 7, startMs: 1000, endMs: 5000 });
    expect(selectTripForClip(9000, 10_000, [t])).toBeNull();
    expect(selectTripForClip(0, 10_000, [])).toBeNull();
  });

  it("prefers the trip with the larger overlap when a clip straddles two", () => {
    const first = trip({ id: 1, startMs: 0, endMs: 4000 });
    const second = trip({ id: 2, startMs: 4000, endMs: 10_000 });
    expect(selectTripForClip(2000, 8000, [first, second])).toBe(second);
  });

  it("matches a trip that is still in progress", () => {
    const open = trip({ id: 3, startMs: 1000, endMs: null });
    expect(selectTripForClip(2000, 3000, [open])).toBe(open);
  });

  it("prefers a closed trip over an open one that overlaps the same clip", () => {
    // Every in-progress drive has end_date = NULL, so it overlaps every later
    // window. The clip here really belongs to the closed trip.
    const openOld = trip({ id: 2, startMs: -50_000, endMs: null });
    const openNew = trip({ id: 3, startMs: -10_000, endMs: null });
    const closed = trip({ id: 1, startMs: 0, endMs: 100_000 });

    expect(selectTripForClip(0, 60_000, [openOld, openNew, closed])).toBe(closed);
  });

  it("falls back to the most recently started open trip", () => {
    const openOld = trip({ id: 2, startMs: -50_000, endMs: null });
    const openNew = trip({ id: 3, startMs: -10_000, endMs: null });

    expect(selectTripForClip(0, 60_000, [openOld, openNew])).toBe(openNew);
  });

  it("prefers the later trip when two closed trips overlap equally", () => {
    const earlier = trip({ id: 1, startMs: 0, endMs: 100_000 });
    const later = trip({ id: 2, startMs: 10_000, endMs: 100_000 });

    expect(selectTripForClip(20_000, 30_000, [earlier, later])).toBe(later);
  });

  it("resolves a zero-length clip at a boundary deterministically", () => {
    const t = trip({ id: 7, startMs: 1000, endMs: 5000 });
    expect(selectTripForClip(5000, 5000, [t])).toBe(t);
    expect(selectTripForClip(1000, 1000, [t])).toBe(t);
  });

  it("does not prefer a closed trip that merely touches the clip", () => {
    // The closed trip ends exactly where the clip starts. It has no overlap,
    // so the open trip that really covers the clip must win.
    const closedTouching = trip({ id: 1, startMs: 0, endMs: 5000 });
    const openCovering = trip({ id: 2, startMs: 4000, endMs: null });
    expect(selectTripForClip(5000, 20_000, [closedTouching, openCovering])).toBe(
      openCovering,
    );
  });
});

describe("spansMultipleTrips", () => {
  it("is true only when two trips overlap the clip", () => {
    const first = trip({ id: 1, startMs: 0, endMs: 4000 });
    const second = trip({ id: 2, startMs: 4000, endMs: 10_000 });
    const alone = trip({ id: 3, startMs: 100, endMs: 200 });

    expect(spansMultipleTrips(2000, 8000, [first, second])).toBe(true);
    expect(spansMultipleTrips(2000, 3000, [first, alone])).toBe(false);
    expect(spansMultipleTrips(2000, 3000, [first])).toBe(false);
    expect(spansMultipleTrips(2000, 3000, [])).toBe(false);
  });
});
