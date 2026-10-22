/**
 * The metric field catalogue.
 *
 * Every value the integration can display is declared here, together with how
 * it is formatted. The user picks fields by key; the catalogue is the single
 * place that decides what a key means, what unit it is in, and how a missing
 * value looks.
 *
 * Missing data is always an em dash. It is never 0 — a trip that reports no
 * tire pressure did not measure zero tire pressure.
 */

import type {
  DistanceUnit,
  ElevationUnit,
  PressureUnit,
  TemperatureUnit,
  TripSummary,
} from "./types";

/** Rendered wherever a value is missing or unusable. */
export const DASH = "—";

export interface Units {
  speedUnit: "mph" | "kmh";
  distanceUnit: DistanceUnit;
  temperatureUnit: TemperatureUnit;
  pressureUnit: PressureUnit;
  elevationUnit: ElevationUnit;
}

export interface FieldDef {
  key: string;
  label: string;
  group: "trip" | "live";
  /**
   * Renders the value. `value` is authoritative when it is a finite number;
   * `trip` is the fallback source for the two derived fields. Returns `DASH`
   * for anything missing — never `NaN`, never `undefined`.
   */
  format(value: unknown, units: Units, trip?: TripSummary): string;
}

const KM_PER_MILE = 0.621371;
const PSI_PER_BAR = 14.5038;
const FT_PER_M = 3.28084;

/** A finite number, or null. Rejects null, undefined, NaN, Infinity and non-numbers. */
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDistance(v: number, u: Units): string {
  return u.distanceUnit === "mi"
    ? `${(v * KM_PER_MILE).toFixed(1)} mi`
    : `${v.toFixed(1)} km`;
}

function formatSpeed(v: number, u: Units): string {
  return u.speedUnit === "mph"
    ? `${Math.round(v * KM_PER_MILE)} mph`
    : `${Math.round(v)} km/h`;
}

function formatTemperature(v: number, u: Units): string {
  return u.temperatureUnit === "f"
    ? `${((v * 9) / 5 + 32).toFixed(1)} °F`
    : `${v.toFixed(1)} °C`;
}

function formatPressure(v: number, u: Units): string {
  return u.pressureUnit === "psi"
    ? `${(v * PSI_PER_BAR).toFixed(1)} psi`
    : `${v.toFixed(1)} bar`;
}

function formatElevation(v: number, u: Units): string {
  return u.elevationUnit === "ft"
    ? `${Math.round(v * FT_PER_M)} ft`
    : `${Math.round(v)} m`;
}

function formatPercent(v: number): string {
  return `${Math.round(v)}%`;
}

/** Negative power is regenerative braking, which is worth calling out. */
function formatPower(v: number): string {
  return v < 0 ? `${Math.round(Math.abs(v))} kW regen` : `${Math.round(v)} kW`;
}

function formatEnergy(v: number): string {
  return `${v.toFixed(1)} kWh`;
}

function formatDuration(minutes: number): string {
  if (minutes < 0) return DASH;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

function formatPlace(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : DASH;
}

/** Wraps a numeric formatter so anything missing becomes an em dash. */
function numeric(format: (v: number, u: Units) => string) {
  return (value: unknown, units: Units): string => {
    const v = finite(value);
    return v === null ? DASH : format(v, units);
  };
}

const tripAvgSpeed: FieldDef = {
  key: "trip_avg_speed",
  label: "Avg speed",
  group: "trip",
  format: (value, units, trip) => {
    const v = finite(value);
    if (v !== null) return formatSpeed(v, units);
    const distance = finite(trip?.distanceKm);
    const duration = finite(trip?.durationMin);
    if (distance === null || duration === null || duration <= 0) return DASH;
    return formatSpeed(distance / (duration / 60), units);
  },
};

const tripEnergy: FieldDef = {
  key: "trip_energy",
  label: "Energy used",
  group: "trip",
  format: (value, units, trip) => {
    const v = finite(value);
    if (v !== null) return formatEnergy(v);
    const start = finite(trip?.startIdealRangeKm);
    const end = finite(trip?.endIdealRangeKm);
    const efficiency = finite(trip?.efficiencyKwhPerKm);
    if (start === null || end === null || efficiency === null) return DASH;
    return formatEnergy((start - end) * efficiency);
  },
};

export const TRIP_FIELDS: FieldDef[] = [
  { key: "trip_distance", label: "Distance", group: "trip", format: numeric(formatDistance) },
  {
    key: "trip_duration",
    label: "Duration",
    group: "trip",
    format: (value) => {
      const v = finite(value);
      return v === null ? DASH : formatDuration(v);
    },
  },
  tripAvgSpeed,
  { key: "trip_max_speed", label: "Max speed", group: "trip", format: numeric(formatSpeed) },
  {
    key: "trip_max_power",
    label: "Max power",
    group: "trip",
    format: numeric((v) => formatPower(v)),
  },
  {
    key: "trip_min_power",
    label: "Max regen",
    group: "trip",
    format: numeric((v) => formatPower(v)),
  },
  tripEnergy,
  { key: "trip_start_battery", label: "Battery start", group: "trip", format: numeric(formatPercent) },
  { key: "trip_end_battery", label: "Battery end", group: "trip", format: numeric(formatPercent) },
  { key: "trip_ascent", label: "Elevation gain", group: "trip", format: numeric(formatElevation) },
  { key: "trip_descent", label: "Elevation loss", group: "trip", format: numeric(formatElevation) },
  { key: "trip_start_place", label: "Start place", group: "trip", format: (value) => formatPlace(value) },
  { key: "trip_end_place", label: "End place", group: "trip", format: (value) => formatPlace(value) },
  {
    key: "trip_outside_temp",
    label: "Outside temp",
    group: "trip",
    format: numeric(formatTemperature),
  },
  {
    key: "trip_inside_temp",
    label: "Inside temp",
    group: "trip",
    format: numeric(formatTemperature),
  },
];

export const LIVE_FIELDS: FieldDef[] = [
  { key: "battery", label: "Battery", group: "live", format: numeric(formatPercent) },
  { key: "usable_battery", label: "Usable battery", group: "live", format: numeric(formatPercent) },
  { key: "power", label: "Power", group: "live", format: numeric((v) => formatPower(v)) },
  { key: "range", label: "Range", group: "live", format: numeric(formatDistance) },
  { key: "odometer", label: "Odometer", group: "live", format: numeric(formatDistance) },
  { key: "elevation", label: "Elevation", group: "live", format: numeric(formatElevation) },
  { key: "tpms_fl", label: "Tire pressure FL", group: "live", format: numeric(formatPressure) },
  { key: "tpms_fr", label: "Tire pressure FR", group: "live", format: numeric(formatPressure) },
  { key: "tpms_rl", label: "Tire pressure RL", group: "live", format: numeric(formatPressure) },
  { key: "tpms_rr", label: "Tire pressure RR", group: "live", format: numeric(formatPressure) },
  { key: "outside_temp", label: "Outside temp", group: "live", format: numeric(formatTemperature) },
  { key: "inside_temp", label: "Inside temp", group: "live", format: numeric(formatTemperature) },
];

const BY_KEY = new Map<string, FieldDef>(
  [...TRIP_FIELDS, ...LIVE_FIELDS].map((f) => [f.key, f]),
);

export function fieldByKey(key: string): FieldDef | undefined {
  return BY_KEY.get(key);
}
