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
import { parseCars, parseSamples, parseTrips } from '@/lib/teslamate/parse';
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
