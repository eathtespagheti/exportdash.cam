import { describe, expect, it } from "vitest";
import { drawTripMetrics } from "@/components/VideoExporter";
import { DEFAULT_TESLAMATE_CONFIG } from "@/lib/teslamate/config";
import type { PositionSample, TripSummary } from "@/lib/teslamate/types";

const TRIP: TripSummary = {
  id: 7,
  startMs: 0,
  endMs: 600_000,
  distanceKm: 12.5,
  durationMin: 15,
  speedMaxKmh: 60,
  powerMaxKw: 30,
  powerMinKw: -10,
  ascentM: 5,
  descentM: 12,
  outsideTempAvgC: 20,
  insideTempAvgC: 25,
  startIdealRangeKm: 280,
  endIdealRangeKm: 270,
  startKm: 162_723,
  endKm: 162_735,
  efficiencyKwhPerKm: 0.1367,
  startBatteryPct: 60,
  endBatteryPct: 55,
  startPlace: "Home",
  endPlace: "Work",
};

const SAMPLE: PositionSample = {
  tMs: 0,
  speedKmh: 42,
  powerKw: -8,
  batteryPct: 58,
  usableBatteryPct: 57,
  odometerKm: 162_730,
  elevationM: 175,
  idealRangeKm: 275,
  estRangeKm: 270,
  ratedRangeKm: 275,
  tpmsFl: 2.9,
  tpmsFr: 2.9,
  tpmsRl: 3,
  tpmsRr: 3,
  outsideTempC: 21,
  insideTempC: 26,
  latitude: 40.7,
  longitude: 8.5,
};

/** A canvas context that records every string it is asked to draw. */
function mockContext() {
  const texts: string[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    textAlign: "left",
    textBaseline: "top",
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillText: (text: string) => {
      texts.push(text);
    },
    beginPath: () => {},
    roundRect: () => {},
    fill: () => {},
    clearRect: () => {},
    fillRect: () => {},
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("drawTripMetrics", () => {
  it("draws only the configured trip fields", () => {
    const { ctx, texts } = mockContext();

    drawTripMetrics(ctx, 1280, 720, TRIP, SAMPLE, {
      ...DEFAULT_TESLAMATE_CONFIG,
      tripFields: ["trip_distance"],
    }, "kmh");

    expect(texts).toContain("12.5 km");
    expect(texts).not.toContain("Work");
    expect(texts).not.toContain("162,735 km");
  });

  it("draws the configured live fields", () => {
    const { ctx, texts } = mockContext();

    drawTripMetrics(ctx, 1280, 720, TRIP, SAMPLE, {
      ...DEFAULT_TESLAMATE_CONFIG,
      tripFields: [],
      exportLiveFields: ["battery"],
    }, "kmh");

    expect(texts).toContain("58%");
  });

  it("never draws NaN or undefined, whatever is missing", () => {
    const { ctx, texts } = mockContext();

    drawTripMetrics(ctx, 1280, 720, null, null, {
      ...DEFAULT_TESLAMATE_CONFIG,
      tripFields: ["trip_distance", "trip_max_speed", "trip_energy"],
      exportLiveFields: ["battery", "power", "tpms_fl"],
    }, "kmh");

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).not.toMatch(/NaN|undefined/);
    }
  });

  it("says so when no trip covers the clip", () => {
    const { ctx, texts } = mockContext();

    drawTripMetrics(ctx, 1280, 720, null, null, DEFAULT_TESLAMATE_CONFIG, "kmh");

    expect(texts.join(" ")).toMatch(/No TeslaMate trip/i);
  });

  it("marks a trip that is still in progress", () => {
    const { ctx, texts } = mockContext();

    drawTripMetrics(ctx, 1280, 720, { ...TRIP, endMs: null }, SAMPLE, {
      ...DEFAULT_TESLAMATE_CONFIG,
      tripFields: ["trip_distance"],
    }, "kmh");

    expect(texts.join(" ")).toMatch(/In progress/i);
  });

  it("draws nothing when no fields are chosen and there is no trip", () => {
    const { ctx, texts } = mockContext();

    drawTripMetrics(ctx, 1280, 720, TRIP, SAMPLE, {
      ...DEFAULT_TESLAMATE_CONFIG,
      tripFields: [],
      exportLiveFields: [],
    }, "kmh");

    expect(texts).toEqual([]);
  });
});
