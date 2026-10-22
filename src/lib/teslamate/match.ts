/**
 * Matching a clip to its TeslaMate trip.
 *
 * The clip's own wall clock is derived per moment, never per sequence: the
 * app merges clips separated by up to a minute into one sequence and
 * accumulates only clip durations, so a sequence clock drifts from wall-clock
 * time by the accumulated gaps — potentially minutes. A drift that size
 * silently attaches the wrong trip to a clip.
 */

import type { TripSummary } from "./types";

/**
 * The wall-clock instant for a frame.
 *
 * `momentTimestamp` is the clip's timestamp as the app parsed it from the
 * filename — the wall clock read as browser-local. When `tzOffsetMinutes` is
 * given, that same wall clock is reinterpreted in the recording location
 * instead; it is that location's offset **east** of UTC, so a positive value
 * moves the instant earlier.
 *
 * The browser's own offset cancels out:
 *
 *   new Date(y, m, d, …).getTime()  ===  Date.UTC(W) − browserOffEast
 *   wanted instant                   ===  Date.UTC(W) − tzOffsetMinutes
 *
 * so the browser offset is added back before the target offset is subtracted.
 */
export function clipWallClockMs(
  momentTimestamp: Date,
  localTimeSec: number,
  tzOffsetMinutes: number | null,
): number {
  const browserMs = momentTimestamp.getTime() + localTimeSec * 1000;
  if (tzOffsetMinutes === null) return browserMs;

  const browserOffEast = -new Date(browserMs).getTimezoneOffset();
  return browserMs + browserOffEast * 60_000 - tzOffsetMinutes * 60_000;
}

/** How long the clip and the trip coincide, in milliseconds. */
function overlapMs(clipStartMs: number, clipEndMs: number, trip: TripSummary): number {
  const tripEnd = trip.endMs ?? Number.POSITIVE_INFINITY;
  const start = Math.max(clipStartMs, trip.startMs);
  const end = Math.min(clipEndMs, tripEnd);
  return Math.max(0, end - start);
}

/** Whether the clip and the trip share any time at all, touching included. */
function intersects(clipStartMs: number, clipEndMs: number, trip: TripSummary): boolean {
  const tripEnd = trip.endMs ?? Number.POSITIVE_INFINITY;
  return clipStartMs <= tripEnd && clipEndMs >= trip.startMs;
}

/**
 * The trip the clip belongs to, or `null` when none does.
 *
 * A **closed** trip always wins over an open one. Every drive still in
 * progress has `end_date = NULL`, which makes it overlap every later window
 * — a clip from a drive three days ago would otherwise tie with the drive
 * that was actually recorded then. An open trip is only chosen when no
 * closed trip overlaps, and then the most recently started one wins: that is
 * the drive being recorded right now.
 */
export function selectTripForClip(
  clipStartMs: number,
  clipEndMs: number,
  trips: TripSummary[],
): TripSummary | null {
  let bestClosed: TripSummary | null = null;
  let bestClosedOverlap = -1;
  let bestOpen: TripSummary | null = null;
  let bestOpenStart = Number.NEGATIVE_INFINITY;

  for (const trip of trips) {
    if (!intersects(clipStartMs, clipEndMs, trip)) continue;
    const overlap = overlapMs(clipStartMs, clipEndMs, trip);

    if (trip.endMs === null) {
      if (trip.startMs > bestOpenStart) {
        bestOpen = trip;
        bestOpenStart = trip.startMs;
      }
      continue;
    }

    const better =
      overlap > bestClosedOverlap ||
      (overlap === bestClosedOverlap && bestClosed !== null && trip.startMs > bestClosed.startMs);
    if (better) {
      bestClosed = trip;
      bestClosedOverlap = overlap;
    }
  }

  return bestClosed ?? bestOpen;
}

/**
 * Whether the clip crosses from one trip into another — the sequence merged
 * two drives separated by a pause.
 */
export function spansMultipleTrips(
  clipStartMs: number,
  clipEndMs: number,
  trips: TripSummary[],
): boolean {
  let overlapping = 0;
  for (const trip of trips) {
    if (!intersects(clipStartMs, clipEndMs, trip)) continue;
    if (overlapMs(clipStartMs, clipEndMs, trip) > 0) overlapping += 1;
  }
  return overlapping > 1;
}
