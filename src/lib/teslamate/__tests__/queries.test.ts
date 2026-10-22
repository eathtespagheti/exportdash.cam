import { describe, expect, it } from "vitest";
import {
  carsQuery,
  positionsQuery,
  probeSchemaQuery,
  tripQuery,
} from "@/lib/teslamate/queries";
import type { AvailableColumns } from "@/lib/teslamate/types";

const FULL: AvailableColumns = {
  positions: new Set([
    "speed",
    "power",
    "battery_level",
    "usable_battery_level",
    "odometer",
    "elevation",
    "ideal_battery_range_km",
    "est_battery_range_km",
    "rated_battery_range_km",
    "tpms_pressure_fl",
    "tpms_pressure_fr",
    "tpms_pressure_rl",
    "tpms_pressure_rr",
    "outside_temp",
    "inside_temp",
    "latitude",
    "longitude",
  ]),
  drives: new Set([
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
    "start_position_id",
    "end_position_id",
    "start_address_id",
    "end_address_id",
    "car_id",
  ]),
  cars: new Set(["id", "name", "model", "efficiency"]),
  addresses: new Set(["id", "display_name"]),
};

const CAR_ID = 1;
const START_MS = 1792684085393;
const END_MS = 1792684529057;

describe("probeSchemaQuery", () => {
  it("reads the table and column names from information_schema", () => {
    const sql = probeSchemaQuery().rawSql;
    expect(sql).toContain("information_schema.columns");
    expect(sql).toContain("'positions'");
    expect(sql).toContain("'drives'");
    expect(sql).toContain("'cars'");
    expect(sql).toContain("'addresses'");
  });
});

describe("carsQuery", () => {
  it("selects the car list", () => {
    const sql = carsQuery().rawSql;
    expect(sql).toContain("FROM cars");
    expect(sql).toContain("id");
    expect(sql).toContain("name");
    expect(sql).toContain("model");
  });
});

describe("time bounds", () => {
  it("parenthesises the timezone cast in the trip query", () => {
    const sql = tripQuery(CAR_ID, START_MS, END_MS, FULL).rawSql;
    expect(sql).toContain(
      `(to_timestamp(${END_MS}/1000.0) AT TIME ZONE 'UTC')`,
    );
    expect(sql).toContain(
      `(to_timestamp(${START_MS}/1000.0) AT TIME ZONE 'UTC')`,
    );
    // The unparenthesised form is a Postgres syntax error inside BETWEEN.
    expect(sql).not.toMatch(/BETWEEN[^)]*to_timestamp\([^)]*\)\s+AT TIME ZONE/);
  });

  it("parenthesises the timezone cast in the positions query", () => {
    const sql = positionsQuery(CAR_ID, START_MS, END_MS, FULL).rawSql;
    expect(sql).toContain(
      `(to_timestamp(${START_MS}/1000.0) AT TIME ZONE 'UTC')`,
    );
    expect(sql).toContain(
      `(to_timestamp(${END_MS}/1000.0) AT TIME ZONE 'UTC')`,
    );
  });

  it("uses the half-open range so adjacent windows do not double-count", () => {
    const sql = positionsQuery(CAR_ID, START_MS, END_MS, FULL).rawSql;
    expect(sql).toContain("date >=");
    expect(sql).toContain("date <");
  });
});

describe("the in-progress drive", () => {
  it("includes drives whose end_date is still null", () => {
    const sql = tripQuery(CAR_ID, START_MS, END_MS, FULL).rawSql;
    expect(sql).toContain("d.end_date IS NULL");
  });
});

describe("column selection", () => {
  it("aggregates the position series to one row per second", () => {
    const sql = positionsQuery(CAR_ID, START_MS, END_MS, FULL).rawSql;
    expect(sql).toContain("date_trunc('second'");
    expect(sql).toContain("GROUP BY 1");
  });

  it("omits columns the connected TeslaMate does not have", () => {
    const withoutTpms: AvailableColumns = {
      ...FULL,
      positions: new Set([...FULL.positions].filter((c) => !c.startsWith("tpms_pressure_"))),
    };
    const sql = positionsQuery(CAR_ID, START_MS, END_MS, withoutTpms).rawSql;

    expect(sql).not.toContain("tpms_fl");
    expect(sql).not.toContain("tpms_pressure_fl");
    expect(sql).toContain("speed_kmh");
    expect(sql).toContain("battery_pct");
  });

  it("omits drive columns the connected TeslaMate does not have", () => {
    const older: AvailableColumns = {
      ...FULL,
      drives: new Set([...FULL.drives].filter((c) => c !== "ascent" && c !== "descent")),
    };
    const sql = tripQuery(CAR_ID, START_MS, END_MS, older).rawSql;

    expect(sql).not.toContain("d.ascent");
    expect(sql).not.toContain("d.descent");
    expect(sql).toContain("d.distance");
  });

  it("joins cars for efficiency and positions for the battery levels", () => {
    const sql = tripQuery(CAR_ID, START_MS, END_MS, FULL).rawSql;
    expect(sql).toContain("JOIN cars c ON c.id = d.car_id");
    expect(sql).toContain("c.efficiency");
    expect(sql).toContain("start_battery_level");
    expect(sql).toContain("end_battery_level");
    expect(sql).toContain("start_place");
    expect(sql).toContain("end_place");
  });
});

describe("input validation", () => {
  it("refuses a car id that is not a safe integer", () => {
    for (const bad of [1.5, NaN, Infinity, -1]) {
      expect(() => tripQuery(bad, START_MS, END_MS, FULL)).toThrow();
      expect(() => positionsQuery(bad, START_MS, END_MS, FULL)).toThrow();
    }
  });

  it("refuses timestamps that are not safe integers", () => {
    expect(() => tripQuery(CAR_ID, 1.5, END_MS, FULL)).toThrow();
    expect(() => tripQuery(CAR_ID, START_MS, NaN, FULL)).toThrow();
    expect(() => positionsQuery(CAR_ID, START_MS, "now" as unknown as number, FULL)).toThrow();
  });
});

describe("refId uniqueness", () => {
  it("gives each builder a distinct refId", () => {
    const ids = [
      probeSchemaQuery().refId,
      carsQuery().refId,
      tripQuery(CAR_ID, START_MS, END_MS, FULL).refId,
      positionsQuery(CAR_ID, START_MS, END_MS, FULL).refId,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
