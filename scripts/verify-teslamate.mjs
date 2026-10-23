#!/usr/bin/env node
/**
 * Verifies the TeslaMate integration against a live Grafana instance.
 *
 * Usage:
 *   GRAFANA_URL=https://grafana.example.com \
 *   GRAFANA_TOKEN=glsa_... \
 *   node scripts/verify-teslamate.mjs
 *
 * Exit code 0 on success, non-zero on mismatch. Not wired into CI — needs a
 * live Grafana.
 */

async function request(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function queryFrames(conn, queries) {
  const url = buildUrl(conn.baseUrl, "/api/ds/query");
  const response = await request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(conn.token ? { Authorization: `Bearer ${conn.token}` } : {}),
    },
    body: JSON.stringify({
      queries: queries.map((q) => ({ ...q, datasource: conn.datasource, rawQuery: true, format: "table", intervalMs: 1000, maxDataPoints: 50000 })),
      from: "now-24h",
      to: "now",
    }),
  });

  const results = response.results ?? {};
  for (const result of Object.values(results)) {
    if (result?.error) throw new Error(result.error);
  }

  const frames = {};
  for (const [refId, result] of Object.entries(results)) {
    frames[refId] = parseFrame((result.frames ?? [])[0]);
  }
  return frames;
}

async function listDatasources(conn) {
  const url = buildUrl(conn.baseUrl, "/api/datasources");
  const response = await request(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(conn.token ? { Authorization: `Bearer ${conn.token}` } : {}),
    },
  });
  if (!Array.isArray(response)) return [];
  return response.map((raw) => ({
    uid: String(raw.uid ?? ""),
    name: String(raw.name ?? ""),
    type: String(raw.type ?? ""),
  }));
}

function buildUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function numberAt(frame, name, index) {
  const column = frame && frame.columns && frame.columns[name];
  if (!column) return null;
  const value = column[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringAt(frame, name, index) {
  const column = frame && frame.columns && frame.columns[name];
  if (!column) return null;
  const value = column[index];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseFrame(raw) {
  const frame = raw ?? {};
  const fields = ((frame.schema && frame.schema.fields) || []).map((f) => String(f && f.name || ""));
  const values = Array.isArray(frame.data && frame.data.values) ? frame.data.values : [];
  const columns = {};
  fields.forEach((name, i) => {
    columns[name] = Array.isArray(values[i]) ? values[i] : [];
  });
  const first = values[0];
  const rowCount = Array.isArray(first) ? first.length : 0;
  return { fields, columns, rowCount };
}

function parseCars(frame) {
  const cars = [];
  for (let i = 0; i < (frame && frame.rowCount || 0); i++) {
    cars.push({
      id: numberAt(frame, "id", i) || 0,
      name: stringAt(frame, "name", i) || `Car ${i + 1}`,
      model: stringAt(frame, "model", i),
    });
  }
  return cars;
}

function parseTrips(frame) {
  const trips = [];
  for (let i = 0; i < (frame && frame.rowCount || 0); i++) {
    trips.push({
      id: numberAt(frame, "id", i) || 0,
      startMs: numberAt(frame, "start_date", i) || 0,
      endMs: numberAt(frame, "end_date", i),
      distanceKm: numberAt(frame, "distance", i),
      durationMin: numberAt(frame, "duration_min", i),
      speedMaxKmh: numberAt(frame, "speed_max", i),
      powerMaxKw: numberAt(frame, "power_max", i),
      powerMinKw: numberAt(frame, "power_min", i),
      ascentM: numberAt(frame, "ascent", i),
      descentM: numberAt(frame, "descent", i),
      outsideTempAvgC: numberAt(frame, "outside_temp_avg", i),
      insideTempAvgC: numberAt(frame, "inside_temp_avg", i),
      startIdealRangeKm: numberAt(frame, "start_ideal_range_km", i),
      endIdealRangeKm: numberAt(frame, "end_ideal_range_km", i),
      startKm: numberAt(frame, "start_km", i),
      endKm: numberAt(frame, "end_km", i),
      efficiencyKwhPerKm: numberAt(frame, "efficiency", i),
      startBatteryPct: numberAt(frame, "start_battery_level", i),
      endBatteryPct: numberAt(frame, "end_battery_level", i),
      startPlace: stringAt(frame, "start_place", i),
      endPlace: stringAt(frame, "end_place", i),
    });
  }
  return trips;
}

const POSITION_FIELDS = [
  ["speed_kmh", "speedKmh"],
  ["power_kw", "powerKw"],
  ["battery_pct", "batteryPct"],
  ["usable_battery_pct", "usableBatteryPct"],
  ["odometer_km", "odometerKm"],
  ["elevation_m", "elevationM"],
  ["ideal_range_km", "idealRangeKm"],
  ["est_range_km", "estRangeKm"],
  ["rated_range_km", "ratedRangeKm"],
  ["tpms_fl", "tpmsFl"],
  ["tpms_fr", "tpmsFr"],
  ["tpms_rl", "tpmsRl"],
  ["tpms_rr", "tpmsRr"],
  ["outside_temp_c", "outsideTempC"],
  ["inside_temp_c", "insideTempC"],
  ["latitude", "latitude"],
  ["longitude", "longitude"],
];

function parseSamples(frame) {
  const samples = [];
  for (let i = 0; i < (frame && frame.rowCount || 0); i++) {
    const sample = { tMs: numberAt(frame, "t_ms", i) || 0 };
    for (const [column, field] of POSITION_FIELDS) {
      sample[field] = numberAt(frame, column, i);
    }
    samples.push(sample);
  }
  return samples;
}

async function main() {
  const GRAFANA_URL = process.env.GRAFANA_URL;
  const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN;

  if (!GRAFANA_URL) {
    console.error("GRAFANA_URL is required");
    process.exit(1);
  }
  if (!GRAFANA_TOKEN) {
    console.error("GRAFANA_TOKEN is required");
    process.exit(1);
  }

  console.log(`Connecting to ${GRAFANA_URL}...`);

  const datasources = await listDatasources({ baseUrl: GRAFANA_URL, token: GRAFANA_TOKEN, datasource: null });
  const postgres = datasources.filter((d) => d.type === "grafana-postgresql-datasource");
  if (postgres.length === 0) {
    console.error("No TeslaMate datasource (grafana-postgresql-datasource) found.");
    process.exit(1);
  }
  const chosen = postgres[0];
  console.log(`Found TeslaMate datasource: ${chosen.name} (${chosen.uid})`);

  const conn = {
    baseUrl: GRAFANA_URL,
    token: GRAFANA_TOKEN,
    datasource: { uid: postgres[0].uid, type: postgres[0].type },
  };

  const schema = await queryFrames(conn, [
    { refId: "schema", rawSql: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('positions','drives','cars','addresses')` },
  ]);
  console.log(`Schema probe: ${schema.schema.rowCount} columns found`);

  const cars = await queryFrames(conn, [{ refId: "cars", rawSql: "SELECT id, name, model FROM cars ORDER BY id" }]);
  const carList = parseCars(cars.cars);
  console.log(`Cars: ${carList.length} found`);
  for (const c of carList) {
    console.log(`  - id=${c.id} name="${c.name}" model="${c.model}"`);
  }

  const carId = carList[0] ? carList[0].id : 1;

  // Derive a window from the most recent finished drive, so this works on any
  // instance rather than pinning a timestamp from one particular database.
  const latest = await queryFrames(conn, [{
    refId: "latest",
    rawSql: `SELECT id, start_date, end_date FROM drives WHERE car_id = ${carId} AND end_date IS NOT NULL ORDER BY start_date DESC LIMIT 1`,
  }]);
  const latestFrame = latest.latest;
  if (!latestFrame || latestFrame.rowCount === 0) {
    console.error(`No finished drive found for car ${carId}.`);
    process.exit(1);
  }
  const startMs = numberAt(latestFrame, "start_date", 0);
  const endMs = numberAt(latestFrame, "end_date", 0);
  const expectedTripId = numberAt(latestFrame, "id", 0);
  if (startMs === null || endMs === null) {
    console.error("The most recent finished drive has no start or end date.");
    process.exit(1);
  }
  console.log(`Using window from drive ${expectedTripId}: ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);

  const trip = await queryFrames(conn, [{
    refId: "trip",
    rawSql: `SELECT d.id, d.start_date, d.end_date, d.distance, d.duration_min, d.speed_max, d.power_max, d.power_min, d.ascent, d.descent, d.outside_temp_avg, d.inside_temp_avg, d.start_ideal_range_km, d.end_ideal_range_km, d.start_km, d.end_km, c.efficiency, sp.battery_level AS start_battery_level, ep.battery_level AS end_battery_level, sa.display_name AS start_place, ea.display_name AS end_place FROM drives d JOIN cars c ON c.id = d.car_id LEFT JOIN positions sp ON sp.id = d.start_position_id LEFT JOIN positions ep ON ep.id = d.end_position_id LEFT JOIN addresses sa ON sa.id = d.start_address_id LEFT JOIN addresses ea ON ea.id = d.end_address_id WHERE d.car_id = ${carId} AND d.start_date <= (to_timestamp(${endMs}/1000.0) AT TIME ZONE 'UTC') AND (d.end_date IS NULL OR d.end_date >= (to_timestamp(${startMs}/1000.0) AT TIME ZONE 'UTC')) ORDER BY d.start_date`,
  }]);
  const trips = parseTrips(trip.trip);
  console.log(`Trip query returned ${trips.length} rows`);
  for (const t of trips) {
    console.log(`  Trip ${t.id}: distance=${t.distanceKm}km dur=${t.durationMin}min speed_max=${t.speedMaxKmh}km/h power_max=${t.powerMaxKw}kW ascent=${t.ascentM}m descent=${t.descentM}m batt_start=${t.startBatteryPct}% batt_end=${t.endBatteryPct}% eff=${t.efficiencyKwhPerKm} start="${t.startPlace}" end="${t.endPlace}"`);
  }
  const closed = trips.filter((t) => t.endMs !== null);
  console.log(`  Of those, ${closed.length} are finished trips and ${trips.length - closed.length} are in progress.`);
  if (closed.length === 0) {
    console.error("Expected at least one finished trip in the sample window.");
    process.exit(1);
  }
  const finished = closed[0];
  if (finished.distanceKm === null || finished.durationMin === null) {
    console.error(`Trip ${finished.id} is finished but has no distance or duration.`);
    process.exit(1);
  }
  if (!trips.some((t) => t.id === expectedTripId)) {
    console.error(`The window's own drive ${expectedTripId} was not returned by the trip query.`);
    process.exit(1);
  }

  const positions = await queryFrames(conn, [{
    refId: "positions",
    rawSql: `SELECT date_trunc('second', date) AS t_ms, avg(speed) AS speed_kmh, avg(power) AS power_kw, max(battery_level) AS battery_pct, max(usable_battery_level) AS usable_battery_pct, max(odometer) AS odometer_km, max(elevation) AS elevation_m, max(ideal_battery_range_km) AS ideal_range_km, max(est_battery_range_km) AS est_range_km, max(rated_battery_range_km) AS rated_range_km, max(tpms_pressure_fl) AS tpms_fl, max(tpms_pressure_fr) AS tpms_fr, max(tpms_pressure_rl) AS tpms_rl, max(tpms_pressure_rr) AS tpms_rr, max(outside_temp) AS outside_temp_c, max(inside_temp) AS inside_temp_c, max(latitude) AS latitude, max(longitude) AS longitude FROM positions WHERE car_id = ${carId} AND date >= (to_timestamp(${startMs}/1000.0) AT TIME ZONE 'UTC') AND date < (to_timestamp(${endMs}/1000.0) AT TIME ZONE 'UTC') GROUP BY 1 ORDER BY 1`,
  }]);
  const samples = parseSamples(positions.positions);
  console.log(`Positions query returned ${samples.length} rows at 1 Hz`);
  if (samples.length === 0) {
    console.error("Expected at least one position row in the sample window.");
    process.exit(1);
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  console.log(`  First: t=${first.tMs} speed=${first.speedKmh} power=${first.powerKw} battery=${first.batteryPct} tpms_fl=${first.tpmsFl}`);
  console.log(`  Last:  t=${last.tMs} speed=${last.speedKmh} power=${last.powerKw} battery=${last.batteryPct} tpms_fl=${last.tpmsFl}`);
  console.log(`  Sparse fields present: ${samples.filter((s) => s.tpmsFl !== null).length}/${samples.length} rows carry a tire pressure.`);

  console.log("Verification passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("Verification failed:", e);
  process.exit(1);
});
