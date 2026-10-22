/**
 * Shared types for the TeslaMate trip integration.
 *
 * No logic lives here. Everything the pure modules and the React layer pass
 * between each other is declared in this file, so the shapes stay consistent
 * across module boundaries.
 */

export type RangeType = "ideal" | "est" | "rated";
export type DistanceUnit = "km" | "mi";
export type TemperatureUnit = "c" | "f";
export type PressureUnit = "bar" | "psi";
export type ElevationUnit = "m" | "ft";
export type PanelCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Everything the user can configure about the integration. */
export interface TeslaMateConfig {
  /**
   * Whether the integration is switched on. Off until the user connects, so
   * the app never reaches out to a Grafana nobody asked it to.
   */
  enabled: boolean;
  /** Absolute (`https://…`) → direct transport; relative (`/grafana-proxy`) → same-origin. */
  grafanaUrl: string;
  /** Service-account token. Only persisted when `rememberToken` is true. */
  token: string | null;
  rememberToken: boolean;
  datasourceUid: string | null;
  carId: number | null;
  /** Recording location's offset east of UTC, in minutes. `null` = browser timezone. */
  tzOffsetMinutes: number | null;
  rangeType: RangeType;
  distanceUnit: DistanceUnit;
  temperatureUnit: TemperatureUnit;
  pressureUnit: PressureUnit;
  elevationUnit: ElevationUnit;
  liveFields: string[];
  tripFields: string[];
  exportLiveFields: string[];
  panelCorner: PanelCorner;
}

export interface CarInfo {
  id: number;
  name: string;
  model: string | null;
}

/**
 * One TeslaMate `drives` row. Every aggregate is nullable because an
 * in-progress drive (`endMs === null`) has not been summarised yet, and an
 * older TeslaMate may not record some of them at all.
 */
export interface TripSummary {
  id: number;
  startMs: number;
  /** `null` while the drive is still in progress. */
  endMs: number | null;
  distanceKm: number | null;
  durationMin: number | null;
  speedMaxKmh: number | null;
  powerMaxKw: number | null;
  powerMinKw: number | null;
  ascentM: number | null;
  descentM: number | null;
  outsideTempAvgC: number | null;
  insideTempAvgC: number | null;
  startIdealRangeKm: number | null;
  endIdealRangeKm: number | null;
  startKm: number | null;
  endKm: number | null;
  efficiencyKwhPerKm: number | null;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
  startPlace: string | null;
  endPlace: string | null;
}

/**
 * One 1 Hz row of the TeslaMate `positions` series.
 *
 * Sparse columns (tire pressures, temperatures) are `null` for most rows —
 * they are recorded only every 15–40 seconds — and are carried forward by
 * `series.ts` rather than interpolated.
 */
export interface PositionSample {
  tMs: number;
  speedKmh: number | null;
  powerKw: number | null;
  batteryPct: number | null;
  usableBatteryPct: number | null;
  odometerKm: number | null;
  elevationM: number | null;
  idealRangeKm: number | null;
  estRangeKm: number | null;
  ratedRangeKm: number | null;
  tpmsFl: number | null;
  tpmsFr: number | null;
  tpmsRl: number | null;
  tpmsRr: number | null;
  outsideTempC: number | null;
  insideTempC: number | null;
  latitude: number | null;
  longitude: number | null;
}

/** A position series, sorted ascending by `tMs`. */
export interface TripSeries {
  samples: PositionSample[];
}

/** Which columns the connected TeslaMate actually has. */
export interface AvailableColumns {
  positions: Set<string>;
  drives: Set<string>;
  cars: Set<string>;
  addresses: Set<string>;
}

/** One SQL statement in a `/api/ds/query` request. */
export interface SqlQuery {
  refId: string;
  rawSql: string;
}

export type GrafanaErrorKind =
  | "network"
  | "auth"
  | "cors"
  | "query"
  | "noDatasource"
  | "notFound";
