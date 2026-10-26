'use client';

import {
  DASH,
  TIRE_POSITION_LABELS,
  TIRE_PRESSURE_KEYS,
  expandTripLink,
  fieldByKey,
  isProvisionalTripField,
  isTirePressureField,
  liveFieldValue,
  tripFieldValue,
  unitsFrom,
  type FieldDef,
} from '@/lib/teslamate/fields';
import type {
  PanelCorner,
  PositionSample,
  TeslaMateConfig,
  TripSummary,
} from '@/lib/teslamate/types';

interface TripMetricsPanelProps {
  /** The trip the clip belongs to, or null when none does. */
  trip: TripSummary | null;
  /** The live values at the current playback position. */
  sample: PositionSample | null;
  config: TeslaMateConfig;
  speedUnit: 'mph' | 'kmh';
  /** The car being viewed, so the trip link can name it. */
  carId?: number | null;
}

const CORNER_CLASS: Record<PanelCorner, string> = {
  'top-left': 'absolute top-3 left-3',
  'top-right': 'absolute top-3 right-3',
  'bottom-left': 'absolute bottom-3 left-3',
  'bottom-right': 'absolute bottom-3 right-3',
};

interface Row {
  label: string;
  text: string;
}

function rowsFor(
  keys: string[],
  value: (key: string, field: FieldDef) => unknown,
  units: ReturnType<typeof unitsFrom>,
  trip?: TripSummary,
  hide?: (key: string) => boolean,
): Row[] {
  return keys
    .map((key) => fieldByKey(key))
    .filter((field): field is FieldDef => Boolean(field))
    .map((field) => ({
      label: field.label,
      text: hide?.(field.key)
        ? DASH
        : field.format(value(field.key, field), units, trip),
    }));
}

/**
 * The TeslaMate trip metrics, shown over the video during playback.
 *
 * Two blocks: the trip summary, which is constant for the whole trip, and the
 * live values, which follow the playback position. The user chooses which
 * fields appear in each.
 *
 * Tire pressures are drawn as a 2×2 grid in the positions they describe,
 * rather than four separate rows, so a glance tells you which corner is low.
 */
export function TripMetricsPanel({
  trip,
  sample,
  config,
  speedUnit,
  carId = null,
}: TripMetricsPanelProps) {
  const units = unitsFrom(speedUnit, config);
  const corner = CORNER_CLASS[config.panelCorner] ?? CORNER_CLASS['top-right'];

  if (!trip) {
    return (
      <div className={`${corner} pointer-events-none`}>
        <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm text-white/80 text-xs">
          No TeslaMate trip covers this clip
        </div>
      </div>
    );
  }

  const isProvisional = trip.endMs === null;
  const link = expandTripLink(config.tripLinkTemplate, trip, carId);

  const tripRows = rowsFor(
    config.tripFields,
    (key) => tripFieldValue(key, trip),
    units,
    trip,
    (key) => isProvisional && isProvisionalTripField(key),
  );

  // Tire pressures are rendered as a grid, so they are not part of the row list.
  const tireKeys = config.liveFields.filter(isTirePressureField);
  const liveRows = rowsFor(
    config.liveFields.filter((key) => !isTirePressureField(key)),
    (key) => liveFieldValue(key, sample, config.rangeType),
    units,
  );

  const tires = TIRE_PRESSURE_KEYS.filter((key) => tireKeys.includes(key)).map(
    (key) => ({
      key,
      label: TIRE_POSITION_LABELS[key],
      text: fieldByKey(key)!.format(
        liveFieldValue(key, sample, config.rangeType),
        units,
      ),
    }),
  );

  const showLiveBlock = liveRows.length > 0 || tires.length > 0;

  return (
    <div className={`${corner} pointer-events-none flex flex-col gap-1 items-start`}>
      {(tripRows.length > 0 || isProvisional || link) && (
        <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm text-white/90 text-xs flex flex-col gap-0.5">
          {isProvisional && (
            <span className="text-[10px] uppercase tracking-wide text-amber-300/90">
              In progress
            </span>
          )}
          {tripRows.map((row) => (
            <div key={row.label} className="flex items-baseline gap-2">
              <span className="text-white/50">{row.label}</span>
              <span className="font-medium">{row.text}</span>
            </div>
          ))}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="pointer-events-auto mt-0.5 text-[10px] text-blue-300 underline hover:text-blue-200"
            >
              Trip stats ↗
            </a>
          )}
        </div>
      )}

      {showLiveBlock && (
        <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm text-white/90 text-xs flex flex-col gap-0.5">
          {liveRows.map((row) => (
            <div key={row.label} className="flex items-baseline gap-2">
              <span className="text-white/50">{row.label}</span>
              <span className="font-medium">{row.text}</span>
            </div>
          ))}

          {tires.length > 0 && (
            <div
              className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-0.5 pt-1 border-t border-white/10"
              aria-label="Tire pressures"
            >
              {tires.map((tire) => (
                <div
                  key={tire.key}
                  className="flex items-baseline gap-1"
                  aria-label={`Tire ${tire.label}`}
                >
                  <span className="text-white/50">{tire.label}</span>
                  <span className="font-medium">{tire.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
