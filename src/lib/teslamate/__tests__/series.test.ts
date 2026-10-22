import { describe, expect, it } from "vitest";
import { buildSeries, sampleAt } from "@/lib/teslamate/series";
import type { PositionSample } from "@/lib/teslamate/types";

function s(
  tMs: number,
  speedKmh: number | null,
  tpmsFl: number | null,
): PositionSample {
  return {
    tMs,
    speedKmh,
    tpmsFl,
    powerKw: null,
    batteryPct: null,
    usableBatteryPct: null,
    odometerKm: null,
    elevationM: null,
    idealRangeKm: null,
    estRangeKm: null,
    ratedRangeKm: null,
    tpmsFr: null,
    tpmsRl: null,
    tpmsRr: null,
    outsideTempC: null,
    insideTempC: null,
    latitude: null,
    longitude: null,
  };
}

describe("buildSeries", () => {
  it("sorts the samples ascending by time", () => {
    const series = buildSeries([s(2000, 30, 2.9), s(0, 10, 2.8), s(1000, 20, null)]);
    expect(series.samples.map((x) => x.tMs)).toEqual([0, 1000, 2000]);
  });

  it("accepts an empty series", () => {
    expect(buildSeries([]).samples).toEqual([]);
  });
});

describe("sampleAt", () => {
  const series = buildSeries([s(2000, 30, 2.9), s(0, 10, 2.8), s(1000, 20, null)]);

  it("interpolates dense metrics", () => {
    expect(sampleAt(series, 500)!.speedKmh).toBe(15);
    expect(sampleAt(series, 1500)!.speedKmh).toBe(25);
  });

  it("carries sparse metrics forward and never invents them", () => {
    // The car reported 2.8 bar at t=0 and 2.9 at t=2000. Between them it
    // reported nothing, so the value must be 2.8 — not an invented 2.85.
    expect(sampleAt(series, 500)!.tpmsFl).toBe(2.8);
    expect(sampleAt(series, 1500)!.tpmsFl).toBe(2.8);
  });

  it("returns null before the first non-null sparse sample", () => {
    const later = buildSeries([s(0, 10, null), s(1000, 20, 2.9)]);
    expect(sampleAt(later, 500)!.tpmsFl).toBeNull();
  });

  it("clamps outside the series and handles an empty series", () => {
    expect(sampleAt(series, -1)!.tMs).toBe(0);
    expect(sampleAt(series, 9999)!.tMs).toBe(2000);
    expect(sampleAt(buildSeries([]), 0)).toBeNull();
  });

  it("leaves unmeasured fields null rather than NaN", () => {
    const sample = sampleAt(series, 500)!;
    for (const [key, value] of Object.entries(sample)) {
      if (key === "tMs") continue;
      if (value === null) continue;
      expect(Number.isNaN(value as number), `${key} is NaN`).toBe(false);
    }
    expect(sample.batteryPct).toBeNull();
    expect(sample.powerKw).toBeNull();
  });

  it("carries a sparse value forward past the end of the series", () => {
    expect(sampleAt(series, 9999)!.tpmsFl).toBe(2.9);
  });
});
