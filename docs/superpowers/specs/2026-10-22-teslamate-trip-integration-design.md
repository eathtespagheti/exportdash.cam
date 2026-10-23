# TeslaMate Trip Integration — Design

**Date:** 2026-10-22
**Status:** Draft for approval
**Board:** `eathtespagheti/exportdash.cam` → "Development" (GitLab, Free tier)

---

## 1. Intent and why

A Tesla dashcam clip carries a timestamp in its filename, and TeslaMate records the
same drive as a first-class row in its Postgres database. That makes it possible to
answer questions the MP4 alone cannot: what was the **battery level**, **motor
power**, **tire pressure**, **odometer**, **elevation** and **ambient temperature**
at the moment this clip was recorded — and what the **trip as a whole** looked like
(distance, duration, average and maximum speed, energy used, where it started and
ended).

Today ExportDash can only show what the camera itself recorded. Everything in the
TeslaMate schema is invisible to it. This feature closes that gap: match a clip to
its TeslaMate trip, then surface those metrics both **live during playback** and
**burned into the exported video**.

### 1.1 Verified against the live instance

Every schema and behaviour claim in this document was verified by querying the real
Grafana/TeslaMate instance (Grafana 13.2.2, TeslaMate Postgres) rather than
assumed. The findings that shaped the design:

| Finding | Consequence for the design |
|---|---|
| TeslaMate stores data in **PostgreSQL**, not InfluxDB. The Grafana datasource is type `grafana-postgresql-datasource`. | We query via Grafana's `/api/ds/query` with raw SQL. "Download from Grafana" means "Grafana proxies a SQL query to TeslaMate's Postgres". |
| **`positions` is the time series**, `drives` the per-trip aggregate, `cars` the vehicle list, `addresses` the geocoded places, `states` the asleep/driving/charging periods. | Two query shapes: one for the trip row, one for the position series. |
| `positions.date` is `timestamp without time zone` and stores **UTC**. The Grafana datasource session is `Etc/UTC`. | Every query must convert epoch-ms bounds explicitly via `to_timestamp(ms/1000.0) AT TIME ZONE 'UTC'`. Naive `date` comparisons silently break. |
| `positions` in a driving window is dense (~140 rows/minute), but **TPMS and temperatures appear in only ~30 of 1260 rows** (~every 15–40s). | Sparse metrics carry forward the last known value; they are never interpolated. |
| Power is **signed**: negative = regen (observed −55 kW to +116 kW). | The overlay must distinguish consumption from regen, not show a bare signed number. |
| TeslaMate exposes **no** acceleration column. | Acceleration stays sourced from the clip's own SEI data; the two sources complement rather than duplicate each other. |
| A **non-admin** Grafana service-account token can list datasources *and* run `/api/ds/query`. | A Viewer-role service account is sufficient. No admin rights are needed or requested. |
| Grafana's CSRF check **only applies when a login cookie is present**. A `Bearer` token request has no cookie, so CSRF is skipped. | No `csrf_trusted_origins` change is required. |
| Grafana OSS ships **no CORS middleware at all** — no `Access-Control-Allow-Origin` is ever emitted. | Cross-origin browser access requires the user to add CORS headers at their reverse proxy, or use the bundled same-origin proxy. This is the single biggest setup cost of the feature. |
| Grafana's `rawSql` query has **no bind parameters** — the SQL is executed as literal text. | Every interpolated value must be validated client-side. The only values are safe integers (§5.1). |
| `/api/ds/query` is **POST-only**; `GET` returns 404. | The proxy must forward `POST` (and `GET` for datasource discovery), not `GET` only. |
| A drive in progress has **`end_date = NULL`** (19 of 1207 rows on the live instance). | The trip query must include `end_date IS NULL`, or the trip currently being recorded never matches. Such a trip is provisional. |
| `maxDataPoints` does **not** truncate a raw SQL result — 585 rows returned identically at 100, 1000 and 50000. | The 1 Hz aggregation, not `maxDataPoints`, is what bounds the payload. |
| `ascent`/`descent` were added in **TeslaMate 2.1.0** (June 2026); `tpms_pressure_*` in 2022. | Column availability varies by TeslaMate version, so the schema probe (§5.1) is required for graceful degradation. |
| `cars.efficiency` (0.1367 kWh/km here) plus the range delta yields energy used; TeslaMate's own dashboard computes it as `range_diff * car_efficiency`. | Energy used is computed client-side from the same inputs TeslaMate uses, so our number matches theirs. |

### 1.2 A correction to the original premise

The request described "logging into Grafana and downloading the metrics from there."
Grafana is not a metrics store — it is a query proxy in front of TeslaMate's
Postgres. Querying it therefore means **sending SQL through the Grafana API**.

That is the right seam, and it is why this feature is feasible at all without
exposing a database: the user already exposes Grafana, Grafana already has the
Postgres connection, and Grafana already has an authorization model. The cost is
that the app must speak SQL and must be careful about it (see §6.4).

---

## 2. Goals, non-goals, anti-goals

### Goals

1. Match each loaded clip to its TeslaMate trip, automatically, by timestamp.
2. Show trip-level metrics (distance, duration, avg/max speed, energy used,
   start/end place, elevation gain) and live vehicle metrics (battery, power,
   tire pressure, range, odometer, elevation, temperature) **during playback**.
3. Burn the same configurable metric set into the **exported video**.
4. Let the user decide **which metrics appear**, where, and how they are formatted.
5. Work against a **self-hosted Grafana** without requiring that Grafana to be
   publicly reachable or CORS-enabled.
6. Preserve the app's existing guarantee: **nothing leaves the user's machine
   except queries to the user's own Grafana**.

### Non-goals

- Writing anything back to TeslaMate or Grafana.
- Ingesting TeslaMate's MQTT stream (a real alternative, but it needs a broker
  the user exposes — a bigger ask than a Grafana URL).
- Supporting InfluxDB-backed TeslaMate instances. Modern TeslaMate is
  Postgres-only; the schema and query surface are Postgres-specific.
- Supporting multiple cars beyond selecting **one** active car per session.
- Real-time streaming of metrics while recording. The data is historical by
  nature.

### Anti-goals

- **No metric the user cannot turn off.** If a metric is shown, the user chose it.
- **No silent fallbacks that mislead.** If a metric cannot be resolved for a clip
  (no matching trip, or a TeslaMate instance that lacks the column), the UI says
  so rather than showing a zero or a stale value.
- **No credentials reaching our servers.** There is no backend. Tokens live in
  the user's browser and travel only to the user's own Grafana.

---

## 3. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | The app is a **static export** (`output: "export"`). There is no server to proxy through on the public deployment. | `next.config.ts` |
| C2 | Grafana OSS emits **no CORS headers**. Direct browser access from another origin fails the preflight. | Verified: no CORS middleware in the Grafana source tree; live `OPTIONS` returns 401 with no `Access-Control-Allow-Origin`. |
| C3 | The Docker image ships **nginx** with a hand-written config that already proxies one upstream. | `nginx.conf`, `Dockerfile` |
| C4 | Grafana's `rawSql` datasource query accepts **arbitrary SQL** — the app is responsible for the queries it sends. | `/api/ds/query` |
| C5 | Clip filenames are **local time**; TeslaMate stores **UTC**. The app currently parses filenames as local browser time. | `parseTimestamp` in `src/types/video.ts` |
| C6 | The exporter renders at a **fixed 30 fps** by seeking hidden `<video>` elements frame by frame, then composites overlays onto a canvas. | `src/components/VideoExporter.tsx` |
| C7 | SEI telemetry is already extracted per frame and is already burned into the export. | `src/lib/dashcam-mp4.ts`, `VideoExporter` |
| C8 | The repo is **100% client-side** today; every existing feature works with no network. | README |
| C9 | Users' clip folders typically contain **hundreds to thousands of clips** spanning hours. | Domain |
| C10 | The repo already establishes a pattern for **per-user configurable output**: `LayoutCameraConfig` + `LayoutConfigPopover` + `localStorage` persistence. | `src/types/video.ts`, `src/components/LayoutConfigPopover.tsx` |

---

## 4. Approaches considered

### 4.1 How to reach Grafana

**A. Direct browser → user's Grafana.** The app calls the user's Grafana URL
directly from the browser, with the user's token.

- ✅ Works on the public deployment (exportdash.cam) with zero server work.
- ✅ Credentials never touch our infrastructure.
- ❌ Requires CORS headers on the user's reverse proxy (C2) — a setup step that
  must be documented, and that users get wrong in ways that produce confusing
  failures.

**B. A proxy in the ExportDash deployment that forwards to a user-specified
Grafana URL.** Rejected: the proxy would accept an arbitrary upstream URL from
the browser, making it an **open relay and an SSRF vector**. It would also have
to carry the user's Grafana token through our servers, breaking the
"nothing leaves your machine" property.

**C. Same-origin proxy in the user's own deployment (Docker image).** nginx
forwards `/grafana-proxy/` to a Grafana URL **configured by the operator at
deploy time**, not by the browser at request time.

- ✅ No CORS at all — the browser makes a same-origin request.
- ✅ Grafana need not be publicly reachable; it can live on a LAN.
- ✅ The token still travels only between the browser and the user's own machine.
- ✅ No open-relay risk: the upstream is fixed in the image's config.
- ❌ Only helps people who run the Docker image.

**Decision: implement A and C together, as two transports behind one client.**

They are not alternatives — they are the same client pointed at a different base
URL. The app asks the user for a Grafana URL and detects the mode:

- If the configured URL is **relative** (e.g. `/grafana-proxy`), use the
  same-origin proxy transport. No CORS needed.
- If the configured URL is **absolute** (`https://grafana.example.com`), use the
  direct transport. CORS must be configured on the user's proxy.

One code path, one config field, two transports. Self-hosters get the
zero-friction path; public-site users get the direct path. The Docker image
ships the nginx proxy block (§7).

### 4.2 What to fetch

**A. Per-clip targeted queries.** For each clip, query its exact window.
Precise, but N round trips for N clips (C9), and repeated queries for
overlapping sequences.

**B. Batch by sequence.** One query per *sequence* (a contiguous run of clips),
covering the sequence's whole time span.

**C. Fetch the whole day.** Simple, but wasteful and can exceed `maxDataPoints`.

**Decision: B — batch by sequence, cached by time range.**

A sequence is the unit the user actually plays and exports, so one query per
sequence is both efficient and semantically right. Results are cached by
`(datasourceUid, carId, startMs, endMs)` so re-selecting a sequence is free.
The datasource UID is part of the key because switching datasources changes
what the data means.

A sequence can span **more than one trip** — clips from two separate drives
separated by a pause can be merged into one sequence by `detectSequences`.
The trip is therefore resolved **per clip**, not per sequence (§5.3), and the
panel shows the trip of the clip currently on screen. The trip summary is
labelled with the trip it describes so a multi-trip sequence is never
mistaken for one long trip.

**Response size.** The 1 Hz aggregation bounds a one-hour window to ~585
rows. A sequence spanning many hours would grow linearly; the client caps the
queried window and reports that metrics are unavailable beyond it rather than
issuing an unbounded query.

### 4.3 Where the metrics live

**A. One merged telemetry stream.** Merge TeslaMate rows into the SEI stream so
there is one source of truth.

- ✅ Simple downstream.
- ❌ Destroys the distinction between "the camera measured this" and "TeslaMate
  recorded this", and the two have different rates (30 fps vs ~2.3 Hz) and
  different coverage. Merging would force one interpolation policy on both.

**B. Keep two sources; compose at render time.** SEI and TeslaMate stay
separate; the overlay renders fields from whichever source provides them.

- ✅ Each source keeps its own semantics (per-frame vs carried-forward).
- ✅ A clip without a matching trip still shows its SEI telemetry.
- ✅ The app already has a per-frame time-lookup for SEI (`getSeiForTime`); the
  TeslaMate side gets an analogous, much simpler lookup.
- ❌ Two lookups to keep in sync at render time.

**Decision: B.**

The rule: **TeslaMate supplies what SEI lacks; SEI stays authoritative for what
it already has.** Speed and GPS come from SEI (frame-accurate, already burned
in). TeslaMate supplies battery, power, tire pressure, range, odometer,
elevation, temperature, and the trip aggregates.

### 4.4 Overlay layout

**A. Burn trip metrics into the existing telemetry box.** Extend the current
top-centre overlay.

- ❌ That box is already dense and tuned to a fixed shape; adding trip-level
  summary text to it would crowd the speed/gear display.

**B. A separate trip panel, positioned independently.** A second overlay block
with its own position, whose contents are the user's configured metric list.

- ✅ Complements the existing overlay instead of fighting it.
- ✅ The trip summary (constant for the trip) and the live values (varying) are
  different shapes of data and want different treatments.
- ✅ Position is configurable, consistent with how the app already handles
  camera layout.

**Decision: B — a separate, independently configurable trip panel.**

Two sub-blocks within it:

- **Trip summary** — constant for the matched trip (distance, duration, avg
  speed, energy used, start→end place, elevation gain).
- **Live values** — vary with playback (battery, power, tire pressure, range,
  odometer, elevation, temperature).

Both are field-configurable: the user picks which fields appear in each.

---

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (100% client-side, unchanged in this respect)       │
│                                                              │
│  src/lib/teslamate/                                          │
│    client.ts      transport-agnostic Grafana client          │
│    queries.ts     SQL builders (validated ints only)         │
│    schema.ts      column probe → available-field set         │
│    match.ts       clip timestamp → trip row                   │
│    series.ts      position series → time lookup + carry-fwd  │
│    types.ts       TripMetrics, PositionSample, config        │
│                                                              │
│  src/hooks/useTeslaMate.ts   connection + fetch + cache      │
│  src/components/TeslaMateSettings.tsx    URL/token/car       │
│  src/components/TripMetricsPanel.tsx      live playback view │
│  src/components/TripMetricsConfig.tsx     field picker       │
│                                                              │
│  VideoPlayer  ──▶ overlay composes SEI + trip fields        │
│  VideoExporter ──▶ drawTripMetrics() burns configured fields │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
      transport A (direct)            transport C (same-origin)
      Authorization: Bearer            POST /grafana-proxy/...
               │                               │
               ▼                               ▼
      https://grafana.example.com   nginx → GRAFANA_UPSTREAM
               │                      (operator-configured)
               └───────────┬───────────┘
                           ▼
                  Grafana /api/ds/query
                           ▼
                  TeslaMate Postgres (positions, drives, cars)
```

### 5.1 Module boundaries

**`src/lib/teslamate/client.ts`** — the only module that knows about HTTP.
- `grafanaFetch(baseUrl, token, queries): Promise<Frame[]>` — POSTs to
  `/api/ds/query`, returns parsed frames.
- Base URL may be absolute or relative. Relative → same-origin (no CORS).
- The client calls **two** Grafana endpoints: `POST /api/ds/query` for
  queries and `GET /api/datasources` for datasource discovery. Both are
  POST-or-GET as appropriate; the proxy forwards both.
- Token is attached as `Authorization: Bearer <token>` only when present
  (an anonymous-access Grafana needs no token).
- Errors are normalised into `GrafanaError` with a `kind`:
  `network | auth | cors | query | noDatasource | notFound`. **The `cors` kind
  is what lets the UI say "add CORS headers to your proxy" instead of
  "something went wrong."** A CORS failure is indistinguishable from a
  network failure at `fetch()` level, so it is detected by *elimination*: a
  failed request to a known-good URL with a token that works elsewhere →
  likely CORS. The error message says so explicitly rather than guessing
  silently.

**`src/lib/teslamate/queries.ts`** — pure functions producing SQL strings.
No HTTP. Each returns a typed query object.

> **Binding.** Grafana's `rawSql` datasource query has **no bind-parameter
> mechanism** — the SQL is sent as literal text and executed as-is. There are
> no `$1` placeholders and Grafana's `$var` interpolation applies only to
> dashboard template variables, not to API queries. Every value that reaches
> the SQL text must therefore be interpolated client-side.
>
> This is safe **by construction, not by escaping**: the only values
> interpolated are (a) the selected car's `id` and (b) millisecond timestamps
> — all of which the app generates or selects from a list, and all of which
> are validated as safe integers (`Number.isSafeInteger`) before being
> stringified. No user-supplied free text ever enters the SQL. The one
> user-supplied string — the Grafana URL — is used only to build the HTTP
> request, never the query.

**`src/lib/teslamate/schema.ts`** — probes `information_schema.columns` once
per connection to learn which columns actually exist on `positions` and
`drives`, then the query builders select only those.

This exists because **one undefined column aborts an entire SQL statement**.
A monolithic `SELECT` containing a column absent from the user's TeslaMate
version would kill every live field at once. Probing first turns that into
per-field graceful degradation, and also shrinks the payload.

The probe is one cheap query against `information_schema`, whose `table_name`
and `column_name` are stable across TeslaMate versions. Columns known to vary
by version include `ascent`/`descent` (added in TeslaMate 2.1.0, June 2026),
`usable_battery_level`, `est_battery_range_km`, and the `tpms_pressure_*`
family (added in 2022).

**`src/lib/teslamate/match.ts`** — given a clip's local timestamp and the
car's position rows, find the trip. Pure, unit-testable.

**`src/lib/teslamate/series.ts`** — given position rows, provide
`sampleAt(tMs)` returning the field values at an arbitrary instant, with
carry-forward for sparse metrics. Pure, unit-testable.

### 5.1.1 Datasource selection

The queries need a `datasource.uid`. On connect, the app calls
`GET /api/datasources`, filters to `type === 'grafana-postgresql-datasource'`,
and:

- **exactly one match** → auto-select it, and let the user override.
- **several matches** → ask the user to pick one.
- **none** → report "no TeslaMate datasource found" as a distinct error from
  "the query failed".

The chosen UID is persisted with the connection. This matters because Grafana
falls back to the instance default datasource when the UID is absent, which is
not deterministic for a user with several datasources.

### 5.1.2 The wall clock

The authoritative instant for a frame is **per moment**, not per sequence:

```
wallClockMs = moment.timestamp.getTime() + localTime * 1000
```

This is exactly what the existing `drawDateTime` already does
(`VideoExporter.tsx:1133`). It matters because `sequence.startTime +
absoluteTime` is **wrong**: `detectSequences` merges clips separated by up to
65 seconds (`SEQUENCE_GAP_THRESHOLD_SECONDS`) and `momentOffsets` accumulates
only clip *durations*, so the sequence clock drifts from wall-clock time by
the accumulated gaps — potentially minutes. A drift of that size silently
attaches the wrong trip to a clip and makes burned-in values wrong frame by
frame.

The moment is located with the existing `findMomentForTime` helper
(`src/lib/sequence-detector.ts`), which already does this binary search.

**`src/hooks/useTeslaMate.ts`** — React glue: connection state, per-sequence
fetching, caching, error surfacing.

### 5.2 The two queries

Both queries are sent as **one** `/api/ds/query` request with two `refId`s —
the endpoint supports multiple queries per request, so this is one round trip.

Values are interpolated as validated integers (see §5.1). The `at_time_zone`
conversion is written as a **function call with the argument parenthesised**:

```sql
(to_timestamp(<start_ms>/1000.0) AT TIME ZONE 'UTC')
```

Postgres parses `BETWEEN x AT TIME ZONE 'UTC' AND y AT TIME ZONE 'UTC'` as
`BETWEEN x AT (TIME ZONE 'UTC' AND y)` and rejects it with
`syntax error at or near "AT"`. The parentheses fix it; verified against the
live instance.

**Query 1 — find the trip(s) overlapping a time window.**

```sql
SELECT d.id, d.start_date, d.end_date, d.distance, d.duration_min,
       d.speed_max, d.power_max, d.power_min,
       d.ascent, d.descent, d.outside_temp_avg, d.inside_temp_avg,
       d.start_ideal_range_km, d.end_ideal_range_km,
       d.start_km, d.end_km,
       c.efficiency,
       sp.battery_level AS start_battery_level,
       ep.battery_level AS end_battery_level,
       sa.display_name AS start_place,
       ea.display_name AS end_place
FROM drives d
JOIN cars c ON c.id = d.car_id
LEFT JOIN positions sp ON sp.id = d.start_position_id
LEFT JOIN positions ep ON ep.id = d.end_position_id
LEFT JOIN addresses sa ON sa.id = d.start_address_id
LEFT JOIN addresses ea ON ea.id = d.end_address_id
WHERE d.car_id = <car_id>
  AND d.start_date <= (to_timestamp(<end_ms>/1000.0) AT TIME ZONE 'UTC')
  AND (d.end_date IS NULL
       OR d.end_date >= (to_timestamp(<start_ms>/1000.0) AT TIME ZONE 'UTC'))
ORDER BY d.start_date
```

Three details in this statement are load-bearing:

- **`d.end_date IS NULL` is included.** TeslaMate writes a `drives` row when a
  drive *starts* and fills `end_date` when it *ends*, so the trip you are
  driving right now has `end_date = NULL`. Without the `IS NULL` branch,
  `d.end_date >= …` evaluates to NULL and the row is excluded — meaning the
  trip you are currently recording would never match, and would only become
  visible after the car stopped. (19 of 1207 drives on the live instance are
  in this open state.) An open drive is **provisional**: its distance, energy
  and ascent are NULL, so those fields show "—", never 0.
- **`cars` is joined for `efficiency`**, without which the energy formula has
  no input.
- **`positions` is joined on `start_position_id`/`end_position_id`** for the
  start and end battery level. The `drives` table has no battery columns.

**Query 2 — the position series for that window**, aggregated to 1 Hz so the
payload stays bounded and the sampling grid is uniform:

```sql
SELECT date_trunc('second', date) AS t_ms,
       avg(speed) AS speed_kmh,
       avg(power) AS power_kw,
       max(battery_level) AS battery_pct,
       max(usable_battery_level) AS usable_battery_pct,
       max(odometer) AS odometer_km,
       max(elevation) AS elevation_m,
       max(ideal_battery_range_km) AS ideal_range_km,
       max(est_battery_range_km) AS est_range_km,
       max(rated_battery_range_km) AS rated_range_km,
       max(tpms_pressure_fl) AS tpms_fl,
       max(tpms_pressure_fr) AS tpms_fr,
       max(tpms_pressure_rl) AS tpms_rl,
       max(tpms_pressure_rr) AS tpms_rr,
       max(outside_temp) AS outside_temp_c,
       max(inside_temp) AS inside_temp_c,
       max(latitude) AS latitude,
       max(longitude) AS longitude
FROM positions
WHERE car_id = <car_id>
  AND date >= (to_timestamp(<start_ms>/1000.0) AT TIME ZONE 'UTC')
  AND date <  (to_timestamp(<end_ms>/1000.0) AT TIME ZONE 'UTC')
GROUP BY 1
ORDER BY 1
```

The `SELECT` list is **built dynamically** from the columns the schema probe
found (§5.1), so a TeslaMate version lacking `tpms_pressure_fl` simply does
not get that column — and the corresponding field degrades to unavailable
rather than taking the whole query down with it.

The 1 Hz aggregation also bounds the response: verified at 585 rows for a
one-hour window, and `maxDataPoints` does **not** truncate it (585 rows
returned identically at `maxDataPoints` of 100, 1000 and 50000).

**Query 3 — the schema probe**, run once per connection:

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('positions', 'drives', 'cars', 'addresses')
```

### 5.3 Matched-trip resolution

Given a sequence's clips (each with a local-time `Date`) and the position
series:

1. Convert the clip's local `Date` to epoch-ms **for that clip's own moment**
   (§5.1.2). The app already parses filenames as browser-local time
   (`parseTimestamp`), so this is `moment.timestamp.getTime()` — the same
   interpretation the rest of the app uses. If the user views footage recorded
   in a different timezone than their browser is currently set to, this is
   wrong; §8 handles that.
2. Query the `drives` rows overlapping the sequence window, including open
   drives (§5.2).
3. For each candidate trip, compute the **overlap fraction** with the clip
   window. Pick the trip with the greatest overlap.
4. A clip that falls entirely inside a trip gets that trip. A clip straddling
   two trips (a journey split by a pause) is attributed to the trip with the
   larger overlap, and the panel indicates that the clip spans a boundary.
5. A clip with **no** overlapping trip (parked, or TeslaMate wasn't running) is
   reported as "no trip" — never as "trip with zero distance".
6. A trip that is still **open** (`end_date IS NULL`) is marked provisional:
   the fields that depend on the finished trip (distance, energy, ascent) show
   "—" rather than a stale or zero value.

### 5.4 Time-series lookup and carry-forward

`series.ts` builds a sorted array of 1 Hz samples and exposes `sampleAt(tMs)`.

- **Dense metrics** (speed, power, battery, range, odometer, elevation, GPS)
  are interpolated linearly between the two surrounding samples.
- **Sparse metrics** (TPMS, outside/inside temperature) carry forward the last
  non-null value, and are `null` until the first sample that has them. They are
  never interpolated — interpolating a tire pressure between two samples 40
  seconds apart would invent a value the car never reported.

The lookup is a binary search over the sorted timestamps, mirroring the
existing `getSeiForTime` pattern in `VideoPlayer`.

### 5.5 Where the values are rendered

**Live, during playback.** A `TripMetricsPanel` appears alongside the existing
`TelemetryCard`. The live block updates on the same clock the SEI telemetry
uses, so the two read as one coherent display.

**In the export.** A new `drawTripMetrics()` in `VideoExporter` mirrors the
existing `drawTelemetry` / `drawDateTime` / `drawMiniMap` pattern: a canvas
draw call, positioned and scaled from a `scale` factor derived from output
dimensions, honouring the portrait-format branch the existing overlays already
handle. It is called per rendered frame, using the same frame time that
`getSeiForTime` uses, so the burned-in values stay in sync with the burned-in
SEI telemetry.

Because the exporter renders at a fixed 30 fps (C6) and the TeslaMate series is
1 Hz, the burned-in live values will step at 1 Hz. This is inherent to the
source data, and is why the burned-in set defaults to the **trip summary**
(comfortably constant) rather than the live row.

---

## 6. Configuration — everything the user can control

Following the existing `LayoutCameraConfig` + `localStorage` pattern (C10).

### 6.1 Connection

| Setting | Default | Notes |
|---|---|---|
| Grafana URL | none | Absolute (`https://…`) → direct transport; relative (`/grafana-proxy`) → same-origin proxy transport. |
| Service-account token | none | Optional; omit for an anonymous-access Grafana. Stored in `localStorage` **only if** the user opts in, matching the existing decrypt-token pattern. |
| Car | first available | Discovered via `SELECT id, name, model FROM cars`. |
| Connection mode | auto | `auto` picks same-origin when the URL is relative, direct when absolute. Explicit override available. |

### 6.2 Which metrics appear

A field catalogue, each field declaring: key, label, unit, source
(`trip` | `live` | `both`), and formatter.

**Trip-summary fields** (constant per matched trip):

| Key | Label | Unit | Source |
|---|---|---|---|
| `trip_distance` | Distance | km / mi | `drives.distance` |
| `trip_duration` | Duration | h:mm | `drives.duration_min` |
| `trip_avg_speed` | Avg speed | km/h / mph | `distance ÷ duration` — TeslaMate's own dashboard computes it as `distance / coalesce(duration_min * 60, epoch(end_date − start_date)) * 3600` |
| `trip_max_speed` | Max speed | km/h / mph | `drives.speed_max` |
| `trip_max_power` | Max power | kW | `drives.power_max` |
| `trip_min_power` | Max regen | kW | `drives.power_min` (negative) |
| `trip_energy` | Energy used | kWh | `(start_ideal_range_km − end_ideal_range_km) × cars.efficiency` — the same formula TeslaMate's own dashboard uses. Follows the selected range type. |
| `trip_start_battery` / `trip_end_battery` | Battery start / end | % | From the `positions` rows referenced by `drives.start_position_id` / `end_position_id` — the `drives` table has no battery columns. |
| `trip_ascent` / `trip_descent` | Elevation gain / loss | m | `drives.ascent` / `descent` (TeslaMate 2.1.0+; absent on older instances) |
| `trip_start_place` / `trip_end_place` | Start / End place | text | `addresses.display_name` — see §6.6 |
| `trip_outside_temp` / `trip_inside_temp` | Outside / Inside temp | °C / °F | `drives.outside_temp_avg` / `inside_temp_avg` |

**Live fields** (vary with playback):

| Key | Label | Unit | Notes |
|---|---|---|---|
| `battery` | Battery | % | `battery_level` |
| `usable_battery` | Usable battery | % | `usable_battery_level` |
| `power` | Power | kW | Signed. Rendered with an explicit regen indicator. |
| `range` | Range | km / mi | Which of ideal/est/rated is user-selectable. |
| `odometer` | Odometer | km / mi | |
| `elevation` | Elevation | m / ft | |
| `tpms_fl` / `tpms_fr` / `tpms_rl` / `tpms_rr` | Tire pressure FL/FR/RL/RR | bar / psi | Sparse — carried forward. |
| `outside_temp` | Outside temp | °C / °F | Sparse — carried forward. |
| `inside_temp` | Inside temp | °C / °F | Sparse — carried forward. |

### 6.3 Presentation

| Setting | Default | Notes |
|---|---|---|
| Show trip panel | on, once connected | Configuring the integration is the opt-in, so the panel appears automatically when a trip matches and can be hidden per session. |
| Enabled in export | trip summary only | The live values step at 1 Hz (the source rate) and are off by default; the summary is constant and reads well burned in. |
| Trip-summary fields shown | all except places | Multi-select. Place names are off by default in the export — see §6.6. |
| Live fields shown | battery, power | Multi-select. Two fields is enough to be useful without crowding the frame. |
| Panel position | top-right | Configurable: top-left / top-right / bottom-left / bottom-right. The export honours the same choice. The mini-map already occupies bottom-right in the single layout and top-right in the pip layout, so the panel position is offered as the remaining free corners and the exporter avoids the map's corner in the active layout. |
| Distance unit | km | km / mi. Independent of the existing `speedUnit` toggle, which the app already scopes to speed. |
| Temperature unit | °C | °C / °F. |
| Tire pressure unit | bar | bar / psi. |
| Range type | ideal | ideal / est / rated. |
| Decimal places | auto | Per-unit sensible defaults, overridable. |

### 6.4 What the user cannot configure (and why)

- **The SQL.** The user picks *metrics*, not queries. The app sends a fixed
  set of statements whose only interpolated values are validated integers
  (§5.1). Free-form SQL from the browser would turn a read-only analytics
  feature into an injection surface against the user's own database.
- **The transport.** Direct vs. same-origin is a deployment consequence, not a
  user preference — though it is detected automatically and overridable.
- **Whether credentials are stored.** The user chooses; the app never stores a
  token without consent.

### 6.5 Units

TeslaMate stores metric units. The app's existing `speedUnit` toggle
(`mph` / `kmh`) applies to **speed**, including the trip's average and maximum
speed, so a trip's "max speed" is consistent with the speed shown on the
hud.

Distance, range and odometer are governed by a separate **distance unit**
setting (km / mi) so that a user can have mph speed with miles for distance
without the two disagreeing.

Temperatures are °C / °F and tire pressures bar / psi, both independent
toggles.

### 6.6 Privacy

Trip start and end places are **geocoded street addresses** from TeslaMate's
`addresses` table ("Via Caniga, Predda Niedda, Sassari, Sardinia"). These are
off by default in the export — the summary is not burned into a shared video
unless the user explicitly enables the place fields. The live panel may show
them, since it is only visible on the user's own screen.

---

## 7. The same-origin proxy

> **Revised after rebasing onto `main`.** When this design was written the app
> was a static export served by nginx, so this section described an nginx
> `location` that `proxy_pass`ed to Grafana. `main` has since moved to a
> **standalone Next.js server** (`output: "standalone"`, `node startup.js`, port
> 3000) to support the library feature's API routes. nginx is no longer in the
> image, so the proxy is now a **route handler** instead. The behaviour and the
> guarantees are unchanged; only the mechanism moved. The nginx version was
> verified against `nginx:alpine` at the time and is recorded in the ledger.

The proxy is `src/app/api/grafana-proxy/[...path]/route.ts`, reached through a
rewrite so the client's configured base URL is identical in development and
production:

```ts
// next.config.ts
{ source: "/grafana-proxy/:path*", destination: "/api/grafana-proxy/:path*" }
```

The handler:

- reads `GRAFANA_UPSTREAM` **once at module load** and is disabled (`404`) when
  it is empty — the default, so the image behaves as it did before;
- forwards only `api/ds/query` and `api/datasources`, both read-only, and returns
  `404` for anything else under the prefix (including Grafana's admin surface);
- accepts only `GET` and `POST`;
- relays the caller's `Authorization` header verbatim and never logs it;
- passes Grafana's status through, and reports `502` when Grafana cannot be
  reached;
- takes the upstream from the environment, never from the request, so it is not
  an open relay.

**Verified end to end** against a built standalone server and the live Grafana:
`/grafana-proxy/api/datasources` and `/api/grafana-proxy/api/datasources` both
return the datasource list, and `/grafana-proxy/api/org` returns `404`.

**Security notes:**

- The upstream is not user-controllable at request time → no open relay.
- The `Authorization` header is relayed verbatim and never logged.
- Only two read-only endpoints are reachable, so the proxy does not widen the
  app's trust boundary to Grafana's whole API.
- A token still only ever travels to the Grafana the operator configured.

## 8. Failure modes and how the UI reports them

| Failure | Detection | User-facing message |
|---|---|---|
| Grafana unreachable | `fetch` rejects | "Could not reach Grafana at &lt;url&gt;." |
| **CORS misconfigured** | Fetch rejects on an absolute URL | "The browser blocked the request. Grafana sends no CORS headers — add them to your reverse proxy, or point ExportDash at `/grafana-proxy`." |
| Bad / expired token | HTTP 401/403 | "Grafana rejected the token. A service account with Viewer access is enough." |
| No TeslaMate datasource | `GET /api/datasources` returns no Postgres datasource | "No TeslaMate datasource found in Grafana." — distinct from a query failure. |
| Several Postgres datasources | More than one match | "Choose which datasource holds your TeslaMate data." |
| Wrong datasource | Query error | "Could not query the TeslaMate datasource. Check the datasource is a Postgres datasource with a TeslaMate schema." |
| No trip for a clip | Zero overlapping `drives` rows | "No TeslaMate trip covers this clip." — the clip still shows its SEI telemetry. |
| Trip still in progress | `end_date IS NULL` | The trip is marked provisional; distance, energy and elevation gain show "—". |
| Sparse metric never populated | No non-null sample in the window | That field shows "—" and is listed as unavailable, not shown as 0. |
| Column absent on an older TeslaMate | The schema probe does not list it | "This TeslaMate version doesn't record &lt;field&gt;." Detected per-field, so other fields still work. |
| Timezone mismatch | Clip matches no trip, but nearby trips exist | "Clips from a different timezone won't match. Set the offset in settings." — §8.1. |

### 8.1 Timezone handling

Clip filenames are local time (C5); TeslaMate is UTC. The app treats the
browser's timezone as the recording timezone, which is correct for the
overwhelming majority of users (they record and browse in the same zone) and is
consistent with how the app already renders clip timestamps.

For the minority who recorded abroad, the settings expose a **manual UTC
offset** applied to clip timestamps before matching. The offset is
discoverable without guessing: the app can query TeslaMate for the trip
positions nearest the clip's first SEI GPS coordinate and derive the offset
from the match. This is offered as an explicit "detect" action rather than an
automatic behavior, so a wrong guess never silently mislabels a clip.

---

## 9. Testing strategy

The repo currently has no test suite for this area; `vitest` is configured and
`src/lib/__tests__` and `src/hooks/__tests__` exist, so the pattern is
established.

**Unit (`src/lib/teslamate/__tests__/`)** — the pure modules:
- `queries.ts`: SQL text for known inputs; assert the `AT TIME ZONE 'UTC'`
  conversion is present and **parenthesised** (the unparenthesised `BETWEEN`
  form is a Postgres syntax error); assert every interpolated value is a safe
  integer.
- `schema.ts`: the `SELECT` list is built from the probed column set — a
  TeslaMate without `tpms_pressure_fl` yields a query without it.
- `match.ts`: clip→trip selection for the overlapping case, the
  straddling-two-trips case, the no-trip case, the boundary case, and the
  **open-drive** case (`end_date IS NULL` matches, and its aggregate fields
  are reported as unavailable).
- `series.ts`: interpolation of dense metrics; carry-forward of sparse
  metrics; `null` before the first sparse sample; binary search correctness
  at boundaries.
- The wall-clock derivation: a sequence with an internal gap must resolve a
  frame to `moment.timestamp + localTime`, not to `sequence.startTime +
  absoluteTime`. This is a regression test with a concrete failing example,
  because the two differ by the accumulated merge gaps.
- Energy computation matches TeslaMate's own formula for a known drive.

**Component** — the panel renders the configured fields and nothing else; a
field with no data renders as unavailable rather than zero.

**Integration against the live instance** — a script that runs the real
queries and asserts:
- the returned column names match the expected set,
- the row count for a known window is plausible (585 rows for the 1-hour
  window at 1 Hz — verified),
- the matched trip for a known clip is the expected `drives.id`,
- an open drive (`end_date IS NULL`) is returned by the trip query.

This is a verification script, not a CI test — it requires the user's Grafana
and must not run in CI.

**nginx** — the proxy block is verified against `nginx:alpine` in the
development loop: `nginx -t` passes, the request path is preserved
(`/grafana-proxy/api/ds/query` arrives upstream as `/api/ds/query`), the
`Authorization` header is relayed, both `GET` and `POST` are forwarded, and an
unset `GRAFANA_UPSTREAM` yields 404 rather than a broken config.

**Not tested in CI:** anything requiring network access to Grafana.

---

## 10. Deliverables

1. `src/lib/teslamate/` — client, queries, schema probe, match, series, types.
2. `src/hooks/useTeslaMate.ts` — connection state, per-sequence fetch, cache.
3. `src/components/TeslaMateSettings.tsx` — URL, token, datasource, car,
   offset, detect.
4. `src/components/TripMetricsPanel.tsx` — live playback view.
5. `src/components/TripMetricsConfig.tsx` — field picker and presentation
   settings.
6. `VideoPlayer` — panel placement, settings entry point.
7. `VideoExporter` — `drawTripMetrics()` and its wiring.
8. `nginx.conf` → `templates/default.conf.template`, `Dockerfile`
   (`ENV GRAFANA_UPSTREAM=""`), `docker-compose.yml` — the `/grafana-proxy/`
   block and its configuration.
9. `README.md` — a "TeslaMate integration" section: the two transports, the
   CORS snippet for direct access, the Docker env vars, and the service-account
   token setup.
10. Tests as described in §9.

### 10.1 Deployment coverage

The same-origin proxy exists **only in the Docker image**. The Cloudflare
Pages deployment (which serves exportdash.cam, via `functions/`) has no
reverse proxy of its own, and adding one would mean an open relay — so that
deployment supports the **direct transport only**. Users on that deployment
need CORS on their own Grafana proxy.

The Docker image covers both self-hosted and container deployments, and is
the path the reference Kubernetes deployment uses.

---

## 11. Open questions for the builder

These are recorded as decisions with rationale rather than blockers.

1. **Sampling grid for the export.** The burned-in live values step at 1 Hz
   because the source does. The default export set is therefore the trip
   summary. If a user enables live fields for the export, the stepping is
   visible. *Call:* keep it — it is honest about the data — and document it.
2. **Which range type is "the" range.** TeslaMate stores ideal, estimated and
   rated range. *Call:* configurable, defaulting to ideal.
3. **Whether the trip panel appears in the exported video as one block or two.**
   *Call:* two blocks (summary above, live below) so each can be toggled
   independently.
4. **Whether to support TeslaMate instances where the Grafana datasource is
   InfluxDB.** *Call:* no — Postgres-only, per the non-goals.
5. **Whether the app should ever persist the Grafana token by default.**
   *Call:* no — opt-in only, mirroring the existing decrypt-token prompt.
