import { describe, expect, it } from "vitest";
import { parseSamples, parseTrips } from "@/lib/teslamate/parse";
import type { Frame } from "@/lib/teslamate/client";

function frameOf(fields: string[], columns: Record<string, unknown[]>): Frame {
  const rowCount = fields.length ? (columns[fields[0]] ?? []).length : 0;
  return { fields, columns, rowCount };
}

describe("parseSamples", () => {
  it("reads the position fields into samples", () => {
    const frame = frameOf(
      ["t_ms", "speed_kmh", "battery_pct", "tpms_fl"],
      {
        t_ms: [1000, 2000],
        speed_kmh: [10, 20],
        battery_pct: [60, 59],
        tpms_fl: [2.9, null],
      },
    );

    const samples = parseSamples(frame);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ tMs: 1000, speedKmh: 10, batteryPct: 60, tpmsFl: 2.9 });
    expect(samples[1].tpmsFl).toBeNull();
    expect(samples[1].estRangeKm).toBeNull();
  });

  it("skips a row with no readable time instead of placing it at the epoch", () => {
    const frame = frameOf(["t_ms", "speed_kmh"], {
      t_ms: [null, 2000],
      speed_kmh: [10, 20],
    });

    const samples = parseSamples(frame);
    expect(samples).toHaveLength(1);
    expect(samples[0].tMs).toBe(2000);
  });
});

describe("parseTrips", () => {
  it("reads the drive fields into trips", () => {
    const frame = frameOf(
      ["id", "start_date", "end_date", "distance", "duration_min", "efficiency"],
      {
        id: [7],
        start_date: [1000],
        end_date: [2000],
        distance: [12.5],
        duration_min: [15],
        efficiency: [0.1367],
      },
    );

    expect(parseTrips(frame)).toEqual([
      expect.objectContaining({ id: 7, startMs: 1000, endMs: 2000, distanceKm: 12.5 }),
    ]);
  });

  it("keeps an in-progress drive, whose end date is null", () => {
    const frame = frameOf(["id", "start_date", "end_date", "distance"], {
      id: [7],
      start_date: [1000],
      end_date: [null],
      distance: [null],
    });

    const trips = parseTrips(frame);
    expect(trips).toHaveLength(1);
    expect(trips[0].endMs).toBeNull();
    expect(trips[0].distanceKm).toBeNull();
  });

  it("skips a drive with no readable start instead of placing it at the epoch", () => {
    const frame = frameOf(["id", "start_date", "end_date"], {
      id: [7, 8],
      start_date: [null, 2000],
      end_date: [1500, 3000],
    });

    const trips = parseTrips(frame);
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe(8);
  });
});
