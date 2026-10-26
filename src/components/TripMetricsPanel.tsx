'use client';

import {
  DASH,
  expandTripLink,
  fieldByKey,
  isProvisionalTripField,
  liveFieldValue,
  tireGridCells,
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
    .filter((field): field is FieldDef => Boolean(field && field.kind !== 'tireGrid' && field.kind !== 'powerGauge'))
    .map((field) => ({
      label: field.label,
      text: hide?.(field.key)
        ? DASH
        : field.format(value(field.key, field), units, trip),
    }));
}

/**
 * The car's own power meter: a vertical bar that grows upward for drive power
 * and downward for regeneration, grey for consumption and green for regen.
 *
 * The two directions are scaled independently, because regen peaks far lower
 * than drive power — a single scale would make regen invisible.
 */
function PowerGauge({
  kw,
  text,
  maxKw,
  regenMaxKw,
}: {
  kw: number | null;
  text: string;
  maxKw: number;
  regenMaxKw: number;
}) {
  const full = Math.max(1, maxKw);
  const regenFull = Math.max(1, regenMaxKw);
  const isRegen = kw !== null && kw < 0;
  const scale = isRegen ? regenFull : full;
  const fraction =
    kw === null ? 0 : Math.min(1, Math.abs(kw) / scale) * 50;

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative w-2 h-14 rounded-sm bg-white/10 overflow-hidden"
        aria-label="Power gauge"
        role="img"
      >
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/30" />
        <div
          className={`absolute left-0 right-0 ${isRegen ? 'bg-emerald-400' : 'bg-gray-300'}`}
          style={
            isRegen
              ? { top: '50%', height: `${fraction}%` }
              : { bottom: '50%', height: `${fraction}%` }
          }
        />
      </div>
      <span className="font-medium tabular-nums">{text}</span>
    </div>
  );
}

/**
 * The TeslaMate trip metrics, shown over the video during playback.
 *
 * Two blocks: the trip summary, which is constant for the whole trip, and the
 * live values, which follow the playback position. The user chooses which
 * fields appear in each.
 *
 * Composite fields are drawn rather than printed: tire pressures as a 2x2 grid
 * in the positions they describe, power as a vertical gauge.
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

  const showTires = config.liveFields.includes('tires');
  const showGauge = config.liveFields.includes('power');
  const liveRows = rowsFor(
    config.liveFields,
    (key) => liveFieldValue(key, sample, config.rangeType),
    units,
  );

  const powerField = fieldByKey('power');
  const powerText = powerField
    ? powerField.format(liveFieldValue('power', sample, config.rangeType), units)
    : DASH;
  const powerKw = liveFieldValue('power', sample, config.rangeType) as number | null;

  const tires = showTires ? tireGridCells(sample, units) : [];
  const showLiveBlock = liveRows.length > 0 || showGauge || tires.length > 0;

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
          {showGauge && (
            <div className="flex items-baseline gap-2">
              <span className="text-white/50">Power</span>
              <PowerGauge
                kw={Number.isFinite(powerKw) ? powerKw : null}
                text={powerText}
                maxKw={config.powerGaugeMaxKw}
                regenMaxKw={config.powerGaugeRegenMaxKw}
              />
            </div>
          )}

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
