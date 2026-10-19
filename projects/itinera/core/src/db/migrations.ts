/**
 * The SQLite schema, as ordered migrations tracked with PRAGMA user_version.
 * One schema serves every platform and is the contract for seed bundles, so
 * migrations are append-only: never edit a shipped entry, add a new one.
 *
 * Conventions: ULID text primary keys; booleans as 0/1; JSON in *_json text
 * columns; timestamps as ISO 8601 text.
 */
import type { SqlExecutor } from "./executor.js";

export const MIGRATIONS: readonly string[][] = [
  [
    `CREATE TABLE country (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      iso_code TEXT NOT NULL UNIQUE,
      currency TEXT
    )`,
    `CREATE TABLE city (
      id TEXT PRIMARY KEY,
      country_id TEXT NOT NULL REFERENCES country(id),
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      bbox_json TEXT NOT NULL,
      theme_tags_json TEXT NOT NULL DEFAULT '[]',
      osm_relation_id INTEGER,
      wikidata TEXT,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX city_osm ON city(osm_relation_id)`,
    `CREATE TABLE place (
      id TEXT PRIMARY KEY,
      city_id TEXT NOT NULL REFERENCES city(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      hours_raw TEXT,
      description TEXT,
      description_attribution_json TEXT,
      theme_tags_json TEXT NOT NULL DEFAULT '[]',
      photo_path TEXT,
      photo_attribution_json TEXT,
      sources_json TEXT NOT NULL DEFAULT '[]',
      osm_id TEXT NOT NULL UNIQUE,
      wikidata TEXT,
      rank REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )`,
    `CREATE INDEX place_city ON place(city_id, rank DESC)`,
    `CREATE TABLE climate_normal (
      city_id TEXT NOT NULL REFERENCES city(id),
      day_of_year INTEGER NOT NULL,
      tmin_p10 REAL NOT NULL, tmin_p50 REAL NOT NULL, tmin_p90 REAL NOT NULL,
      tmax_p10 REAL NOT NULL, tmax_p50 REAL NOT NULL, tmax_p90 REAL NOT NULL,
      rain_prob REAL NOT NULL,
      precip_mm REAL NOT NULL,
      PRIMARY KEY (city_id, day_of_year)
    )`,
    `CREATE TABLE route_edge (
      from_city_id TEXT NOT NULL,
      to_city_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      typical_minutes REAL NOT NULL,
      direct INTEGER NOT NULL,
      PRIMARY KEY (from_city_id, to_city_id, mode)
    )`,
    `CREATE TABLE price_observation (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      source TEXT NOT NULL,
      observed_at TEXT NOT NULL
    )`,
    `CREATE INDEX price_observation_key ON price_observation(kind, key)`,
    `CREATE TABLE price_band (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      month INTEGER NOT NULL,
      p10 REAL NOT NULL, p50 REAL NOT NULL, p90 REAL NOT NULL,
      n INTEGER NOT NULL,
      span_start TEXT NOT NULL,
      span_end TEXT NOT NULL,
      currency TEXT NOT NULL,
      PRIMARY KEY (kind, key, month)
    )`,
    `CREATE TABLE trip (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      origin_city_id TEXT,
      state TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE leg (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trip(id),
      city_id TEXT NOT NULL,
      ord INTEGER NOT NULL,
      nights INTEGER NOT NULL,
      is_stopover INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX leg_trip ON leg(trip_id)`,
    `CREATE TABLE transfer (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trip(id),
      from_leg_id TEXT NOT NULL,
      to_leg_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      est_minutes REAL NOT NULL,
      depart_day_id TEXT
    )`,
    `CREATE TABLE day (
      id TEXT PRIMARY KEY,
      leg_id TEXT NOT NULL REFERENCES leg(id),
      date TEXT NOT NULL,
      idx INTEGER NOT NULL
    )`,
    `CREATE INDEX day_leg ON day(leg_id)`,
    `CREATE TABLE slot (
      id TEXT PRIMARY KEY,
      day_id TEXT NOT NULL REFERENCES day(id),
      part TEXT NOT NULL,
      ord INTEGER NOT NULL
    )`,
    `CREATE INDEX slot_day ON slot(day_id)`,
    `CREATE TABLE item (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL REFERENCES slot(id),
      place_id TEXT,
      custom_name TEXT,
      ord INTEGER NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 1,
      duration_min INTEGER,
      est_cost REAL,
      notes TEXT
    )`,
    `CREATE INDEX item_slot ON item(slot_id)`,
    `CREATE TABLE wishlist_entry (
      id TEXT PRIMARY KEY,
      place_id TEXT NOT NULL UNIQUE,
      saved_at TEXT NOT NULL,
      note TEXT
    )`,
    `CREATE TABLE cache_entry (
      key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      ttl_days REAL,
      status TEXT NOT NULL
    )`,
    `CREATE TABLE setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE tile_pack (
      id TEXT PRIMARY KEY,
      region TEXT NOT NULL UNIQUE,
      bbox_json TEXT NOT NULL,
      path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      built_at TEXT NOT NULL
    )`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Applies pending migrations. Returns the version before and after. */
export async function migrate(db: SqlExecutor): Promise<{ from: number; to: number }> {
  const rows = await db.select<{ user_version: number }>("PRAGMA user_version");
  const from = Number(rows[0]?.user_version ?? 0);
  if (from > SCHEMA_VERSION) {
    throw new Error(`Database schema v${from} is newer than this app (v${SCHEMA_VERSION})`);
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v]!) await db.execute(sql);
    await db.execute(`PRAGMA user_version = ${v + 1}`);
  }
  return { from, to: SCHEMA_VERSION };
}
