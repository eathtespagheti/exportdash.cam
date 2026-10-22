/**
 * The Grafana client.
 *
 * This is the only module in the integration that touches HTTP. Everything
 * else works with parsed frames, so the transport can change (direct to the
 * user's Grafana, or same-origin through the bundled nginx proxy) without
 * touching the logic.
 *
 * Grafana is a query proxy, not a metrics store: the client sends SQL through
 * `POST /api/ds/query` and Grafana executes it against the TeslaMate
 * Postgres datasource behind it.
 */

import type { GrafanaErrorKind, SqlQuery } from "./types";

/** An error from the Grafana API, classified so the UI can explain it. */
export class GrafanaError extends Error {
  readonly kind: GrafanaErrorKind;

  constructor(kind: GrafanaErrorKind, message: string) {
    super(message);
    this.name = "GrafanaError";
    this.kind = kind;
  }
}

export interface GrafanaConnection {
  /** Absolute (`https://…`) or relative (`/grafana-proxy`). */
  baseUrl: string;
  token: string | null;
}

export interface DatasourceInfo {
  uid: string;
  name: string;
  type: string;
}

/** A parsed Grafana data frame: column-oriented, with the field names in order. */
export interface Frame {
  fields: string[];
  columns: Record<string, unknown[]>;
  rowCount: number;
}

/**
 * Joins a base URL and a path with exactly one slash between them.
 *
 * Exported separately because it is the pure part, and the part most likely to
 * be wrong: the base may or may not have a trailing slash, and the path may or
 * may not have a leading one.
 */
export function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Origins that have answered at least one request.
 *
 * The browser reports a CORS rejection and a genuine network failure
 * identically — both are a rejected `fetch`. This set is the only signal
 * available: if an origin has worked before and now fails, the most likely
 * cause is that the response stopped carrying `Access-Control-Allow-Origin`.
 * It is a heuristic, not a certainty, so the message says so.
 */
const succeededOrigins = new Set<string>();

function isAbsolute(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Classifies a rejected fetch. Same-origin requests can never be a CORS problem. */
function kindForFetchFailure(url: string): GrafanaErrorKind {
  if (!isAbsolute(url)) return "network";
  try {
    const origin = new URL(url).origin;
    return succeededOrigins.has(origin) ? "cors" : "network";
  } catch {
    return "network";
  }
}

async function request(
  conn: GrafanaConnection,
  url: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (conn.token) headers.Authorization = `Bearer ${conn.token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GrafanaError(
      kindForFetchFailure(url),
      `Could not reach Grafana at ${conn.baseUrl}.`,
    );
  }

  if (isAbsolute(url)) {
    try {
      succeededOrigins.add(new URL(url).origin);
    } catch {
      /* not a parseable URL; nothing to record */
    }
  }

  if (!response.ok) {
    const kind: GrafanaErrorKind =
      response.status === 401 || response.status === 403
        ? "auth"
        : response.status === 404
          ? "notFound"
          : "query";
    throw new GrafanaError(kind, `Grafana responded ${response.status}.`);
  }

  return response;
}

/** Parses one Grafana frame into a column-oriented `Frame`. */
function parseFrame(raw: unknown): Frame {
  const frame = (raw ?? {}) as {
    schema?: { fields?: Array<{ name?: string }> };
    data?: { values?: unknown[][] };
  };
  const fields = (frame.schema?.fields ?? []).map((f) => String(f?.name ?? ""));
  const values = Array.isArray(frame.data?.values) ? frame.data.values : [];

  const columns: Record<string, unknown[]> = {};
  fields.forEach((name, i) => {
    columns[name] = Array.isArray(values[i]) ? values[i] : [];
  });

  const first = values[0];
  const rowCount = Array.isArray(first) ? first.length : 0;
  return { fields, columns, rowCount };
}

/**
 * Runs SQL through Grafana and returns the parsed frames, keyed by `refId`.
 *
 * Grafana reports a failure either as a non-2xx response or, for a single bad
 * statement among several, as a per-query `error` inside an otherwise
 * successful body. Both become a `GrafanaError` with kind `query`.
 */
export async function queryFrames(
  conn: GrafanaConnection,
  queries: SqlQuery[],
): Promise<Record<string, Frame>> {
  const url = buildUrl(conn.baseUrl, "/api/ds/query");
  const response = await request(conn, url, "POST", {
    queries,
    from: "now-24h",
    to: "now",
  });

  const body = (await response.json()) as {
    results?: Record<string, { error?: string; frames?: unknown[] }>;
  };
  const results = body.results ?? {};

  for (const result of Object.values(results)) {
    if (result?.error) {
      throw new GrafanaError("query", result.error);
    }
  }

  const frames: Record<string, Frame> = {};
  for (const [refId, result] of Object.entries(results)) {
    frames[refId] = parseFrame((result.frames ?? [])[0]);
  }
  return frames;
}

/**
 * Lists the datasources Grafana can query, so the app can find the one
 * holding the TeslaMate schema.
 */
export async function listDatasources(
  conn: GrafanaConnection,
): Promise<DatasourceInfo[]> {
  const url = buildUrl(conn.baseUrl, "/api/datasources");
  const response = await request(conn, url, "GET");

  const body = await response.json();
  if (!Array.isArray(body)) return [];

  return body.map((raw) => {
    const d = raw as { uid?: unknown; name?: unknown; type?: unknown };
    return {
      uid: String(d.uid ?? ""),
      name: String(d.name ?? ""),
      type: String(d.type ?? ""),
    };
  });
}
