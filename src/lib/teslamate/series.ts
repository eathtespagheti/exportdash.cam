/**
 * The position series and its lookup.
 *
 * TeslaMate records the dense driving data (speed, power, battery, range,
 * odometer, elevation, GPS) on nearly every row, but the sparse data — tire
 * pressures and cabin temperatures — only every 15 to 40 seconds.
 *
 * The two are treated differently on purpose:
 *
 * - **Dense** fields interpolate between the surrounding samples, because the
 *   car really was somewhere between them.
 * - **Sparse** fields carry the last recorded value forward and are *never*
 *   interpolated. A tire pressure of 2.8 bar at one moment and 2.9 two
 *   minutes later does not mean it was 2.85 in between; the car measured
 *   nothing at all. Inventing that midpoint would be inventing data.
 */

import type { PositionSample, TripSeries } from "./types";

/** Fields the car reports continuously; safe to interpolate. */
const DENSE_FIELDS = [
  "speedKmh",
  "powerKw",
  "batteryPct",
  "usableBatteryPct",
  "odometerKm",
  "elevationM",
  "idealRangeKm",
  "estRangeKm",
  "ratedRangeKm",
  "latitude",
  "longitude",
] as const;

/** Fields reported only occasionally; carried forward, never interpolated. */
const SPARSE_FIELDS = [
  "tpmsFl",
  "tpmsFr",
  "tpmsRl",
  "tpmsRr",
  "outsideTempC",
  "insideTempC",
] as const;

type DenseField = (typeof DENSE_FIELDS)[number];
type SparseField = (typeof SPARSE_FIELDS)[number];

/** Sorts the samples into a timeline. The input array is not modified. */
export function buildSeries(samples: PositionSample[]): TripSeries {
  return { samples: [...samples].sort((a, b) => a.tMs - b.tMs) };
}

/** The last recorded value of a field at or before `uptoIndex`, if any. */
function lastRecordedValue(
  samples: PositionSample[],
  field: SparseField,
  uptoIndex: number,
): number | null {
  for (let i = uptoIndex; i >= 0; i--) {
    const value = samples[i][field];
    if (value !== null) return value;
  }
  return null;
}

/**
 * A copy of the sample at `index` with its sparse fields carried forward.
 *
 * Used at the boundaries, where there is no second sample to interpolate
 * with: the values are the recorded sample's own, but a sparse field the car
 * reported earlier is still the last known value rather than "unknown".
 */
function carriedSample(
  samples: PositionSample[],
  index: number,
): PositionSample {
  const sample = { ...samples[index] };
  for (const field of SPARSE_FIELDS) {
    if (sample[field] === null) {
      sample[field] = lastRecordedValue(samples, field, index);
    }
  }
  return sample;
}

/**
 * The sample values at an arbitrary instant.
 *
 * A request outside the series clamps to the nearest boundary sample — and
 * returns that sample's own time, because the values are exactly that
 * sample's. Within the series the result carries the requested instant,
 * because the values were derived for it.
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

  if (index < 0) return carriedSample(samples, 0);
  if (index === samples.length - 1) return carriedSample(samples, index);

  const before = samples[index];
  const after = samples[index + 1];
  const span = after.tMs - before.tMs;
  const ratio = span > 0 ? (tMs - before.tMs) / span : 0;

  const result = { ...before, tMs };

  for (const field of DENSE_FIELDS) {
    const a = before[field] as number | null;
    const b = after[field] as number | null;
    if (a !== null && b !== null) {
      result[field] = a + (b - a) * ratio;
    } else if (a !== null) {
      result[field] = a;
    } else {
      // Not measured in this window — fall back to the last value before it,
      // or null if the car never reported it.
      result[field] = lastDenseValue(samples, field, index);
    }
  }

  // Sparse fields never interpolate.
  for (const field of SPARSE_FIELDS) {
    const a = before[field];
    result[field] = a !== null ? a : lastRecordedValue(samples, field, index);
  }

  return result;
}

/** The last recorded value of a dense field at or before `uptoIndex`. */
function lastDenseValue(
  samples: PositionSample[],
  field: DenseField,
  uptoIndex: number,
): number | null {
  for (let i = uptoIndex; i >= 0; i--) {
    const value = samples[i][field] as number | null;
    if (value !== null) return value;
  }
  return null;
}
