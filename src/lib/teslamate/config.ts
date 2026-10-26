/**
 * Persistence for the TeslaMate integration settings.
 *
 * Follows the pattern the app already uses for its layout and overlay
 * settings: a single JSON blob in localStorage, merged over the defaults on
 * read so a setting added in a later version is simply absent until chosen.
 *
 * The Grafana token is the one value that is not stored by default. It is
 * only written when the user explicitly asks for it to be remembered, and it
 * is dropped on read otherwise, so a token left behind in storage cannot
 * reappear unnoticed.
 */

import { TRIP_FIELDS } from "./fields";
import type { TeslaMateConfig } from "./types";

const STORAGE_KEY = "tesla-cam-teslamate-config";

/**
 * Every trip field except the geocoded place names, which are street
 * addresses and must not land in a shared video unless asked for.
 */
const TRIP_EXPORT_DEFAULT = TRIP_FIELDS.map((f) => f.key).filter(
  (key) => key !== "trip_start_place" && key !== "trip_end_place",
);

export const DEFAULT_TESLAMATE_CONFIG: TeslaMateConfig = {
  // Off until the user connects, so the app never calls out to a Grafana
  // nobody asked it to.
  enabled: false,
  // The bundled proxy, so a self-hosted deployment needs no CORS setup.
  grafanaUrl: "/grafana-proxy",
  token: null,
  rememberToken: false,
  datasourceUid: null,
  carId: null,
  tzOffsetMinutes: null,
  rangeType: "ideal",
  distanceUnit: "km",
  temperatureUnit: "c",
  pressureUnit: "bar",
  elevationUnit: "m",
  liveFields: ["battery", "power"],
  tripFields: TRIP_EXPORT_DEFAULT,
  exportLiveFields: [],
  panelCorner: "top-right",
  tripLinkTemplate: "",
};

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? [...value]
    : [...fallback];
}

/** Reads the stored settings, merged over the defaults. */
export function loadTeslaMateConfig(): TeslaMateConfig {
  let stored: Partial<TeslaMateConfig> = {};

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        stored = parsed as Partial<TeslaMateConfig>;
      }
    }
  } catch {
    stored = {};
  }

  return {
    ...DEFAULT_TESLAMATE_CONFIG,
    ...stored,
    // A tampered or legacy blob must not be able to crash the app with a
    // non-string address.
    grafanaUrl:
      typeof stored.grafanaUrl === "string"
        ? stored.grafanaUrl
        : DEFAULT_TESLAMATE_CONFIG.grafanaUrl,
    tripLinkTemplate:
      typeof stored.tripLinkTemplate === "string"
        ? stored.tripLinkTemplate
        : DEFAULT_TESLAMATE_CONFIG.tripLinkTemplate,
    enabled: stored.enabled === true,
    // A token is only ever handed back when the user asked for it to be kept.
    token:
      stored.rememberToken === true && typeof stored.token === "string"
        ? stored.token
        : null,
    liveFields: stringArray(stored.liveFields, DEFAULT_TESLAMATE_CONFIG.liveFields),
    tripFields: stringArray(
      stored.tripFields,
      DEFAULT_TESLAMATE_CONFIG.tripFields,
    ),
    exportLiveFields: stringArray(
      stored.exportLiveFields,
      DEFAULT_TESLAMATE_CONFIG.exportLiveFields,
    ),
  };
}

/** Writes the settings, keeping the token only when it is meant to be kept. */
export function saveTeslaMateConfig(cfg: TeslaMateConfig): void {
  try {
    const toStore: TeslaMateConfig = {
      ...cfg,
      token: cfg.rememberToken ? cfg.token : null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // Storage may be unavailable (private mode, quota). The settings then
    // last for this session only, which is no worse than not being asked.
  }
}

/**
 * How to reach Grafana: through the bundled same-origin proxy, or directly.
 *
 * A relative URL is same-origin by definition, so it needs no CORS setup; an
 * absolute URL is a different origin and does.
 */
export function resolveBaseUrl(
  cfg: TeslaMateConfig,
): { baseUrl: string; mode: "direct" | "proxy" } {
  const baseUrl = cfg.grafanaUrl.trim();
  const isAbsolute = /^https?:\/\//i.test(baseUrl) || baseUrl.startsWith("//");
  return { baseUrl, mode: isAbsolute ? "direct" : "proxy" };
}
