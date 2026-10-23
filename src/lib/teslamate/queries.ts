/**
 * SQL builders for the TeslaMate integration.
 *
 * Grafana's `rawSql` datasource query takes literal SQL — there is no bind
 * parameter mechanism — so every value that reaches the query text is
 * validated here first. The only values ever interpolated are the selected
 * car's id and millisecond timestamps, both of which the app generates; no
 * user-supplied string ever enters a query.
 *
 * The `SELECT` lists are built from the columns the connected TeslaMate
 * actually has, so a version that does not record (say) ascent or tire
 * pressure simply does not get those columns.
 */

import type { AvailableColumns, SqlQuery } from "./types";

/** Rejects anything that is not a whole number we can safely print. */
function requireSafeInt(value: number, name: string, positive = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer, got ${String(value)}`);
  }
  if (positive && value <= 0) {
    throw new Error(`${name} must be greater than zero, got ${value}`);
  }
  return value;
}

/**
 * Renders a millisecond instant as a Postgres UTC timestamp expression.
 *
 * The parentheses are required: inside `BETWEEN`, Postgres parses
 * `x AT TIME ZONE 'UTC' AND y AT TIME ZONE 'UTC'` as
 * `x AT (TIME ZONE 'UTC' AND y)` and rejects it.
 */
function utcBound(ms: number): string {
  requireSafeInt(ms, "timestamp");
  return `(to_timestamp(${ms}/1000.0) AT TIME ZONE 'UTC')`;
}

/** Columns of the `drives` table, with the expression that reads each one. */
const DRIVE_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["id", "d.id"],
  ["start_date", "d.start_date"],
  ["end_date", "d.end_date"],
  ["distance", "d.distance"],
  ["duration_min", "d.duration_min"],
  ["speed_max", "d.speed_max"],
  ["power_max", "d.power_max"],
  ["power_min", "d.power_min"],
  ["ascent", "d.ascent"],
  ["descent", "d.descent"],
  ["outside_temp_avg", "d.outside_temp_avg"],
  ["inside_temp_avg", "d.inside_temp_avg"],
  ["start_ideal_range_km", "d.start_ideal_range_km"],
  ["end_ideal_range_km", "d.end_ideal_range_km"],
  ["start_km", "d.start_km"],
  ["end_km", "d.end_km"],
];

/**
 * Columns of the `positions` table, with the alias and aggregate to read
 * each one. The alias is what the frame field is named, so it is the name
 * the rest of the app uses.
 */
const POSITION_COLUMNS: ReadonlyArray<readonly [string, string, string]> = [
  ["speed", "speed_kmh", "avg"],
  ["power", "power_kw", "avg"],
  ["battery_level", "battery_pct", "max"],
  ["usable_battery_level", "usable_battery_pct", "max"],
  ["odometer", "odometer_km", "max"],
  ["elevation", "elevation_m", "max"],
  ["ideal_battery_range_km", "ideal_range_km", "max"],
  ["est_battery_range_km", "est_range_km", "max"],
  ["rated_battery_range_km", "rated_range_km", "max"],
  ["tpms_pressure_fl", "tpms_fl", "max"],
  ["tpms_pressure_fr", "tpms_fr", "max"],
  ["tpms_pressure_rl", "tpms_rl", "max"],
  ["tpms_pressure_rr", "tpms_rr", "max"],
  ["outside_temp", "outside_temp_c", "max"],
  ["inside_temp", "inside_temp_c", "max"],
  ["latitude", "latitude", "max"],
  ["longitude", "longitude", "max"],
];

/**
 * Reads which columns exist on the TeslaMate tables.
 *
 * `information_schema` is stable across TeslaMate versions, so one cheap
 * query is enough to know what the rest of the integration may rely on.
 */
export function probeSchemaQuery(): SqlQuery {
  return {
    refId: "schema",
    rawSql:
      "SELECT table_name, column_name\n" +
      "FROM information_schema.columns\n" +
      "WHERE table_schema = 'public'\n" +
      "  AND table_name IN ('positions', 'drives', 'cars', 'addresses')",
  };
}

/** Lists the cars TeslaMate knows about. */
export function carsQuery(): SqlQuery {
  return {
    refId: "cars",
    rawSql: "SELECT id, name, model FROM cars ORDER BY id",
  };
}

/**
 * The trip(s) overlapping a time window.
 *
 * `end_date IS NULL` is included on purpose: TeslaMate writes the drive row
 * when the drive starts and fills `end_date` when it ends, so the trip being
 * recorded right now has no end date and would otherwise never match.
 */
export function tripQuery(
  carId: number,
  startMs: number,
  endMs: number,
  cols: AvailableColumns,
): SqlQuery {
  requireSafeInt(carId, "carId", true);

  const select: string[] = [];
  for (const [column, expression] of DRIVE_COLUMNS) {
    if (cols.drives.has(column)) select.push(expression);
  }

  const joins: string[] = [];

  if (cols.cars.has("efficiency")) {
    select.push("c.efficiency");
    joins.push("JOIN cars c ON c.id = d.car_id");
  }

  if (cols.positions.has("battery_level") && cols.drives.has("start_position_id") && cols.drives.has("end_position_id")) {
    select.push("sp.battery_level AS start_battery_level");
    select.push("ep.battery_level AS end_battery_level");
    joins.push("LEFT JOIN positions sp ON sp.id = d.start_position_id");
    joins.push("LEFT JOIN positions ep ON ep.id = d.end_position_id");
  }

  if (cols.addresses.has("display_name") && cols.drives.has("start_address_id") && cols.drives.has("end_address_id")) {
    select.push("sa.display_name AS start_place");
    select.push("ea.display_name AS end_place");
    joins.push("LEFT JOIN addresses sa ON sa.id = d.start_address_id");
    joins.push("LEFT JOIN addresses ea ON ea.id = d.end_address_id");
  }

  const sql =
    `SELECT ${select.join(", ")}\n` +
    "FROM drives d\n" +
    `${joins.join("\n")}\n` +
    `WHERE d.car_id = ${carId}\n` +
    `  AND d.start_date <= ${utcBound(endMs)}\n` +
    `  AND (d.end_date IS NULL OR d.end_date >= ${utcBound(startMs)})\n` +
    "ORDER BY d.start_date";

  return { refId: "trip", rawSql: sql };
}

/**
 * The position series for a window, aggregated to one row per second.
 *
 * The half-open range (`>= start`, `< end`) keeps adjacent windows from
 * counting a boundary sample twice, and the 1 Hz grid bounds the payload:
 * a one-hour window is roughly 585 rows.
 */
export function positionsQuery(
  carId: number,
  startMs: number,
  endMs: number,
  cols: AvailableColumns,
): SqlQuery {
  requireSafeInt(carId, "carId", true);

  const select: string[] = ["date_trunc('second', date) AS t_ms"];
  for (const [column, alias, aggregate] of POSITION_COLUMNS) {
    if (cols.positions.has(column)) {
      select.push(`${aggregate}(${column}) AS ${alias}`);
    }
  }

  const sql =
    `SELECT ${select.join(", ")}\n` +
    "FROM positions\n" +
    `WHERE car_id = ${carId}\n` +
    `  AND date >= ${utcBound(startMs)}\n` +
    `  AND date < ${utcBound(endMs)}\n` +
    "GROUP BY 1\n" +
    "ORDER BY 1";

  return { refId: "positions", rawSql: sql };
}
