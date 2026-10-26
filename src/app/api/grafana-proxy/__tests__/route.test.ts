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
async function loadRoute(upstream: string, token = "") {
  vi.stubEnv("GRAFANA_UPSTREAM", upstream);
  vi.stubEnv("GRAFANA_TOKEN", token);
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

  it("relays the dashboard search", async () => {
    const route = await loadRoute("http://grafana:3000");
    fetchMock.mockResolvedValue(upstreamResponse([{ title: "Drive Detail" }]));

    const response = await route.GET(
      request("api/search", { headers: { authorization: "Bearer tok" } }),
      context(["api", "search"]),
    );

    expect(fetchMock.mock.calls[0][0]).toBe("http://grafana:3000/api/search");
    expect(response.status).toBe(200);
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

  it("injects the deployment token when the browser sends none", async () => {
    const route = await loadRoute("http://grafana:3000", "glsa_env");
    fetchMock.mockResolvedValue(upstreamResponse({}));

    await route.GET(
      request("api/datasources"),
      context(["api", "datasources"]),
    );

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer glsa_env");
  });

  it("prefers the browser's token over the deployment's", async () => {
    const route = await loadRoute("http://grafana:3000", "glsa_env");
    fetchMock.mockResolvedValue(upstreamResponse({}));

    await route.GET(
      request("api/datasources", { headers: { authorization: "Bearer from-ui" } }),
      context(["api", "datasources"]),
    );

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer from-ui");
  });

  it("reports whether the deployment is configured, without leaking the token", async () => {
    const route = await loadRoute("http://grafana:3000", "glsa_env");

    const response = await route.GET(request("status"), context(["status"]));
    const body = await response.json();

    expect(body).toEqual({ configured: true, tokenConfigured: true });
    expect(JSON.stringify(body)).not.toContain("glsa_env");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unconfigured deployment", async () => {
    const route = await loadRoute("");

    const response = await route.GET(request("status"), context(["status"]));

    expect(await response.json()).toEqual({ configured: false, tokenConfigured: false });
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
