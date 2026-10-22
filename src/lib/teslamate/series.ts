/**
 * The position series and its lookup.
 *
 * TeslaMate records the dense driving data (speed, power, battery, range,
 * odometer, elevation, GPS) on nearly every row, but the sparse data — tire
 * pressures and cabin temperatures — only every 15 to 40 seconds. Interpolating
 * a sparse field between two samples would invent a value the car never
 * reported, so sparse fields carry the last known value forward and dense
 * fields interpolate.
 */

import type { PositionSample, TripSeries } from "./types";

/** The sample fields that carry a value; `tMs` is the time, not a reading. */
const VALUE_FIELDS = [
  "speedKmh",
  "powerKw",
  "batteryPct",
  "usableBatteryPct",
  "odometerKm",
  "elevationM",
  "idealRangeKm",
  "estRangeKm",
  "ratedRangeKm",
  "tpmsFl",
  "tpmsFr",
  "tpmsRl",
  "tpmsRr",
  "outsideTempC",
  "insideTempC",
  "latitude",
  "longitude",
] as const;

type ValueField = (typeof VALUE_FIELDS)[number];

/** Sorts the samples into a timeline. The input array is not modified. */
export function buildSeries(samples: PositionSample[]): TripSeries {
  return { samples: [...samples].sort((a, b) => a.tMs - b.tMs) };
}

/** The last recorded value of a field at or before `uptoIndex`, if any. */
function lastRecordedValue(
  samples: PositionSample[],
  field: ValueField,
  uptoIndex: number,
): number | null {
  for (let i = uptoIndex; i >= 0; i--) {
    const value = samples[i][field];
    if (value !== null) return value;
  }
  return null;
}

/**
 * The sample values at an arbitrary instant.
 *
 * Dense fields interpolate between the two surrounding samples; sparse ones
 * carry forward the last recorded value. A request outside the series clamps
 * to the nearest boundary sample — and returns that sample's own time,
 * because the values are exactly that sample's. Within the series the result
 * carries the requested instant, because the values were derived for it.
 */
export function sampleAt(series: TripSeries, tMs: number): PositionSample | null {
  const samples = series.samples;
  if (samples.length === 0) return null;

  // The last sample at or before tMs.
  let low = 0;
  let high = samples.length - 1;
  let index = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (samples[mid].tMs <= tMs) {
      index = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (index < 0) {
    // Before the start of the series.
    return { ...samples[0] };
  }
  if (index === samples.length - 1) {
    // After the end of the series.
    return { ...samples[index] };
  }

  const before = samples[index];
  const after = samples[index + 1];
  const span = after.tMs - before.tMs;
  const ratio = span > 0 ? (tMs - before.tMs) / span : 0;

  const result = { ...before, tMs };

  for (const field of VALUE_FIELDS) {
    const a = before[field];
    const b = after[field];

    if (a !== null && b !== null) {
      result[field] = a + (b - a) * ratio;
    } else if (a !== null) {
      result[field] = a;
    } else {
      // Not measured here — carry the last recorded value forward, if the car
      // ever measured it. Never invent one.
      result[field] = lastRecordedValue(samples, field, index);
    }
  }

  return result;
}
