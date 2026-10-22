import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GrafanaError,
  buildUrl,
  listDatasources,
  queryFrames,
} from "@/lib/teslamate/client";
import type { SqlQuery } from "@/lib/teslamate/types";

/** A Grafana /api/ds/query body holding one frame of column-major data. */
function frameBody(fields: string[], values: unknown[][]) {
  return {
    results: {
      A: {
        status: 200,
        frames: [
          {
            schema: { fields: fields.map((name) => ({ name, type: "number" })) },
            data: { values },
          },
        ],
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const QUERY: SqlQuery[] = [{ refId: "A", rawSql: "SELECT 1" }];

/** The datasource every query must name. Grafana rejects a query without one. */
const DS = { uid: "PC98BA2F4D77E1A42", type: "grafana-postgresql-datasource" };

describe("buildUrl", () => {
  it("joins a base URL and a path with exactly one slash", () => {
    expect(buildUrl("/grafana-proxy", "/api/ds/query")).toBe("/grafana-proxy/api/ds/query");
    expect(buildUrl("/grafana-proxy/", "/api/ds/query")).toBe("/grafana-proxy/api/ds/query");
    expect(buildUrl("https://h/grafana", "/api/ds/query")).toBe("https://h/grafana/api/ds/query");
    expect(buildUrl("https://h/grafana/", "/api/ds/query")).toBe("https://h/grafana/api/ds/query");
  });

  it("keeps a base URL that already ends in a path segment", () => {
    expect(buildUrl("https://h", "/api/datasources")).toBe("https://h/api/datasources");
  });
});

describe("queryFrames", () => {
  it("posts to the query endpoint with the refIds and the bearer token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(frameBody(["t", "v"], [[1, 2], [10, 20]])));

    const frames = await queryFrames(
      { baseUrl: "https://h/grafana", token: "tok", datasource: DS },
      QUERY,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://h/grafana/api/ds/query");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");

    const body = JSON.parse(init.body);
    expect(body.queries[0].refId).toBe("A");
    expect(body.queries[0].rawSql).toBe("SELECT 1");
    expect(body.from).toBeDefined();
    expect(body.to).toBeDefined();

    expect(frames.A.fields).toEqual(["t", "v"]);
    expect(frames.A.columns.v).toEqual([10, 20]);
    expect(frames.A.rowCount).toBe(2);
  });

  it("omits the Authorization header when there is no token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(frameBody(["t"], [[1]])));

    await queryFrames({ baseUrl: "https://h", token: null, datasource: DS }, QUERY);

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("names the datasource on every query, as Grafana requires", async () => {
    fetchMock.mockResolvedValue(jsonResponse(frameBody(["t"], [[1]])));

    await queryFrames(
      { baseUrl: "https://h", token: null, datasource: DS },
      [
        { refId: "A", rawSql: "SELECT 1" },
        { refId: "B", rawSql: "SELECT 2" },
      ],
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.queries).toHaveLength(2);
    for (const q of body.queries) {
      expect(q.datasource).toEqual(DS);
    }
  });

  it("declares each query as raw SQL in table format", async () => {
    fetchMock.mockResolvedValue(jsonResponse(frameBody(["t"], [[1]])));

    await queryFrames({ baseUrl: "https://h", token: null, datasource: DS }, QUERY);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const q = body.queries[0];
    // Without these Grafana assumes a time-series query and demands a time
    // column, failing every statement with "db has no time column".
    expect(q.rawQuery).toBe(true);
    expect(q.format).toBe("table");
    expect(typeof q.intervalMs).toBe("number");
    expect(typeof q.maxDataPoints).toBe("number");
  });

  it("refuses to query before a datasource has been chosen", async () => {
    await expect(
      queryFrames({ baseUrl: "https://h", token: null, datasource: null }, QUERY),
    ).rejects.toMatchObject({ kind: "noDatasource" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a frame with empty values as zero rows rather than throwing", async () => {
    fetchMock.mockResolvedValue(jsonResponse(frameBody(["t", "v"], [[], []])));

    const frames = await queryFrames({ baseUrl: "https://h", token: null, datasource: DS }, QUERY);

    expect(frames.A.rowCount).toBe(0);
    expect(frames.A.fields).toEqual(["t", "v"]);
  });

  it("treats a missing frames array as zero rows", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: { A: { status: 200, frames: [] } } }));

    const frames = await queryFrames({ baseUrl: "https://h", token: null, datasource: DS }, QUERY);

    expect(frames.A.rowCount).toBe(0);
  });

  it("maps a 401 to an auth error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Unauthorized" }, 401));

    await expect(queryFrames({ baseUrl: "https://h", token: "bad", datasource: DS }, QUERY)).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("maps a rejected fetch to a network error", async () => {
    // A fresh module instance: the CORS heuristic remembers origins that have
    // answered before, and this test needs the "never contacted" case.
    vi.resetModules();
    const { queryFrames: freshQuery } = await import("@/lib/teslamate/client");

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(freshQuery({ baseUrl: "https://h", token: null, datasource: DS }, QUERY)).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("maps a per-query error in the body to a query error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: { A: { status: 500, error: "db query error: boom" } } }),
    );

    await expect(queryFrames({ baseUrl: "https://h", token: null, datasource: DS }, QUERY)).rejects.toMatchObject({
      kind: "query",
    });
  });

  it("raises a GrafanaError carrying a kind", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));

    const err = await queryFrames({ baseUrl: "https://h", token: "bad", datasource: DS }, QUERY).catch((e) => e);
    expect(err).toBeInstanceOf(GrafanaError);
    expect(err.kind).toBe("auth");
  });
});

describe("cors detection", () => {
  it("reports a cors error when a later request to a previously working origin fails", async () => {
    vi.resetModules();
    const { queryFrames: freshQuery } = await import("@/lib/teslamate/client");

    fetchMock.mockResolvedValueOnce(jsonResponse(frameBody(["t"], [[1]])));
    await freshQuery({ baseUrl: "https://h", token: null, datasource: DS }, QUERY);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(freshQuery({ baseUrl: "https://h", token: null, datasource: DS }, QUERY)).rejects.toMatchObject({
      kind: "cors",
    });
  });
});

describe("listDatasources", () => {
  it("uses GET and returns the datasources", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { uid: "ABC", name: "TeslaMate", type: "grafana-postgresql-datasource" },
        { uid: "DEF", name: "Prom", type: "prometheus" },
      ]),
    );

    const list = await listDatasources({ baseUrl: "https://h", token: null, datasource: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://h/api/datasources");
    expect(init.method).toBe("GET");
    expect(list).toEqual([
      { uid: "ABC", name: "TeslaMate", type: "grafana-postgresql-datasource" },
      { uid: "DEF", name: "Prom", type: "prometheus" },
    ]);
  });

  it("maps a 403 to an auth error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Forbidden" }, 403));

    await expect(listDatasources({ baseUrl: "https://h", token: "bad", datasource: null })).rejects.toMatchObject({
      kind: "auth",
    });
  });
});
