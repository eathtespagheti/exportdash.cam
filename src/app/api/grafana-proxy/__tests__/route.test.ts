import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Loads the route with a given upstream, since it reads the env at import. */
async function loadRoute(upstream: string) {
  vi.stubEnv("GRAFANA_UPSTREAM", upstream);
  vi.resetModules();
  return await import("../[...path]/route");
}

function context(segments: string[]) {
  return { params: Promise.resolve({ path: segments }) };
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost/grafana-proxy/${path}`, init);
}

function upstreamResponse(body: unknown, status = 200) {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  };
}

describe("grafana proxy route", () => {
  it("relays the query endpoint with the caller's token and body", async () => {
    const route = await loadRoute("http://grafana:3000");
    fetchMock.mockResolvedValue(upstreamResponse({ results: {} }));

    const response = await route.POST(
      request("api/ds/query", {
        method: "POST",
        headers: { authorization: "Bearer tok", "content-type": "application/json" },
        body: JSON.stringify({ queries: [] }),
      }),
      context(["api", "ds", "query"]),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://grafana:3000/api/ds/query");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.body).toBe(JSON.stringify({ queries: [] }));
    expect(response.status).toBe(200);
  });

  it("relays datasource discovery", async () => {
    const route = await loadRoute("http://grafana:3000/");
    fetchMock.mockResolvedValue(upstreamResponse([{ uid: "X" }]));

    const response = await route.GET(
      request("api/datasources", { headers: { authorization: "Bearer tok" } }),
      context(["api", "datasources"]),
    );

    const [url, init] = fetchMock.mock.calls[0];
    // The trailing slash on the configured upstream must not double up.
    expect(url).toBe("http://grafana:3000/api/datasources");
    expect(init.method).toBe("GET");
    expect(response.status).toBe(200);
  });

  it("refuses any path the integration does not use", async () => {
    const route = await loadRoute("http://grafana:3000");

    const response = await route.GET(
      request("api/org", { headers: { authorization: "Bearer tok" } }),
      context(["api", "org"]),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the admin surface", async () => {
    const route = await loadRoute("http://grafana:3000");

    const response = await route.GET(
      request("api/admin/users", { headers: { authorization: "Bearer tok" } }),
      context(["api", "admin", "users"]),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is disabled when no upstream is configured", async () => {
    const route = await loadRoute("");

    const response = await route.GET(
      request("api/datasources"),
      context(["api", "datasources"]),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a Grafana that cannot be reached", async () => {
    const route = await loadRoute("http://grafana:3000");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const response = await route.POST(
      request("api/ds/query", { method: "POST", body: "{}" }),
      context(["api", "ds", "query"]),
    );

    expect(response.status).toBe(502);
  });

  it("passes Grafana's status through", async () => {
    const route = await loadRoute("http://grafana:3000");
    fetchMock.mockResolvedValue(upstreamResponse({ message: "Unauthorized" }, 401));

    const response = await route.POST(
      request("api/ds/query", { method: "POST", body: "{}" }),
      context(["api", "ds", "query"]),
    );

    expect(response.status).toBe(401);
  });
});
