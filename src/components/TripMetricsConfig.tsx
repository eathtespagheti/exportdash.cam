'use client';

import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { LIVE_FIELDS, TRIP_FIELDS } from '@/lib/teslamate/fields';
import { loadTeslaMateConfig, saveTeslaMateConfig } from '@/lib/teslamate/config';
import type {
  DistanceUnit,
  PanelCorner,
  PressureUnit,
  RangeType,
  TemperatureUnit,
  TeslaMateConfig,
} from '@/lib/teslamate/types';

interface TripMetricsConfigProps {
  onClose: () => void;
  /** Called whenever the settings change, so the app can re-render. */
  onChange: (config: TeslaMateConfig) => void;
  /** Corners the mini-map already uses in the current layout. */
  occupiedCorners?: PanelCorner[];
}

const CORNERS: PanelCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const CORNER_LABELS: Record<PanelCorner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

type FieldList = 'tripFields' | 'liveFields' | 'exportLiveFields';

function FieldChecklist({
  title,
  fields,
  selected,
  onToggle,
  labelPrefix,
}: {
  title: string;
  fields: typeof TRIP_FIELDS;
  selected: string[];
  onToggle: (key: string) => void;
  labelPrefix: string;
}) {
  return (
    <div>
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">{title}</span>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
        {fields.map((field) => (
          <label
            key={field.key}
            className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
          >
            <input
              type="checkbox"
              aria-label={`${labelPrefix}: ${field.label}`}
              checked={selected.includes(field.key)}
              onChange={() => onToggle(field.key)}
            />
            <span className="truncate">{field.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Picks which trip metrics are shown, where, and in which units.
 *
 * Every metric is opt-in and every choice is persisted, so the panel can be
 * made exactly as dense or as quiet as the user wants.
 */
export function TripMetricsConfig({
  onClose,
  onChange,
  occupiedCorners = [],
}: TripMetricsConfigProps) {
  const [config, setConfig] = useState<TeslaMateConfig>(() => loadTeslaMateConfig());

  const update = (next: TeslaMateConfig) => {
    setConfig(next);
    saveTeslaMateConfig(next);
    onChange(next);
  };

  const toggle = (list: FieldList, key: string) => {
    const current = config[list];
    update({
      ...config,
      [list]: current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    });
  };

  return (
    <div className="absolute z-40 right-0 top-0 w-80 max-h-[80vh] overflow-y-auto rounded-xl bg-gray-900 border border-gray-700 shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-200">Trip metrics</span>
        <button
          onClick={onClose}
          aria-label="Close trip metrics settings"
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="space-y-4">
        <FieldChecklist
          title="Trip summary"
          fields={TRIP_FIELDS}
          selected={config.tripFields}
          onToggle={(key) => toggle('tripFields', key)}
          labelPrefix="Trip"
        />

        <FieldChecklist
          title="Live values on screen"
          fields={LIVE_FIELDS}
          selected={config.liveFields}
          onToggle={(key) => toggle('liveFields', key)}
          labelPrefix="Live"
        />

        <FieldChecklist
          title="Live values in the export"
          fields={LIVE_FIELDS}
          selected={config.exportLiveFields}
          onToggle={(key) => toggle('exportLiveFields', key)}
          labelPrefix="Export"
        />

        <div>
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">
            Panel position
          </span>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {CORNERS.map((corner) => (
              <label
                key={corner}
                className={`flex items-center gap-1.5 text-xs ${
                  occupiedCorners.includes(corner)
                    ? 'text-gray-600'
                    : 'text-gray-300 cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  name="teslamate-panel-corner"
                  aria-label={`Corner: ${corner}`}
                  checked={config.panelCorner === corner}
                  disabled={occupiedCorners.includes(corner)}
                  onChange={() => update({ ...config, panelCorner: corner })}
                />
                <span>{CORNER_LABELS[corner]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1"
              htmlFor="teslamate-distance-unit"
            >
              Distance unit
            </label>
            <select
              id="teslamate-distance-unit"
              aria-label="Distance unit"
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600"
              value={config.distanceUnit}
              onChange={(e) =>
                update({ ...config, distanceUnit: e.target.value as DistanceUnit })
              }
            >
              <option value="km">Kilometres</option>
              <option value="mi">Miles</option>
            </select>
          </div>

          <div>
            <label
              className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1"
              htmlFor="teslamate-temp-unit"
            >
              Temperature unit
            </label>
            <select
              id="teslamate-temp-unit"
              aria-label="Temperature unit"
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600"
              value={config.temperatureUnit}
              onChange={(e) =>
                update({ ...config, temperatureUnit: e.target.value as TemperatureUnit })
              }
            >
              <option value="c">Celsius</option>
              <option value="f">Fahrenheit</option>
            </select>
          </div>

          <div>
            <label
              className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1"
              htmlFor="teslamate-pressure-unit"
            >
              Pressure unit
            </label>
            <select
              id="teslamate-pressure-unit"
              aria-label="Pressure unit"
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600"
              value={config.pressureUnit}
              onChange={(e) =>
                update({ ...config, pressureUnit: e.target.value as PressureUnit })
              }
            >
              <option value="bar">Bar</option>
              <option value="psi">PSI</option>
            </select>
          </div>

          <div>
            <label
              className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1"
              htmlFor="teslamate-range-type"
            >
              Range type
            </label>
            <select
              id="teslamate-range-type"
              aria-label="Range type"
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600"
              value={config.rangeType}
              onChange={(e) =>
                update({ ...config, rangeType: e.target.value as RangeType })
              }
            >
              <option value="ideal">Ideal</option>
              <option value="est">Estimated</option>
              <option value="rated">Rated</option>
            </select>
          </div>

          <div>
            <label
              className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1"
              htmlFor="teslamate-power-max-kw"
            >
              Gauge full power (kW)
            </label>
            <input
              id="teslamate-power-max-kw"
              aria-label="Gauge full power in kilowatts"
              type="number"
              min={1}
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600"
              value={config.powerGaugeMaxKw}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value > 0)
                  update({ ...config, powerGaugeMaxKw: Math.round(value) });
              }}
            />
          </div>

          <div>
            <label
              className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1"
              htmlFor="teslamate-power-regen-kw"
            >
              Gauge regen limit (kW)
            </label>
            <input
              id="teslamate-power-regen-kw"
              aria-label="Gauge regen limit in kilowatts"
              type="number"
              min={1}
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600"
              value={config.powerGaugeRegenMaxKw}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value > 0)
                  update({ ...config, powerGaugeRegenMaxKw: Math.round(value) });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
