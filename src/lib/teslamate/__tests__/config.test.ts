import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TESLAMATE_CONFIG,
  loadTeslaMateConfig,
  resolveBaseUrl,
  saveTeslaMateConfig,
} from "@/lib/teslamate/config";
import { TRIP_FIELDS } from "@/lib/teslamate/fields";
import type { TeslaMateConfig } from "@/lib/teslamate/types";

const KEY = "tesla-cam-teslamate-config";

beforeEach(() => {
  localStorage.clear();
});

describe("loadTeslaMateConfig", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadTeslaMateConfig()).toEqual(DEFAULT_TESLAMATE_CONFIG);
  });

  it("round-trips a saved config", () => {
    const config: TeslaMateConfig = {
      ...DEFAULT_TESLAMATE_CONFIG,
      grafanaUrl: "https://grafana.example.com",
      token: "glsa_secret",
      rememberToken: true,
      datasourceUid: "PC98BA2F4D77E1A42",
      carId: 1,
      tzOffsetMinutes: 120,
      rangeType: "rated",
      distanceUnit: "mi",
      temperatureUnit: "f",
      pressureUnit: "psi",
      elevationUnit: "ft",
      liveFields: ["battery"],
      exportTripFields: ["trip_distance"],
      exportLiveFields: ["power"],
      panelCorner: "bottom-left",
    };

    saveTeslaMateConfig(config);

    expect(loadTeslaMateConfig()).toEqual(config);
  });

  it("merges a partial stored object over the defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ grafanaUrl: "https://grafana.example.com" }));

    const loaded = loadTeslaMateConfig();
    expect(loaded.grafanaUrl).toBe("https://grafana.example.com");
    expect(loaded.rangeType).toBe(DEFAULT_TESLAMATE_CONFIG.rangeType);
    expect(loaded.liveFields).toEqual(DEFAULT_TESLAMATE_CONFIG.liveFields);
  });

  it("falls back to the defaults when the stored value is corrupt", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadTeslaMateConfig()).toEqual(DEFAULT_TESLAMATE_CONFIG);
  });

  it("never returns a stored token unless remembering was asked for", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...DEFAULT_TESLAMATE_CONFIG, token: "glsa_secret", rememberToken: false }),
    );
    expect(loadTeslaMateConfig().token).toBeNull();

    localStorage.setItem(
      KEY,
      JSON.stringify({ ...DEFAULT_TESLAMATE_CONFIG, token: "glsa_secret", rememberToken: true }),
    );
    expect(loadTeslaMateConfig().token).toBe("glsa_secret");
  });
});

describe("saveTeslaMateConfig", () => {
  it("does not persist a token the user did not ask to remember", () => {
    saveTeslaMateConfig({ ...DEFAULT_TESLAMATE_CONFIG, token: "glsa_secret", rememberToken: false });

    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.token).toBeNull();
  });

  it("survives a storage failure", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => saveTeslaMateConfig(DEFAULT_TESLAMATE_CONFIG)).not.toThrow();
    setItem.mockRestore();
  });
});

describe("resolveBaseUrl", () => {
  it("treats a relative URL as the same-origin proxy", () => {
    expect(resolveBaseUrl({ ...DEFAULT_TESLAMATE_CONFIG, grafanaUrl: "/grafana-proxy" })).toEqual({
      baseUrl: "/grafana-proxy",
      mode: "proxy",
    });
  });

  it("treats an absolute URL as a direct connection", () => {
    expect(resolveBaseUrl({ ...DEFAULT_TESLAMATE_CONFIG, grafanaUrl: "https://grafana.example.com" })).toEqual({
      baseUrl: "https://grafana.example.com",
      mode: "direct",
    });
  });

  it("treats a URL with a path as direct", () => {
    expect(resolveBaseUrl({ ...DEFAULT_TESLAMATE_CONFIG, grafanaUrl: "https://h/grafana" }).mode).toBe("direct");
  });
});

describe("the defaults", () => {
  it("points self-hosters at the bundled proxy", () => {
    expect(DEFAULT_TESLAMATE_CONFIG.enabled).toBe(false);
    expect(DEFAULT_TESLAMATE_CONFIG.grafanaUrl).toBe("/grafana-proxy");
    expect(DEFAULT_TESLAMATE_CONFIG.rememberToken).toBe(false);
    expect(DEFAULT_TESLAMATE_CONFIG.token).toBeNull();
  });

  it("shows battery and power live, and nothing live in the export", () => {
    expect(DEFAULT_TESLAMATE_CONFIG.liveFields).toEqual(["battery", "power"]);
    expect(DEFAULT_TESLAMATE_CONFIG.exportLiveFields).toEqual([]);
  });

  it("keeps the geocoded place names out of the export by default", () => {
    expect(DEFAULT_TESLAMATE_CONFIG.exportTripFields).not.toContain("trip_start_place");
    expect(DEFAULT_TESLAMATE_CONFIG.exportTripFields).not.toContain("trip_end_place");
    expect(DEFAULT_TESLAMATE_CONFIG.exportTripFields.length).toBe(
      TRIP_FIELDS.length - 2,
    );
  });

  it("uses metric units and the ideal range", () => {
    expect(DEFAULT_TESLAMATE_CONFIG.distanceUnit).toBe("km");
    expect(DEFAULT_TESLAMATE_CONFIG.temperatureUnit).toBe("c");
    expect(DEFAULT_TESLAMATE_CONFIG.pressureUnit).toBe("bar");
    expect(DEFAULT_TESLAMATE_CONFIG.elevationUnit).toBe("m");
    expect(DEFAULT_TESLAMATE_CONFIG.rangeType).toBe("ideal");
  });
});
