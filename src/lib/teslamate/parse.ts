/**
 * Reading Grafana frames into the app's own shapes.
 *
 * Grafana's frames are column-major: `values[0]` holds every value of the
 * first column, not every value of the first row. A missing value is `null`,
 * and means the car did not record it — never zero.
 */

import type { Frame } from "./client";
import type { CarInfo, PositionSample, TripSummary } from "./types";

/** A finite number at a position in a frame column, or null. */
export function numberAt(
  frame: Frame | undefined,
  name: string,
  index: number,
): number | null {
  const column = frame?.columns[name];
  if (!column) return null;
  const value = column[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A non-empty string at a position in a frame column, or null. */
export function stringAt(
  frame: Frame | undefined,
  name: string,
  index: number,
): string | null {
  const column = frame?.columns[name];
  if (!column) return null;
  const value = column[index];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Reads the `cars` query result. */
export function parseCars(frame: Frame | undefined): CarInfo[] {
  const cars: CarInfo[] = [];
  for (let i = 0; i < (frame?.rowCount ?? 0); i++) {
    cars.push({
      id: numberAt(frame, "id", i) ?? 0,
      name: stringAt(frame, "name", i) ?? `Car ${i + 1}`,
      model: stringAt(frame, "model", i),
    });
  }
  return cars;
}

/** Reads the `drives` query result. */
export function parseTrips(frame: Frame | undefined): TripSummary[] {
  const trips: TripSummary[] = [];
  for (let i = 0; i < (frame?.rowCount ?? 0); i++) {
    const startMs = numberAt(frame, "start_date", i);
    // A drive with no readable start cannot be placed in time; putting it at
    // the epoch would make it match every clip.
    if (startMs === null) continue;

    trips.push({
      id: numberAt(frame, "id", i) ?? 0,
      startMs,
      endMs: numberAt(frame, "end_date", i),
      distanceKm: numberAt(frame, "distance", i),
      durationMin: numberAt(frame, "duration_min", i),
      speedMaxKmh: numberAt(frame, "speed_max", i),
      powerMaxKw: numberAt(frame, "power_max", i),
      powerMinKw: numberAt(frame, "power_min", i),
      ascentM: numberAt(frame, "ascent", i),
      descentM: numberAt(frame, "descent", i),
      outsideTempAvgC: numberAt(frame, "outside_temp_avg", i),
      insideTempAvgC: numberAt(frame, "inside_temp_avg", i),
      startIdealRangeKm: numberAt(frame, "start_ideal_range_km", i),
      endIdealRangeKm: numberAt(frame, "end_ideal_range_km", i),
      startKm: numberAt(frame, "start_km", i),
      endKm: numberAt(frame, "end_km", i),
      efficiencyKwhPerKm: numberAt(frame, "efficiency", i),
      startBatteryPct: numberAt(frame, "start_battery_level", i),
      endBatteryPct: numberAt(frame, "end_battery_level", i),
      startPlace: stringAt(frame, "start_place", i),
      endPlace: stringAt(frame, "end_place", i),
    });
  }
  return trips;
}

/** The frame column each sample field is read from. */
const POSITION_FIELDS: Array<[string, keyof PositionSample]> = [
  ["speed_kmh", "speedKmh"],
  ["power_kw", "powerKw"],
  ["battery_pct", "batteryPct"],
  ["usable_battery_pct", "usableBatteryPct"],
  ["odometer_km", "odometerKm"],
  ["elevation_m", "elevationM"],
  ["ideal_range_km", "idealRangeKm"],
  ["est_range_km", "estRangeKm"],
  ["rated_range_km", "ratedRangeKm"],
  ["tpms_fl", "tpmsFl"],
  ["tpms_fr", "tpmsFr"],
  ["tpms_rl", "tpmsRl"],
  ["tpms_rr", "tpmsRr"],
  ["outside_temp_c", "outsideTempC"],
  ["inside_temp_c", "insideTempC"],
  ["latitude", "latitude"],
  ["longitude", "longitude"],
];

/** Reads the `positions` query result. */
export function parseSamples(frame: Frame | undefined): PositionSample[] {
  const samples: PositionSample[] = [];
  for (let i = 0; i < (frame?.rowCount ?? 0); i++) {
    const tMs = numberAt(frame, "t_ms", i);
    // A sample with no readable time cannot be interpolated against.
    if (tMs === null) continue;

    const sample = { tMs } as PositionSample;
    for (const [column, field] of POSITION_FIELDS) {
      (sample as unknown as Record<string, unknown>)[field] = numberAt(frame, column, i);
    }
    samples.push(sample);
  }
  return samples;
}
