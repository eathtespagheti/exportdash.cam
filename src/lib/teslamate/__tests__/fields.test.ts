import { describe, expect, it } from "vitest";
import { LIVE_FIELDS, TRIP_FIELDS, fieldByKey, type Units } from "@/lib/teslamate/fields";
import type { TripSummary } from "@/lib/teslamate/types";

const METRIC: Units = {
  speedUnit: "kmh",
  distanceUnit: "km",
  temperatureUnit: "c",
  pressureUnit: "bar",
  elevationUnit: "m",
};

const IMPERIAL: Units = {
  speedUnit: "mph",
  distanceUnit: "mi",
  temperatureUnit: "f",
  pressureUnit: "psi",
  elevationUnit: "ft",
};

/** Minimal trip fixture; only the fields a formatter reads are populated. */
function trip(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    id: 1,
    startMs: 0,
    endMs: 1000,
    distanceKm: null,
    durationMin: null,
    speedMaxKmh: null,
    powerMaxKw: null,
    powerMinKw: null,
    ascentM: null,
    descentM: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    startIdealRangeKm: null,
    endIdealRangeKm: null,
    startKm: null,
    endKm: null,
    efficiencyKwhPerKm: null,
    startBatteryPct: null,
    endBatteryPct: null,
    startPlace: null,
    endPlace: null,
    ...overrides,
  };
}

const ALL_FIELDS = [...TRIP_FIELDS, ...LIVE_FIELDS];
const key = (k: string) => {
  const f = fieldByKey(k);
  if (!f) throw new Error(`no field named ${k}`);
  return f;
};

describe("unit conversion", () => {
  it("converts distance between km and mi", () => {
    expect(key("trip_distance").format(100, IMPERIAL)).toBe("62.1 mi");
    expect(key("trip_distance").format(100, METRIC)).toBe("100.0 km");
  });

  it("converts pressure between bar and psi", () => {
    expect(key("tpms_fl").format(2.9, IMPERIAL)).toBe("42.1 psi");
    expect(key("tpms_fl").format(2.9, METRIC)).toBe("2.9 bar");
  });

  it("converts temperature between C and F", () => {
    expect(key("outside_temp").format(20, IMPERIAL)).toBe("68.0 °F");
    expect(key("outside_temp").format(20, METRIC)).toBe("20.0 °C");
  });

  it("converts speed between km/h and mph", () => {
    expect(key("trip_max_speed").format(100, IMPERIAL)).toBe("62 mph");
    expect(key("trip_max_speed").format(100, METRIC)).toBe("100 km/h");
  });

  it("converts elevation between m and ft", () => {
    expect(key("elevation").format(100, IMPERIAL)).toBe("328 ft");
    expect(key("elevation").format(100, METRIC)).toBe("100 m");
  });
});

describe("power regen marking", () => {
  it("marks negative power as regen and leaves positive power unmarked", () => {
    const negative = key("power").format(-55, METRIC);
    const positive = key("power").format(116, METRIC);
    expect(negative).toContain("regen");
    expect(positive).not.toContain("regen");
    expect(positive).toBe("116 kW");
  });
});

describe("derived trip fields", () => {
  it("derives average speed from the trip when no value is given", () => {
    const t = trip({ distanceKm: 30, durationMin: 30 });
    expect(key("trip_avg_speed").format(null, METRIC, t)).toBe("60 km/h");
  });

  it("prefers an explicit value over the trip", () => {
    const t = trip({ distanceKm: 30, durationMin: 30 });
    expect(key("trip_avg_speed").format(10, METRIC, t)).toBe("10 km/h");
  });

  it("derives energy used from the range delta and efficiency", () => {
    const t = trip({ startIdealRangeKm: 282.07, endIdealRangeKm: 279.45, efficiencyKwhPerKm: 0.1367 });
    expect(key("trip_energy").format(null, METRIC, t)).toBe("0.4 kWh");
  });

  it("returns an em dash when the inputs for a derived field are missing", () => {
    expect(key("trip_avg_speed").format(null, METRIC, trip())).toBe("—");
    expect(key("trip_energy").format(null, METRIC, trip())).toBe("—");
    expect(key("trip_avg_speed").format(null, METRIC)).toBe("—");
  });
});

describe("missing data never renders as a number", () => {
  it("returns an em dash for null, undefined and NaN in every field", () => {
    for (const f of ALL_FIELDS) {
      for (const bad of [null, undefined, NaN]) {
        const out = f.format(bad, METRIC);
        expect(out, `${f.key} with ${String(bad)}`).toBe("—");
      }
    }
  });

  it("never returns a string containing NaN or undefined", () => {
    for (const f of ALL_FIELDS) {
      for (const v of [null, undefined, NaN, 0, 1.5, -3, "text"]) {
        const out = f.format(v, IMPERIAL);
        expect(out, `${f.key} with ${String(v)}`).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it("renders a missing place as an em dash and an empty string likewise", () => {
    expect(key("trip_start_place").format(null, METRIC)).toBe("—");
    expect(key("trip_start_place").format("", METRIC)).toBe("—");
    expect(key("trip_start_place").format("Via Caniga, Sassari", METRIC)).toBe("Via Caniga, Sassari");
  });
});

describe("catalogue integrity", () => {
  it("round-trips every key through fieldByKey", () => {
    for (const f of ALL_FIELDS) {
      expect(fieldByKey(f.key)).toBe(f);
    }
  });

  it("has unique keys", () => {
    const keys = ALL_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not duplicate fields the clip's SEI stream already provides", () => {
    for (const f of ALL_FIELDS) {
      expect(["speed", "latitude", "longitude", "acceleration"]).not.toContain(f.key);
    }
  });

  it("tags each field with its group", () => {
    expect(TRIP_FIELDS.every((f) => f.group === "trip")).toBe(true);
    expect(LIVE_FIELDS.every((f) => f.group === "live")).toBe(true);
  });

  it("covers the field list the design specifies", () => {
    expect(TRIP_FIELDS.map((f) => f.key)).toEqual([
      "trip_distance",
      "trip_duration",
      "trip_avg_speed",
      "trip_max_speed",
      "trip_max_power",
      "trip_min_power",
      "trip_energy",
      "trip_start_battery",
      "trip_end_battery",
      "trip_ascent",
      "trip_descent",
      "trip_start_place",
      "trip_end_place",
      "trip_outside_temp",
      "trip_inside_temp",
    ]);
    expect(LIVE_FIELDS.map((f) => f.key)).toEqual([
      "battery",
      "usable_battery",
      "power",
      "range",
      "odometer",
      "elevation",
      "tpms_fl",
      "tpms_fr",
      "tpms_rl",
      "tpms_rr",
      "outside_temp",
      "inside_temp",
    ]);
  });
});
