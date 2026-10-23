/**
 * Turns the schema probe into the set of columns the app may rely on.
 *
 * TeslaMate's schema varies by version — `ascent`/`descent` arrived in 2.1.0,
 * the tire pressures in 2022 — so the integration asks what exists before it
 * asks for anything. A column that is missing here simply never appears in a
 * query, and the field that depends on it reports itself as unavailable.
 */

import type { Frame } from "./client";
import type { AvailableColumns } from "./types";

const TRACKED_TABLES = ["positions", "drives", "cars", "addresses"] as const;

type TrackedTable = (typeof TRACKED_TABLES)[number];

function isTracked(table: string): table is TrackedTable {
  return (TRACKED_TABLES as readonly string[]).includes(table);
}

/**
 * Groups the probed `(table_name, column_name)` rows into one set per table.
 *
 * A frame with no rows — an empty table, or a probe that failed — yields four
 * empty sets rather than throwing.
 */
export function parseSchemaProbe(frame: Frame): AvailableColumns {
  const columns: AvailableColumns = {
    positions: new Set<string>(),
    drives: new Set<string>(),
    cars: new Set<string>(),
    addresses: new Set<string>(),
  };

  const tables = frame.columns.table_name ?? [];
  const names = frame.columns.column_name ?? [];
  const count = Math.min(tables.length, names.length);

  for (let i = 0; i < count; i++) {
    const table = String(tables[i]);
    const column = String(names[i]);
    if (isTracked(table)) {
      columns[table].add(column);
    }
  }

  return columns;
}
