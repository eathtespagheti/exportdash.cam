# TeslaMate Trip Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match each Tesla dashcam clip to its TeslaMate trip, and surface trip
and vehicle metrics that the MP4 cannot provide — live during playback and burned
into the exported video — with every displayed field individually configurable.

**Architecture:** A layered feature, not independent subsystems, so this is one
plan with tasks ordered by dependency. Pure modules (`queries`, `schema`,
`match`, `series`, `fields`, `config`) carry the logic and the tests; `client` is
the only module that touches HTTP; the React layer is thin. The natural seam is
after Task 7 — the data layer is verifiably correct on its own, so execution may
pause there.

**Tech Stack:** TypeScript, React 19, Next.js 16 (static export), Tailwind 4,
vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-22-teslamate-trip-integration-design.md`

**Issue:** GitLab #16 (`eathtespagheti/exportdash.cam`)

## Data flow

```
VideoPlayer ─┐
             ├─▶ useTeslaMate ─▶ client ─▶ (direct) Grafana /api/ds/query
VideoExporter┘        │                   └▶ (/grafana-proxy) nginx ─▶ Grafana
                      ├─▶ queries  (SQL, built from schema probe)
                      ├─▶ schema   (information_schema → AvailableColumns)
                      ├─▶ match    (clip wall clock → TripSummary)
                      └─▶ series   (PositionSample[] → sampleAt)
```

Pure, unit-testable modules (`queries`, `schema`, `match`, `series`, `fields`,
`config`) carry the logic. `client` is the only module that touches HTTP. The
React layer (`useTeslaMate`, three components) is thin. Tests live in
`src/**/__tests__/*.test.ts` and import through the `@/` alias.

## Global Constraints

These come from the spec and apply to every task.

1. **No SQL bind parameters exist.** Grafana's `rawSql` is literal text. The only
   values interpolated into SQL are the selected `car_id` and millisecond
   timestamps, each validated with `Number.isSafeInteger` before stringification.
   No user-supplied string ever enters a query.
2. **Parenthesise the timezone cast.** Write
   `(to_timestamp(<ms>/1000.0) AT TIME ZONE 'UTC')`. Unparenthesised inside
   `BETWEEN`, Postgres raises `syntax error at or near "AT"`.
3. **`POST /api/ds/query`; `GET /api/datasources`.** A GET on the query endpoint
   returns 404.
4. **The trip query includes `end_date IS NULL`**, or an in-progress drive never
   matches. Such a trip is provisional: its incomplete aggregates render as "—".
5. **Probe `information_schema` and build each `SELECT` from the columns that
   exist.** One absent column aborts a whole statement.
6. **Sparse metrics carry forward; never interpolate.** Tire pressure and
   temperatures appear in ~30 of 1260 position rows.
7. **The wall clock is per moment:** `moment.timestamp + localTime*1000`. Never
   `sequence.startTime + absoluteTime` — sequence merging drifts.
8. **Missing data is "—", never 0.** Applies to the panel and the export.
9. **The Grafana token is stored only on explicit opt-in**, mirroring the
   existing decrypt-token prompt.
10. **Speed uses the existing `speedUnit`; distance/range/odometer use their own
    unit setting**, so mph speed with miles distance is expressible.
11. **Nothing leaves the machine** except requests to the user's own Grafana.

## Review Focus

Inputs and conditions the spec implies that are easy to get wrong. Each has a
test pinned in the task that owns the code.

1. **Zero-row results.** Grafana returns a frame with `values: []` when a window
   contains no positions (a parked clip). The parser must not index `values[0]`.
2. **Base URL joining.** `/grafana-proxy`, `/grafana-proxy/`, and
   `https://host/grafana/` must all join with `/api/ds/query` without doubling or
   dropping slashes.
3. **Non-Postgres datasource.** A user may select a Prometheus datasource; the
   result must be a clear `GrafanaError`, not a crash.
4. **Manual timezone offset across a DST boundary.** The offset is a fixed delta
   on the epoch; the test uses a DST transition date.
5. **Numeric nulls.** Postgres `numeric` columns arrive as `null`; no field may
   render `NaN`.

## File Structure

**New — logic (`src/lib/teslamate/`)**

| File | Responsibility |
|---|---|
| `types.ts` | All shared types; no logic |
| `fields.ts` | Field catalogue, unit conversion, formatting |
| `client.ts` | The only HTTP module; URL building, error taxonomy |
| `queries.ts` | SQL text builders |
| `schema.ts` | `information_schema` frame → `AvailableColumns` |
| `match.ts` | Clip wall clock → trip selection |
| `series.ts` | Position rows → sorted series + `sampleAt` |
| `config.ts` | localStorage load/save; base-URL resolution |

**New — React**

| File | Responsibility |
|---|---|
| `src/hooks/useTeslaMate.ts` | Connection, discovery, per-sequence fetch, cache |
| `src/components/TeslaMateSettings.tsx` | Connection settings dialog |
| `src/components/TripMetricsPanel.tsx` | Live playback panel |
| `src/components/TripMetricsConfig.tsx` | Field picker |

**New — infra & tooling**

| File | Responsibility |
|---|---|
| `templates/default.conf.template` | Replaces `nginx.conf`; adds `/grafana-proxy/` |
| `scripts/verify-teslamate.mjs` | Live-instance verification (not CI) |

**Modified**

| File | Change |
|---|---|
| `src/components/VideoPlayer.tsx` | Mount the panel; settings entry point |
| `src/components/VideoExporter.tsx` | `drawTripMetrics()` + props |
| `Dockerfile` | `ENV GRAFANA_UPSTREAM=""`; copy templates |
| `docker-compose.yml` | Document the new env var |
| `README.md` | Integration section |

**Tests** — `src/lib/teslamate/__tests__/{fields,client,queries,schema,match,series,config}.test.ts`

---

## Task 1: Types and the field catalogue

**Files:** create `src/lib/teslamate/types.ts`, `src/lib/teslamate/fields.ts`,
`src/lib/teslamate/__tests__/fields.test.ts`

**Interfaces — produces:**

```ts
// types.ts
export type RangeType = 'ideal' | 'est' | 'rated';
export type DistanceUnit = 'km' | 'mi';
export type TemperatureUnit = 'c' | 'f';
export type PressureUnit = 'bar' | 'psi';
export type ElevationUnit = 'm' | 'ft';
export type PanelCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface TeslaMateConfig {
  grafanaUrl: string;
  token: string | null;
  rememberToken: boolean;
  datasourceUid: string | null;
  carId: number | null;
  tzOffsetMinutes: number | null;   // minutes east of UTC; null = browser
  rangeType: RangeType;
  distanceUnit: DistanceUnit;
  temperatureUnit: TemperatureUnit;
  pressureUnit: PressureUnit;
  elevationUnit: ElevationUnit;
  liveFields: string[];
  exportTripFields: string[];
  exportLiveFields: string[];
  panelCorner: PanelCorner;
}

export interface CarInfo { id: number; name: string; model: string | null }

export interface TripSummary {
  id: number;
  startMs: number;
  endMs: number | null;             // null = in progress
  distanceKm: number | null;
  durationMin: number | null;
  speedMaxKmh: number | null;
  powerMaxKw: number | null;
  powerMinKw: number | null;
  ascentM: number | null;
  descentM: number | null;
  outsideTempAvgC: number | null;
  insideTempAvgC: number | null;
  startIdealRangeKm: number | null;
  endIdealRangeKm: number | null;
  startKm: number | null;
  endKm: number | null;
  efficiencyKwhPerKm: number | null;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
  startPlace: string | null;
  endPlace: string | null;
}

export interface PositionSample {
  tMs: number;
  speedKmh: number | null;
  powerKw: number | null;
  batteryPct: number | null;
  usableBatteryPct: number | null;
  odometerKm: number | null;
  elevationM: number | null;
  idealRangeKm: number | null;
  estRangeKm: number | null;
  ratedRangeKm: number | null;
  tpmsFl: number | null; tpmsFr: number | null;
  tpmsRl: number | null; tpmsRr: number | null;
  outsideTempC: number | null;
  insideTempC: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface TripSeries { samples: PositionSample[] }
export interface AvailableColumns {
  positions: Set<string>; drives: Set<string>;
  cars: Set<string>; addresses: Set<string>;
}
export interface SqlQuery { refId: string; rawSql: string }
export type GrafanaErrorKind =
  | 'network' | 'auth' | 'cors' | 'query' | 'noDatasource' | 'notFound';
```

```ts
// fields.ts
export interface Units {
  speedUnit: 'mph' | 'kmh';
  distanceUnit: DistanceUnit;
  temperatureUnit: TemperatureUnit;
  pressureUnit: PressureUnit;
  elevationUnit: ElevationUnit;
}
export interface FieldDef {
  key: string;
  label: string;
  group: 'trip' | 'live';
  /** Renders the value, or '—' for null/undefined. Never returns 'NaN'. */
  format(value: unknown, units: Units, trip?: TripSummary): string;
}
export const TRIP_FIELDS: FieldDef[];
export const LIVE_FIELDS: FieldDef[];
export function fieldByKey(key: string): FieldDef | undefined;
```

`TRIP_FIELDS` covers: `trip_distance`, `trip_duration`, `trip_avg_speed`,
`trip_max_speed`, `trip_max_power`, `trip_min_power`, `trip_energy`,
`trip_start_battery`, `trip_end_battery`, `trip_ascent`, `trip_descent`,
`trip_start_place`, `trip_end_place`, `trip_outside_temp`, `trip_inside_temp`.

`LIVE_FIELDS` covers: `battery`, `usable_battery`, `power`, `range`, `odometer`,
`elevation`, `tpms_fl`, `tpms_fr`, `tpms_rl`, `tpms_rr`, `outside_temp`,
`inside_temp`.

**Deliberately absent: speed, GPS, acceleration, steering, pedals, blinkers,
gear, autopilot.** The clip's own SEI stream already provides these at frame
rate and the exporter already burns them in (spec §4.3). Adding them here would
duplicate the existing overlay with lower-fidelity data. A test asserts no field
key is named `speed`, `latitude`, `longitude` or `acceleration`, so this stays
true.

**Steps**

- [ ] **1. Write the failing test.** Assert, for each unit setting, a known
  conversion: 100 km → `62.1 mi`; 2.9 bar → `42.1 psi`; 20 °C → `68.0 °F`;
  100 km/h → `62 mph`; 100 m → `328 ft`. Assert `power` renders a negative value
  with a regen marker and a positive value without one. Assert **every** field
  returns `'—'` for `null`, `undefined` and `NaN`, and that no formatter ever
  returns a string containing `NaN`. Assert `fieldByKey` round-trips every key in
  both catalogues.
- [ ] **2. Run it and confirm it fails** — `npm test -- fields`.
- [ ] **3. Implement** `types.ts` and `fields.ts`.
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 2: The Grafana client

**Files:** create `src/lib/teslamate/client.ts`,
`src/lib/teslamate/__tests__/client.test.ts`

**Interfaces — consumes:** `SqlQuery`, `GrafanaErrorKind`.
**Produces:**

```ts
export class GrafanaError extends Error { readonly kind: GrafanaErrorKind; }

export interface GrafanaConnection { baseUrl: string; token: string | null }
export interface DatasourceInfo { uid: string; name: string; type: string }
/** Column-oriented, already parsed. rowCount is 0 for an empty frame. */
export interface Frame { fields: string[]; columns: Record<string, unknown[]>; rowCount: number }

export function buildUrl(baseUrl: string, path: string): string;
export async function queryFrames(
  conn: GrafanaConnection, queries: SqlQuery[]
): Promise<Record<string, Frame>>;
export async function listDatasources(
  conn: GrafanaConnection
): Promise<DatasourceInfo[]>;
```

`buildUrl` is exported separately because it is the pure part and the part most
likely to be wrong.

**Steps**

- [ ] **1. Write the failing test.** Mock `fetch`.
  - `buildUrl` with `/grafana-proxy`, `/grafana-proxy/`, `https://h/grafana`,
    `https://h/grafana/` — all must yield exactly one slash before `api/…`
    (**Review Focus 2**).
  - `queryFrames` posts to the URL from `buildUrl`, sets
    `Authorization: Bearer …` only when a token is present, and sends `refId`s.
  - A response frame with `values: []` parses to `rowCount: 0` and does not
    throw (**Review Focus 1**).
  - A 401 maps to `kind: 'auth'`; a rejected fetch maps to `kind: 'network'`;
    a per-query `error` in the body maps to `kind: 'query'`.
  - `listDatasources` uses `GET` and maps a 403 to `kind: 'auth'`.
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement.** Parse Grafana's frame shape
  (`results[refId].frames[0].schema.fields[].name` +
  `results[refId].frames[0].data.values`, column-major) into `Frame`. Treat a
  missing `frames` array or empty `values` as `rowCount: 0`. Do **not** attempt
  CORS detection here beyond mapping a rejected fetch on an absolute URL to
  `kind: 'cors'` when a prior request to the same origin succeeded; keep that
  heuristic in one function with a comment.
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 3: SQL builders and the schema probe

**Files:** create `src/lib/teslamate/queries.ts`, `src/lib/teslamate/schema.ts`,
`src/lib/teslamate/__tests__/queries.test.ts`,
`src/lib/teslamate/__tests__/schema.test.ts`

**Interfaces — consumes:** `AvailableColumns`, `SqlQuery`.
**Produces:**

```ts
// queries.ts
export function probeSchemaQuery(): SqlQuery;
export function carsQuery(): SqlQuery;
export function tripQuery(
  carId: number, startMs: number, endMs: number, cols: AvailableColumns
): SqlQuery;
export function positionsQuery(
  carId: number, startMs: number, endMs: number, cols: AvailableColumns
): SqlQuery;

// schema.ts
export function parseSchemaProbe(frame: Frame): AvailableColumns;
```

**Steps**

- [ ] **1. Write the failing tests.**
  - `queries.test.ts`: every generated SQL string that filters by time contains
    the **parenthesised** form `(to_timestamp(<ms>/1000.0) AT TIME ZONE 'UTC')`
    (**Constraint 2**). `tripQuery` contains `end_date IS NULL`
    (**Constraint 4**). `positionsQuery` contains `GROUP BY 1` and
    `date_trunc('second'`. A non-integer `carId` (e.g. `1.5`, `NaN`,
    `'1; DROP TABLE'`) throws rather than being interpolated
    (**Constraint 1**). Given `AvailableColumns` without `tpms_pressure_fl`,
    `positionsQuery` omits that column and still emits the rest
    (**Constraint 5**).
  - `schema.test.ts`: `parseSchemaProbe` maps a two-column frame of
    `table_name`/`column_name` into four `Set`s; a frame with `rowCount: 0`
    yields four empty sets rather than throwing (**Review Focus 1**).
- [ ] **2. Run them and confirm they fail.**
- [ ] **3. Implement.** Build the `SELECT` list by filtering a static
  `[columnName, outputAlias]` table against `cols.positions` / `cols.drives`.
  Validate `carId`/`startMs`/`endMs` with `Number.isSafeInteger` and throw a
  plain `Error` otherwise.
- [ ] **4. Run them and confirm they pass.**
- [ ] **5. Commit.**

---

## Task 4: Trip matching

**Files:** create `src/lib/teslamate/match.ts`,
`src/lib/teslamate/__tests__/match.test.ts`

**Interfaces — consumes:** `TripSummary`.
**Produces:**

```ts
/** Wall-clock epoch for a frame. `tzOffsetMinutes` null = browser timezone. */
export function clipWallClockMs(
  momentTimestamp: Date, localTimeSec: number, tzOffsetMinutes: number | null
): number;

/** The trip with the greatest overlap with [clipStartMs, clipEndMs], or null. */
export function selectTripForClip(
  clipStartMs: number, clipEndMs: number, trips: TripSummary[]
): TripSummary | null;

/** True when the clip overlaps more than one trip. */
export function spansMultipleTrips(
  clipStartMs: number, clipEndMs: number, trips: TripSummary[]
): boolean;
```

`clipWallClockMs` with a non-null offset reinterprets the same wall clock in the
recording timezone. Derivation: `new Date(y,m,d,h,mi,s).getTime()` yields
`Date.UTC(W) − browserOffEast·60000`, and the true epoch is
`Date.UTC(W) − tzOffsetMinutes·60000`, so

```
browserMs      = momentTimestamp.getTime() + localTimeSec * 1000
browserOffEast = -new Date(browserMs).getTimezoneOffset()   // minutes EAST of UTC
result         = browserMs + browserOffEast * 60_000 - tzOffsetMinutes * 60_000
```

Note the **sign**: a positive `tzOffsetMinutes` moves the epoch **earlier**. The
intuitive-looking `browserMs − browserOffEast·60000 + tzOffsetMinutes·60000` is
wrong — it double-counts the browser offset. `tzOffsetMinutes` is the recording
location's offset east of UTC, and `null` means "use the browser's".

**Steps**

- [ ] **1. Write the failing test.** The wall-clock assertions must be
  **host-timezone independent** — compare against a value built from
  `Date.UTC(...)`, never against a hard-coded ISO string, or the suite passes
  only on the machine that wrote it:

```ts
const W = Date.UTC(2026, 0, 15, 12, 0, 0);              // wall clock, as UTC components
const d = new Date(2026, 0, 15, 12, 0, 0);              // same wall clock, browser-local
const localTimeSec = 0;

it("uses the browser timezone when the offset is null", () => {
  expect(clipWallClockMs(d, localTimeSec, null)).toBe(d.getTime());
});

it("reinterprets the wall clock in the recording timezone", () => {
  for (const target of [0, 120, 240, -300]) {
    expect(clipWallClockMs(d, localTimeSec, target)).toBe(W - target * 60_000);
  }
});

it("shifts by localTime within the clip", () => {
  expect(clipWallClockMs(d, 30, null)).toBe(d.getTime() + 30_000);
});

it("is correct across a DST transition", () => {
  // 2026-03-29 is a DST transition in Europe; using a fixed target offset keeps
  // the expectation independent of the host's zone and its DST rules.
  const w = Date.UTC(2026, 2, 29, 12, 0, 0);
  const dd = new Date(2026, 2, 29, 12, 0, 0);
  expect(clipWallClockMs(dd, 0, 60)).toBe(w - 60 * 60_000);
});
```

  Then `selectTripForClip`: a clip fully inside one trip selects it; a clip
  straddling two selects the larger overlap; a clip overlapping none returns
  `null`; a clip overlapping a trip with `endMs: null` (open) selects it
  (**Constraint 4**); a zero-length clip at a trip boundary resolves
  deterministically. And `spansMultipleTrips` is true only when two overlaps are
  non-zero.
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement** `clipWallClockMs`, `selectTripForClip` and
  `spansMultipleTrips` in `src/lib/teslamate/match.ts`. Overlap is
  `min(clipEnd, tripEnd ?? Infinity) − max(clipStart, tripStart)`, clamped at 0.
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 5: Position series and lookup

**Files:** create `src/lib/teslamate/series.ts`,
`src/lib/teslamate/__tests__/series.test.ts`

**Interfaces — consumes:** `PositionSample`, `TripSeries`.
**Produces:**

```ts
export function buildSeries(samples: PositionSample[]): TripSeries;  // sorts ascending
export function sampleAt(series: TripSeries, tMs: number): PositionSample | null;
```

**Steps**

- [ ] **1. Write the failing test.**

```ts
// samples at t=0, 1000, 2000. speed is dense; tpmsFl only at t=0 and t=2000.
const s = (tMs: number, speedKmh: number | null, tpmsFl: number | null): PositionSample => ({
  tMs, speedKmh, tpmsFl,
  powerKw: null, batteryPct: null, usableBatteryPct: null, odometerKm: null,
  elevationM: null, idealRangeKm: null, estRangeKm: null, ratedRangeKm: null,
  tpmsFr: null, tpmsRl: null, tpmsRr: null,
  outsideTempC: null, insideTempC: null, latitude: null, longitude: null,
});
const series = buildSeries([s(2000, 30, 2.9), s(0, 10, 2.8), s(1000, 20, null)]);

it("interpolates dense metrics", () => {
  expect(sampleAt(series, 500)!.speedKmh).toBe(15);   // midway 10 -> 20
});

it("carries sparse metrics forward and never invents them", () => {
  expect(sampleAt(series, 500)!.tpmsFl).toBe(2.8);    // last non-null, NOT 2.85
  expect(sampleAt(series, 1500)!.tpmsFl).toBe(2.8);   // still carried, not 2.85
});

it("returns null before the first non-null sparse sample", () => {
  const later = buildSeries([s(0, 10, null), s(1000, 20, 2.9)]);
  expect(sampleAt(later, 500)!.tpmsFl).toBeNull();
});

it("clamps outside the series and handles an empty series", () => {
  expect(sampleAt(series, -1)!.tMs).toBe(0);
  expect(sampleAt(series, 9999)!.tMs).toBe(2000);
  expect(sampleAt(buildSeries([]), 0)).toBeNull();
});
```

  Also assert a series built from unsorted input comes back sorted, and that a
  sample whose sparse fields are all null yields `null` (never `NaN`) so the
  formatter can render "—" (**Review Focus 5**).
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement** `buildSeries` (sort by `tMs`) and `sampleAt` with a binary
  search. For each field: interpolate when both surrounding samples are non-null;
  otherwise carry forward the last non-null value at or before `tMs`.
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 6: Config persistence and base-URL resolution

**Files:** create `src/lib/teslamate/config.ts`,
`src/lib/teslamate/__tests__/config.test.ts`

**Interfaces — consumes:** `TeslaMateConfig`.
**Produces:**

```ts
export const DEFAULT_TESLAMATE_CONFIG: TeslaMateConfig;
export function loadTeslaMateConfig(): TeslaMateConfig;   // merged over defaults
export function saveTeslaMateConfig(cfg: TeslaMateConfig): void;
export function resolveBaseUrl(
  cfg: TeslaMateConfig
): { baseUrl: string; mode: 'direct' | 'proxy' };
```

`loadTeslaMateConfig` never returns a stored token unless `rememberToken` is
true (**Constraint 9**). `resolveBaseUrl` returns `mode: 'proxy'` for a relative
URL and `mode: 'direct'` for an absolute one.

`DEFAULT_TESLAMATE_CONFIG` must pin these values, which come from spec §6.3 and
§6.6:

| Field | Default | Why |
|---|---|---|
| `grafanaUrl` | `'/grafana-proxy'` | Self-hosters get the zero-CORS path by default; a public-site user overwrites it with an absolute URL. |
| `token` | `null` | Anonymous Grafana needs none. |
| `rememberToken` | `false` | Opt-in only. |
| `datasourceUid`, `carId`, `tzOffsetMinutes` | `null` | Resolved/discovered, or browser timezone. |
| `rangeType` | `'ideal'` | |
| `distanceUnit` | `'km'` | |
| `temperatureUnit` | `'c'` | |
| `pressureUnit` | `'bar'` | |
| `elevationUnit` | `'m'` | |
| `liveFields` | `['battery', 'power']` | Useful without crowding the frame. |
| `exportTripFields` | every trip field **except** `trip_start_place` and `trip_end_place` | Geocoded street addresses must not land in a shared video by default (§6.6). |
| `exportLiveFields` | `[]` | Live values step at 1 Hz, so they are off by default. |
| `panelCorner` | `'top-right'` | |

A test must assert the place fields are absent from `exportTripFields` by
default (§6.6) and that `liveFields` is `['battery', 'power']`.

**Steps**

- [ ] **1. Write the failing test.** Round-trip a config through
  `save`/`load`; a partial stored object merges over defaults; corrupt JSON
  yields defaults rather than throwing; a token is dropped on load when
  `rememberToken` is false; `resolveBaseUrl` classifies `/grafana-proxy` as
  proxy and `https://h` as direct. Assert the defaults table above: `liveFields`
  is `['battery', 'power']`, `exportLiveFields` is empty, and
  `exportTripFields` contains neither `trip_start_place` nor `trip_end_place`
  (§6.6).
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement** using the existing `loadLayoutConfig`/`saveLayoutConfig`
  pattern in `src/types/video.ts` as the model.
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 7: The `useTeslaMate` hook

**Files:** create `src/hooks/useTeslaMate.ts`,
`src/hooks/__tests__/useTeslaMate.test.ts`

**Interfaces — consumes:** everything above, plus `VideoSequence` from
`@/types/video`.
**Produces:**

```ts
export type TeslaMateStatus = 'unconfigured' | 'loading' | 'ready' | 'error';

export interface TeslaMateState {
  status: TeslaMateStatus;
  error: GrafanaError | null;
  cars: CarInfo[];
  /** Trip for the clip at this moment index, or null. */
  tripForMoment(momentIndex: number): TripSummary | null;
  /** Sampled values at this moment and local offset, or null. */
  sampleForMoment(momentIndex: number, localTimeSec: number): PositionSample | null;
  reload(): void;
}

export function useTeslaMate(sequence: VideoSequence | null): TeslaMateState;
```

On connect it: probes the schema, lists cars, and — when `datasourceUid` is
unset — resolves the datasource via `listDatasources`, filtering to
`grafana-postgresql-datasource` (auto-select one; `noDatasource` when none).
When `sequence` changes it issues **one** `queryFrames` call carrying the trip
and positions queries together, and caches by
`(datasourceUid, carId, startMs, endMs)`.

**Steps**

- [ ] **1. Write the failing test.** With `fetch` mocked:
  - Unconfigured config → `status: 'unconfigured'`, no fetch issued.
  - No Postgres datasource → `status: 'error'`, `error.kind: 'noDatasource'`.
  - A ready response → `status: 'ready'`; `tripForMoment` returns the expected
    trip for the moment whose wall clock falls inside it.
  - Two moments in one sequence separated by a merge gap resolve to the correct
    trips, proving the **per-moment** wall clock (**Constraint 7**) — build the
    sequence with `detectSequences` so the gap is real.
  - A second render with the same sequence issues no second fetch (cache).
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement.**
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 8: Settings UI

**Files:** create `src/components/TeslaMateSettings.tsx`; modify
`src/components/VideoPlayer.tsx` (entry point only)

**Interfaces — consumes:** `useTeslaMate` state shape, `config.ts`,
`client.listDatasources`.

A dialog mirroring `DecryptDialog.tsx`: Grafana URL, token (with a "remember"
checkbox), a **Test connection** button, a datasource select (populated from
`listDatasources`, shown only when more than one Postgres datasource exists), a
car select, and a timezone-offset field with a **Detect** action. Every failure
renders the `GrafanaError` message from the spec's §8 table.

**Steps**

- [ ] **1. Write the failing test.** Render the dialog; a failing
  `listDatasources` shows the `cors` message for an absolute URL and the
  `auth` message for a 401; the "remember" checkbox governs whether
  `saveTeslaMateConfig` is called with a token.
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement**, and add the entry point to `VideoPlayer` (a button in
  the existing toolbar, beside the overlay toggles at
  `VideoPlayer.tsx:1411`).
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 9: The live trip panel

**Files:** create `src/components/TripMetricsPanel.tsx`; modify
`src/components/VideoPlayer.tsx`

**Interfaces — consumes:** `TeslaMateState`, `TRIP_FIELDS`, `LIVE_FIELDS`.

Renders the two sub-blocks (trip summary, live values) from the configured
field lists, in the configured corner. It reads the current moment and local
time from the same playback state the SEI overlay uses, so the two stay in
sync. Shown automatically when `status === 'ready'` and a trip matches; hidden
per session via a toolbar toggle. A moment with no trip renders "No TeslaMate
trip covers this clip"; a trip with `endMs === null` is labelled provisional.

**Steps**

- [ ] **1. Write the failing test.** With a ready state: only configured fields
  render; an empty `liveFields` renders no live block; a null value renders "—";
  an open trip labels itself provisional and shows "—" for distance.
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement**, mounting the panel next to `TelemetryCard`
  (`VideoPlayer.tsx:1036`) and adding the show/hide toggle.
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 10: The field picker

**Files:** create `src/components/TripMetricsConfig.tsx`

**Interfaces — consumes:** `TRIP_FIELDS`, `LIVE_FIELDS`, `TeslaMateConfig`.

A popover modelled on `LayoutConfigPopover.tsx`: multi-selects for the live
panel, the export trip summary and the export live values; the corner picker;
and the unit pickers. Persists through `saveTeslaMateConfig`.

**Steps**

- [ ] **1. Write the failing test.** Toggling a field updates the persisted
  config; the unit selects round-trip; the corner picker offers only corners
  free of the mini-map for the active layout.
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement.**
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 11: Export burn-in

**Files:** modify `src/components/VideoExporter.tsx`

**Interfaces — consumes:** `TripSummary`, `PositionSample`, `TRIP_FIELDS`,
`LIVE_FIELDS`.

Adds `drawTripMetrics(ctx, width, height, trip, sample, units, fieldKeys, corner)`
following the shape of `drawTelemetry` / `drawDateTime`: a `scale` derived from
output dimensions, the portrait branch the existing overlays use, and a
`roundRect` background. Called per rendered frame from the same loop that calls
`drawTelemetry` (`VideoExporter.tsx:1129`), using the frame's `moment` and
`localTime` — the values `drawDateTime` already computes at line 1133.

New props: `showTripMetrics`, `tripForMoment`, `sampleForMoment`,
`tripFieldKeys`, `liveFieldKeys`, `units`, `panelCorner`.

**Steps**

- [ ] **1. Write the failing test.** `drawTripMetrics` against a mock
  `CanvasRenderingContext2D`: it draws the configured fields only, positions in
  the requested corner, and emits no text containing "NaN" or "undefined" when
  the sample is null (**Review Focus 5**, **Constraint 8**).
- [ ] **2. Run it and confirm it fails.**
- [ ] **3. Implement**, threading the new props from `VideoPlayer`
  (`VideoPlayer.tsx:1478`).
- [ ] **4. Run it and confirm it passes.**
- [ ] **5. Commit.**

---

## Task 12: The nginx proxy, Docker, and the README

**Files:** create `templates/default.conf.template`; delete `nginx.conf`;
modify `Dockerfile`, `docker-compose.yml`, `README.md`

The template is `nginx.conf` **plus** the `/grafana-proxy/` block from spec §7.
The block must:

- `return 404` when `$grafana_upstream` is `""`;
- `rewrite ^/grafana-proxy/(.*)$ /$1 break;` before `proxy_pass`, because a
  variable in `proxy_pass` discards the request path;
- use `$proxy_host`, never a hand-made variable — `nginx -t` fails on an
  undefined one;
- forward both `GET` (datasource discovery) and `POST` (queries);
- relay `Authorization` and never log it.

`Dockerfile` sets `ENV GRAFANA_UPSTREAM=""` and copies `templates/` to
`/etc/nginx/templates/`. The `resolver` directive is emitted only when the
upstream is a hostname.

**Steps**

- [ ] **1. Verify the config parses.** `docker run --rm -v
  "$PWD/templates:/etc/nginx/templates:ro" -e GRAFANA_UPSTREAM=http://grafana:3000
  nginx:alpine nginx -t` — must succeed. Then with `GRAFANA_UPSTREAM=""`, and
  with it unset.
- [ ] **2. Verify behaviour end to end** against a throwaway backend on a
  Docker network: a `POST` to `/grafana-proxy/api/ds/query` arrives upstream as
  `/api/ds/query`; a `GET` to `/grafana-proxy/api/datasources` arrives as
  `/api/datasources`; `Authorization` is relayed; an unset upstream returns 404.
- [ ] **3. Implement** the template, Dockerfile, compose and README changes.
- [ ] **4. Re-run steps 1 and 2** and confirm.
- [ ] **5. Commit.**

---

## Task 13: Live-instance verification script

**Files:** create `scripts/verify-teslamate.mjs`

Reads `GRAFANA_URL` and `GRAFANA_TOKEN` from the environment and asserts against
a real instance: the schema probe returns the expected tables; the trip query
for a known window returns the expected `drives.id`; an open drive is returned;
the 1 Hz positions query returns a plausible row count. It exits non-zero on
mismatch. It is **not** wired into CI — it needs a live Grafana.

**Steps**

- [ ] **1. Write the script** with a clear usage banner and no hard-coded
  credentials.
- [ ] **2. Run it** against the reference instance and confirm it passes.
- [ ] **3. Document it** in the README's integration section.
- [ ] **4. Commit.**

---

## Verification

After the last task, run the full gate the repository already defines:

```
npm run lint
npm run test
npm run build
```

Then confirm on the real instance, in order:

1. Connect to Grafana; the car list populates and the datasource resolves.
2. Load a clip set whose timestamps fall inside a known trip; the panel shows
   the trip summary and the configured live values, and they track playback.
3. Enable live fields for the export, export a short range, and confirm the
   burned-in values match the panel at the same timestamps.
4. Run the Docker image with `GRAFANA_UPSTREAM` set and repeat (2) through
   `/grafana-proxy` with no CORS configuration.
5. Load a parked clip and confirm "No TeslaMate trip covers this clip".
6. Point the app at a Grafana with no TeslaMate datasource and confirm the
   `noDatasource` message.
