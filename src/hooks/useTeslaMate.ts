'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  GrafanaError,
  listDatasources,
  queryFrames,
  type Frame,
  type GrafanaConnection,
} from '@/lib/teslamate/client';
import { loadTeslaMateConfig, resolveBaseUrl } from '@/lib/teslamate/config';
import { clipWallClockMs, selectTripForClip } from '@/lib/teslamate/match';
import {
  carsQuery,
  positionsQuery,
  probeSchemaQuery,
  tripQuery,
} from '@/lib/teslamate/queries';
import { buildSeries, sampleAt } from '@/lib/teslamate/series';
import { parseSchemaProbe } from '@/lib/teslamate/schema';
import type {
  AvailableColumns,
  CarInfo,
  PositionSample,
  TripSeries,
  TripSummary,
  TeslaMateConfig,
} from '@/lib/teslamate/types';
import type { VideoSequence } from '@/types/video';

export type TeslaMateStatus = 'unconfigured' | 'loading' | 'ready' | 'error';

export interface TeslaMateState {
  status: TeslaMateStatus;
  error: GrafanaError | null;
  cars: CarInfo[];
  /** The trip the clip at this moment belongs to, or null. */
  tripForMoment(momentIndex: number): TripSummary | null;
  /** The live values at this moment and offset within the clip, or null. */
  sampleForMoment(momentIndex: number, localTimeSec: number): PositionSample | null;
  /** Re-reads the settings and reconnects. */
  reload(): void;
}

/** The datasource type that holds a TeslaMate Postgres schema. */
const POSTGRES_DATASOURCE_TYPE = 'grafana-postgresql-datasource';

interface CachedData {
  trips: TripSummary[];
  series: TripSeries;
}

/** What the connection looks like: which datasource, what columns, which cars. */
interface Discovery {
  datasource: { uid: string; type: string };
  columns: AvailableColumns;
  cars: CarInfo[];
}

/**
 * Trip and series data, cached by what it describes.
 *
 * Kept outside the hook so re-opening a sequence — the common case when
 * scrubbing back and forth — costs no queries at all.
 */
const seriesCache = new Map<string, CachedData>();

/**
 * The discovery result, cached by Grafana address.
 *
 * The datasource and the TeslaMate schema change only when the user changes
 * them, so re-connecting does not need to ask again.
 */
const discoveryCache = new Map<string, Discovery>();

const EMPTY_FRAME: Frame = { fields: [], columns: {}, rowCount: 0 };

function numberAt(frame: Frame | undefined, name: string, index: number): number | null {
  const column = frame?.columns[name];
  if (!column) return null;
  const value = column[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringAt(frame: Frame | undefined, name: string, index: number): string | null {
  const column = frame?.columns[name];
  if (!column) return null;
  const value = column[index];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseCars(frame: Frame | undefined): CarInfo[] {
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

function parseTrips(frame: Frame | undefined): TripSummary[] {
  const trips: TripSummary[] = [];
  for (let i = 0; i < (frame?.rowCount ?? 0); i++) {
    trips.push({
      id: numberAt(frame, "id", i) ?? 0,
      startMs: numberAt(frame, "start_date", i) ?? 0,
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

function parseSamples(frame: Frame | undefined): PositionSample[] {
  const samples: PositionSample[] = [];
  for (let i = 0; i < (frame?.rowCount ?? 0); i++) {
    const sample = { tMs: numberAt(frame, "t_ms", i) ?? 0 } as PositionSample;
    for (const [column, field] of POSITION_FIELDS) {
      (sample as unknown as Record<string, unknown>)[field] = numberAt(frame, column, i);
    }
    samples.push(sample);
  }
  return samples;
}

/**
 * Connects ExportDash to a TeslaMate instance and exposes the trip data for
 * the sequence being viewed.
 *
 * Nothing is requested until the integration is switched on, and the only
 * requests made are to the user's own Grafana.
 */
export function useTeslaMate(sequence: VideoSequence | null): TeslaMateState {
  const [config, setConfig] = useState<TeslaMateConfig>(() => loadTeslaMateConfig());
  const [status, setStatus] = useState<TeslaMateStatus>("unconfigured");
  const [error, setError] = useState<GrafanaError | null>(null);
  const [cars, setCars] = useState<CarInfo[]>([]);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [series, setSeries] = useState<TripSeries | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!config.enabled || !config.grafanaUrl.trim()) {
        setStatus("unconfigured");
        setError(null);
        return;
      }

      setStatus("loading");
      setError(null);

      try {
        const { baseUrl } = resolveBaseUrl(config);
        const connection: GrafanaConnection = {
          baseUrl,
          token: config.token,
          datasource: null,
        };

        const discoveryKey = `${baseUrl}|${config.datasourceUid ?? ""}`;
        let discovery = discoveryCache.get(discoveryKey);

        if (!discovery) {
          const datasources = await listDatasources(connection);
          const postgres = datasources.filter(
            (d) => d.type === POSTGRES_DATASOURCE_TYPE,
          );
          if (postgres.length === 0) {
            throw new GrafanaError(
              "noDatasource",
              "No TeslaMate datasource was found in Grafana.",
            );
          }

          const chosen =
            (config.datasourceUid
              ? postgres.find((d) => d.uid === config.datasourceUid)
              : undefined) ?? postgres[0];

          const probeConnection: GrafanaConnection = {
            ...connection,
            datasource: { uid: chosen.uid, type: chosen.type },
          };
          const frames = await queryFrames(probeConnection, [
            probeSchemaQuery(),
            carsQuery(),
          ]);

          discovery = {
            datasource: { uid: chosen.uid, type: chosen.type },
            columns: parseSchemaProbe(frames.schema ?? EMPTY_FRAME),
            cars: parseCars(frames.cars),
          };
          discoveryCache.set(discoveryKey, discovery);
        }

        const queryConnection: GrafanaConnection = {
          ...connection,
          datasource: discovery.datasource,
        };
        const columns = discovery.columns;
        const carList = discovery.cars;
        const carId = config.carId ?? carList[0]?.id ?? null;

        let resolvedTrips: TripSummary[] = [];
        let resolvedSeries: TripSeries | null = null;

        if (sequence && carId !== null) {
          const startMs = clipWallClockMs(sequence.startTime, 0, config.tzOffsetMinutes);
          const endMs = clipWallClockMs(sequence.endTime, 0, config.tzOffsetMinutes);
          const key = `${discovery.datasource.uid}|${carId}|${startMs}|${endMs}`;

          const cached = seriesCache.get(key);
          if (cached) {
            resolvedTrips = cached.trips;
            resolvedSeries = cached.series;
          } else {
            const data = await queryFrames(queryConnection, [
              tripQuery(carId, startMs, endMs, columns),
              positionsQuery(carId, startMs, endMs, columns),
            ]);
            resolvedTrips = parseTrips(data.trip);
            resolvedSeries = buildSeries(parseSamples(data.positions));
            seriesCache.set(key, { trips: resolvedTrips, series: resolvedSeries });
          }
        }

        if (cancelled) return;
        setCars(carList);
        setTrips(resolvedTrips);
        setSeries(resolvedSeries);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof GrafanaError
            ? e
            : new GrafanaError("network", e instanceof Error ? e.message : String(e)),
        );
        setStatus("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [config, sequence]);

  const tripForMoment = useCallback(
    (momentIndex: number): TripSummary | null => {
      const moment = sequence?.moments[momentIndex];
      if (!moment) return null;
      const start = clipWallClockMs(moment.timestamp, 0, config.tzOffsetMinutes);
      const end = clipWallClockMs(
        moment.timestamp,
        moment.duration,
        config.tzOffsetMinutes,
      );
      return selectTripForClip(start, end, trips);
    },
    [sequence, trips, config.tzOffsetMinutes],
  );

  const sampleForMoment = useCallback(
    (momentIndex: number, localTimeSec: number): PositionSample | null => {
      const moment = sequence?.moments[momentIndex];
      if (!moment || !series) return null;
      const at = clipWallClockMs(
        moment.timestamp,
        localTimeSec,
        config.tzOffsetMinutes,
      );
      return sampleAt(series, at);
    },
    [sequence, series, config.tzOffsetMinutes],
  );

  const reload = useCallback(() => {
    setConfig(loadTeslaMateConfig());
  }, []);

  return { status, error, cars, tripForMoment, sampleForMoment, reload };
}
