import { describe, expect, it } from "vitest";
import { parseSchemaProbe } from "@/lib/teslamate/schema";
import type { Frame } from "@/lib/teslamate/client";

function probeFrame(rows: Array<[string, string]>): Frame {
  return {
    fields: ["table_name", "column_name"],
    columns: {
      table_name: rows.map((r) => r[0]),
      column_name: rows.map((r) => r[1]),
    },
    rowCount: rows.length,
  };
}

describe("parseSchemaProbe", () => {
  it("groups the probed columns by table", () => {
    const cols = parseSchemaProbe(
      probeFrame([
        ["positions", "speed"],
        ["positions", "tpms_pressure_fl"],
        ["drives", "ascent"],
        ["cars", "efficiency"],
        ["addresses", "display_name"],
      ]),
    );

    expect(cols.positions.has("speed")).toBe(true);
    expect(cols.positions.has("tpms_pressure_fl")).toBe(true);
    expect(cols.positions.has("ascent")).toBe(false);
    expect(cols.drives.has("ascent")).toBe(true);
    expect(cols.cars.has("efficiency")).toBe(true);
    expect(cols.addresses.has("display_name")).toBe(true);
  });

  it("returns empty sets for a probe that found nothing", () => {
    const cols = parseSchemaProbe(probeFrame([]));

    expect(cols.positions.size).toBe(0);
    expect(cols.drives.size).toBe(0);
    expect(cols.cars.size).toBe(0);
    expect(cols.addresses.size).toBe(0);
  });

  it("ignores rows for tables it does not track", () => {
    const cols = parseSchemaProbe(
      probeFrame([
        ["positions", "speed"],
        ["charges", "charger_power"],
        ["states", "state"],
      ]),
    );

    expect(cols.positions.size).toBe(1);
    expect(cols.drives.size).toBe(0);
  });

  it("handles a frame whose values are missing entirely", () => {
    const cols = parseSchemaProbe({
      fields: ["table_name", "column_name"],
      columns: {},
      rowCount: 0,
    });

    expect(cols.positions.size).toBe(0);
    expect(cols.cars.size).toBe(0);
  });
});
