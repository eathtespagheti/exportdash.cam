import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTeslaMate } from "@/hooks/useTeslaMate";
import { DEFAULT_TESLAMATE_CONFIG, saveTeslaMateConfig } from "@/lib/teslamate/config";
import { detectSequences } from "@/lib/sequence-detector";
import type { VideoMoment } from "@/types/video";

const DS_UID = "PC98BA2F4D77E1A42";
const DS_TYPE = "grafana-postgresql-datasource";

/** A Grafana frame: column-major values under their field names. */
function frame(fields: string[], values: unknown[][]) {
  return {
    status: 200,
    frames: [
      {
        schema: { fields: fields.map((name) => ({ name, type: "number" })) },
        data: { values },
      },
    ],
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/**
 * Grafana frames are column-major: `values[0]` holds every value of the
 * first column, not every value of the first row.
 */
const SCHEMA_FRAME = frame(
  ["table_name", "column_name"],
  [
    [
      "positions",
      "positions",
      "positions",
      "positions",
      "drives",
      "drives",
      "drives",
      "cars",
      "cars",
      "cars",
      "cars",
      "addresses",
    ],
    [
      "speed",
      "power",
      "battery_level",
      "tpms_pressure_fl",
      "distance",
      "start_date",
      "end_date",
      "id",
      "name",
      "model",
      "efficiency",
      "display_name",
    ],
  ],
);

const CARS_FRAME = frame(
  ["id", "name", "model"],
  [[1], ["pipus"], ["3"]],
);

/** Two moments 90 seconds apart — one sequence, with a 30s gap inside it. */
function makeMoments(): VideoMoment[] {
  const make = (seconds: number): VideoMoment => {
    const timestamp = new Date(2026, 0, 15, 10, 30, 0, 0);
    timestamp.setSeconds(timestamp.getSeconds() + seconds);
    const time = timestamp.toTimeString().slice(0, 8);
    return {
      id: `m${seconds}`,
      timestamp,
      date: "2026-01-15",
      time,
      dateTime: `2026-01-15 ${time}`,
      videos: [],
      duration: 60,
    };
  };
  return [make(0), make(90)];
}

/**
 * Two trips placed so that only the per-moment wall clock finds the right one.
 *
 * The sequence clock drifts by the 30s merge gap, so it would land the second
 * clip in the first trip.
 */
function tripFrame(aMs: number) {
  return frame(
    [
      "id",
      "start_date",
      "end_date",
      "distance",
      "duration_min",
      "speed_max",
      "power_max",
      "power_min",
      "ascent",
      "descent",
      "outside_temp_avg",
      "inside_temp_avg",
      "start_ideal_range_km",
      "end_ideal_range_km",
      "start_km",
      "end_km",
      "efficiency",
      "start_battery_level",
      "end_battery_level",
      "start_place",
      "end_place",
    ],
    [
      [1, 2],
      [aMs - 1_000, aMs + 100_000],
      [aMs + 89_000, aMs + 160_000],
      [12.5, 12.5],
      [7, 7],
      [60, 60],
      [30, 30],
      [-10, -10],
      [5, 5],
      [12, 12],
      [20, 21],
      [25, 26],
      [280, 279],
      [270, 269],
      [162723, 162735],
      [162735, 162747],
      [0.1367, 0.1367],
      [60, 58],
      [55, 53],
      ["Home", "Home"],
      ["Work", "Work"],
    ],
  );
}

function positionsFrame(aMs: number) {
  return frame(
    ["t_ms", "speed_kmh", "power_kw", "battery_pct", "tpms_fl"],
    [
      [aMs, aMs + 1_000, aMs + 2_000],
      [10, 20, 30],
      [1, 2, 3],
      [60, 60, 60],
      [2.9, 2.9, 2.9],
    ],
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers the datasource list and the three query shapes the hook sends. */
function mockGrafana(
  aMs: number,
  options: { configured?: boolean } = {},
) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/grafana-proxy/status")) {
      return jsonResponse({
        configured: options.configured === true,
        tokenConfigured: options.configured === true,
      });
    }
    if (String(url).endsWith("/api/datasources")) {
      return jsonResponse([{ uid: DS_UID, name: "TeslaMate", type: DS_TYPE }]);
    }
    const body = JSON.parse(String(init.body));
    const results: Record<string, unknown> = {};
    for (const q of body.queries as Array<{ refId: string }>) {
      if (q.refId === "schema") results[q.refId] = SCHEMA_FRAME;
      else if (q.refId === "cars") results[q.refId] = CARS_FRAME;
      else if (q.refId === "trip") results[q.refId] = tripFrame(aMs);
      else if (q.refId === "positions") results[q.refId] = positionsFrame(aMs);
    }
    return jsonResponse({ results });
  });
}

describe("useTeslaMate", () => {
  it("stays unconfigured when neither the user nor the deployment configured it", async () => {
    saveTeslaMateConfig({ ...DEFAULT_TESLAMATE_CONFIG, grafanaUrl: "" });
    mockGrafana(0, { configured: false });

    const { result } = renderHook(() => useTeslaMate(null));

    await waitFor(() => expect(result.current.status).toBe("unconfigured"));
    expect(result.current.error).toBeNull();
  });

  it("enables itself when the deployment is pre-configured", async () => {
    // Nothing saved by the user: the server supplies GRAFANA_UPSTREAM and
    // GRAFANA_TOKEN, so the app needs no setup at all.
    const moments = makeMoments();
    const aMs = moments[0].timestamp.getTime();
    mockGrafana(aMs, { configured: true });

    const sequences = detectSequences(moments);
    const { result } = renderHook(() => useTeslaMate(sequences[0]));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.carId).toBe(1);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/grafana-proxy/status");
    expect(urls.some((u) => u.startsWith("/grafana-proxy/api/"))).toBe(true);
  });

  it("reports when no TeslaMate datasource exists", async () => {
    saveTeslaMateConfig({
      ...DEFAULT_TESLAMATE_CONFIG,
      enabled: true,
      grafanaUrl: "https://grafana.example.com",
    });
    fetchMock.mockResolvedValue(
      jsonResponse([{ uid: "X", name: "Prometheus", type: "prometheus" }]),
    );

    const { result } = renderHook(() => useTeslaMate(null));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.kind).toBe("noDatasource");
  });

  it("connects, discovers the car and the datasource", async () => {
    saveTeslaMateConfig({
      ...DEFAULT_TESLAMATE_CONFIG,
      enabled: true,
      grafanaUrl: "https://grafana.example.com",
    });
    const moments = makeMoments();
    const aMs = moments[0].timestamp.getTime();
    mockGrafana(aMs);

    const { result } = renderHook(() => useTeslaMate(null));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.cars).toEqual([{ id: 1, name: "pipus", model: "3" }]);
    expect(result.current.error).toBeNull();
  });

  it("resolves each clip to its own trip, using the per-moment wall clock", async () => {
    saveTeslaMateConfig({
      ...DEFAULT_TESLAMATE_CONFIG,
      enabled: true,
      grafanaUrl: "https://grafana.example.com",
      carId: 1,
    });
    const moments = makeMoments();
    const aMs = moments[0].timestamp.getTime();
    mockGrafana(aMs);

    const sequences = detectSequences(moments);
    expect(sequences).toHaveLength(1);

    const { result } = renderHook(() => useTeslaMate(sequences[0]));

    await waitFor(() =>
      expect(
        result.current.status,
        `${result.current.error?.kind}: ${result.current.error?.message}`,
      ).toBe("ready"),
    );

    const first = result.current.tripForMoment(0);
    const second = result.current.tripForMoment(1);

    expect(first?.id).toBe(1);
    expect(second?.id).toBe(2);
  });

  it("samples the live values at the given offset within the clip", async () => {
    saveTeslaMateConfig({
      ...DEFAULT_TESLAMATE_CONFIG,
      enabled: true,
      grafanaUrl: "https://grafana.example.com",
      carId: 1,
    });
    const moments = makeMoments();
    const aMs = moments[0].timestamp.getTime();
    mockGrafana(aMs);

    const sequences = detectSequences(moments);
    const { result } = renderHook(() => useTeslaMate(sequences[0]));

    await waitFor(() => expect(result.current.status).toBe("ready"));

    const sample = result.current.sampleForMoment(0, 0);
    expect(sample).not.toBeNull();
    expect(sample!.batteryPct).toBe(60);
    expect(sample!.tpmsFl).toBe(2.9);
  });

  it("reuses the cached series when the same sequence is opened again", async () => {
    // A distinct Grafana address, so this test starts with a cold cache and
    // the first render really does fetch.
    saveTeslaMateConfig({
      ...DEFAULT_TESLAMATE_CONFIG,
      enabled: true,
      grafanaUrl: "https://cache.example.com",
      carId: 1,
    });
    const moments = makeMoments();
    const aMs = moments[0].timestamp.getTime();
    mockGrafana(aMs);

    const sequences = detectSequences(moments);

    const first = renderHook(() => useTeslaMate(sequences[0]));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    const callsAfterFirst = fetchMock.mock.calls.length;
    first.unmount();

    const second = renderHook(() => useTeslaMate(sequences[0]));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
