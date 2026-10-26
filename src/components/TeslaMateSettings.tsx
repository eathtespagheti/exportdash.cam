'use client';

import { useState } from 'react';
import { IconX, IconPlugConnected, IconCheck, IconAlertTriangle } from '@tabler/icons-react';
import {
  GrafanaError,
  grafanaErrorMessage,
  listDatasources,
  queryFrames,
  type DatasourceInfo,
  type GrafanaConnection,
} from '@/lib/teslamate/client';
import {
  loadTeslaMateConfig,
  resolveBaseUrl,
  saveTeslaMateConfig,
} from '@/lib/teslamate/config';
import { carsQuery, probeSchemaQuery } from '@/lib/teslamate/queries';
import { parseCars } from '@/lib/teslamate/parse';
import type { CarInfo, TeslaMateConfig } from '@/lib/teslamate/types';

interface TeslaMateSettingsProps {
  onClose: () => void;
  /** Called after the settings are saved, so the app can reconnect. */
  onSaved: () => void;
}

const POSTGRES_DATASOURCE_TYPE = 'grafana-postgresql-datasource';

const inputClass =
  'w-full bg-gray-800 text-gray-100 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:border-blue-500 focus:outline-none';

const labelClass = 'block text-xs text-gray-400 mb-1';

/**
 * Connection settings for the TeslaMate integration.
 *
 * The token is a Grafana **service account** token with Viewer access — the
 * app only ever issues read-only SQL, so it never needs more, and a Viewer
 * account is enough for a datasource query.
 */
export function TeslaMateSettings({ onClose, onSaved }: TeslaMateSettingsProps) {
  const [config] = useState<TeslaMateConfig>(() => loadTeslaMateConfig());
  const [url, setUrl] = useState(config.grafanaUrl);
  const [token, setToken] = useState(config.token ?? '');
  const [remember, setRemember] = useState(config.rememberToken);
  const [datasourceUid, setDatasourceUid] = useState(config.datasourceUid ?? '');
  const [carId, setCarId] = useState<string>(config.carId ? String(config.carId) : '');
  const [tzOffset, setTzOffset] = useState(
    config.tzOffsetMinutes === null ? '' : String(config.tzOffsetMinutes),
  );
  const [tripLink, setTripLink] = useState(config.tripLinkTemplate);

  const [datasources, setDatasources] = useState<DatasourceInfo[]>([]);
  const [cars, setCars] = useState<CarInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  /** The connection the form currently describes. */
  const currentConnection = (): GrafanaConnection => {
    const { baseUrl } = resolveBaseUrl({ ...config, grafanaUrl: url });
    return { baseUrl, token: token.trim() || null, datasource: null };
  };

  const testConnection = async () => {
    setTesting(true);
    setError(null);
    setConnected(false);

    try {
      const connection = currentConnection();
      const all = await listDatasources(connection);
      const postgres = all.filter((d) => d.type === POSTGRES_DATASOURCE_TYPE);

      if (postgres.length === 0) {
        throw new GrafanaError(
          'noDatasource',
          'No TeslaMate datasource found in Grafana.',
        );
      }

      const chosen =
        (datasourceUid ? postgres.find((d) => d.uid === datasourceUid) : undefined) ??
        postgres[0];

      const frames = await queryFrames(
        { ...connection, datasource: { uid: chosen.uid, type: chosen.type } },
        [probeSchemaQuery(), carsQuery()],
      );

      setDatasources(postgres);
      setCars(parseCars(frames.cars));
      setDatasourceUid(chosen.uid);
      setConnected(true);
    } catch (e) {
      setError(
        grafanaErrorMessage(
          e instanceof GrafanaError
            ? e
            : new GrafanaError('network', e instanceof Error ? e.message : String(e)),
        ),
      );
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    const offset = tzOffset.trim() === '' ? null : Number(tzOffset);

    saveTeslaMateConfig({
      ...config,
      enabled: true,
      grafanaUrl: url.trim(),
      token: token.trim() || null,
      rememberToken: remember,
      datasourceUid: datasourceUid || null,
      carId: carId === '' ? null : Number(carId),
      tzOffsetMinutes:
        offset !== null && Number.isFinite(offset) ? Math.trunc(offset) : null,
      tripLinkTemplate: tripLink.trim(),
    });

    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-gray-900 border border-gray-800 shadow-2xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <IconX size={18} />
        </button>

        <div className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <IconPlugConnected size={22} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">TeslaMate</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                Match your clips to their TeslaMate trips and show the trip metrics.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="teslamate-url">
                Grafana URL
              </label>
              <input
                id="teslamate-url"
                className={inputClass}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="/grafana-proxy"
              />
              <p className="text-xs text-gray-500 mt-1">
                Use <code className="text-gray-400">/grafana-proxy</code> for the bundled proxy
                (no CORS needed), or your Grafana address directly.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="teslamate-token">
                Service account token
              </label>
              <input
                id="teslamate-token"
                type="password"
                className={inputClass}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="glsa_…"
              />
              <label className="flex items-center gap-2 mt-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Remember the token on this device"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember the token on this device
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Leave empty if your Grafana allows anonymous access, or if the
                deployment already sets <code className="text-gray-400">GRAFANA_TOKEN</code> —
                then the token never reaches the browser at all.
              </p>
            </div>

            {datasources.length > 1 && (
              <div>
                <label className={labelClass} htmlFor="teslamate-datasource">
                  Datasource
                </label>
                <select
                  id="teslamate-datasource"
                    className={inputClass}
                  value={datasourceUid}
                  onChange={(e) => setDatasourceUid(e.target.value)}
                >
                  {datasources.map((d) => (
                    <option key={d.uid} value={d.uid}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {cars.length > 0 && (
              <div>
                <label className={labelClass} htmlFor="teslamate-car">
                  Car
                </label>
                <select
                  id="teslamate-car"
                    className={inputClass}
                  value={carId}
                  onChange={(e) => setCarId(e.target.value)}
                >
                  <option value="">First car</option>
                  {cars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.model ? ` (${c.model})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={labelClass} htmlFor="teslamate-trip-link">
                Trip dashboard link
              </label>
              <input
                id="teslamate-trip-link"
                className={inputClass}
                value={tripLink}
                onChange={(e) => setTripLink(e.target.value)}
                placeholder="https://grafana.example/d/abc/drive-details?var-drive_id={driveId}"
              />
              <p className="text-xs text-gray-500 mt-1">
                Optional. Shown as &ldquo;Trip stats&rdquo; on the panel. Placeholders:{' '}
                <code className="text-gray-400">{'{driveId}'}</code>,{' '}
                <code className="text-gray-400">{'{carId}'}</code>,{' '}
                <code className="text-gray-400">{'{start}'}</code>,{' '}
                <code className="text-gray-400">{'{end}'}</code>.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="teslamate-tz">
                Recording timezone offset
              </label>
              <input
                id="teslamate-tz"
                className={inputClass}
                value={tzOffset}
                onChange={(e) => setTzOffset(e.target.value)}
                inputMode="numeric"
                placeholder="minutes east of UTC"
              />
              <p className="text-xs text-gray-500 mt-1">
                Leave empty to use this computer&apos;s timezone. Only needed if the clips were
                recorded elsewhere.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-900/40 border border-red-800/60 p-3">
              <IconAlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-red-200">{error}</span>
            </div>
          )}

          {connected && !error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-900/30 border border-green-800/60 p-3">
              <IconCheck size={16} className="text-green-400" />
              <span className="text-xs text-green-200">Connected to Grafana.</span>
            </div>
          )}

          <div className="mt-6 flex items-center gap-2">
            <button
              onClick={testConnection}
              disabled={testing}
              className="px-3 py-2 rounded-lg bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
