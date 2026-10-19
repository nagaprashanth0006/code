/**
 * Repository: typed reads and writes over the schema in migrations.ts. Rows
 * read back are validated with the domain schemas, so a corrupt row or a bad
 * seed bundle fails loudly at the boundary instead of deep in the UI.
 */
import type { TripTree } from "../itinerary.js";
import {
  CacheEntrySchema,
  CitySchema,
  ClimateNormalSchema,
  CountrySchema,
  DaySchema,
  ItemSchema,
  LegSchema,
  PlaceSchema,
  SlotSchema,
  TilePackSchema,
  TransferSchema,
  TripSchema,
  WishlistEntrySchema,
  type CacheEntry,
  type City,
  type ClimateNormal,
  type Country,
  type Item,
  type Place,
  type TilePack,
  type Trip,
  type WishlistEntry,
} from "../schemas.js";
import { insertRows, type SqlExecutor, type SqlValue } from "./executor.js";

type Row = Record<string, unknown>;

const json = (v: unknown): string => JSON.stringify(v);
const parseJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : null);
const bool = (v: boolean): number => (v ? 1 : 0);
const num = (v: unknown): number => Number(v);
const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const optStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------- mappers

const toCountry = (r: Row): Country =>
  CountrySchema.parse({ id: r.id, name: r.name, isoCode: r.iso_code, currency: optStr(r.currency) });

const toCity = (r: Row): City =>
  CitySchema.parse({
    id: r.id,
    countryId: r.country_id,
    name: r.name,
    lat: num(r.lat),
    lon: num(r.lon),
    bbox: parseJson(r.bbox_json),
    themeTags: parseJson(r.theme_tags_json),
    osmRelationId: optNum(r.osm_relation_id),
    wikidata: optStr(r.wikidata),
    source: r.source,
    fetchedAt: r.fetched_at,
  });

const toPlace = (r: Row): Place =>
  PlaceSchema.parse({
    id: r.id,
    cityId: r.city_id,
    name: r.name,
    category: r.category,
    lat: num(r.lat),
    lon: num(r.lon),
    hoursRaw: optStr(r.hours_raw),
    description: optStr(r.description),
    descriptionAttribution: parseJson(r.description_attribution_json),
    themeTags: parseJson(r.theme_tags_json),
    photoPath: optStr(r.photo_path),
    photoAttribution: parseJson(r.photo_attribution_json),
    sources: parseJson(r.sources_json),
    osmId: r.osm_id,
    wikidata: optStr(r.wikidata),
    rank: num(r.rank),
    source: r.source,
    fetchedAt: r.fetched_at,
  });

const placeRow = (p: Place): SqlValue[] => [
  p.id,
  p.cityId,
  p.name,
  p.category,
  p.lat,
  p.lon,
  p.hoursRaw,
  p.description,
  p.descriptionAttribution ? json(p.descriptionAttribution) : null,
  json(p.themeTags),
  p.photoPath,
  p.photoAttribution ? json(p.photoAttribution) : null,
  json(p.sources),
  p.osmId,
  p.wikidata,
  p.rank,
  p.source,
  p.fetchedAt,
];

const PLACE_COLUMNS = `id, city_id, name, category, lat, lon, hours_raw, description, description_attribution_json,
  theme_tags_json, photo_path, photo_attribution_json, sources_json, osm_id, wikidata, rank, source, fetched_at`;

const itemRow = (i: Item): SqlValue[] => [
  i.id,
  i.slotId,
  i.placeId,
  i.customName,
  i.order,
  bool(i.isPrimary),
  i.durationMin,
  i.estCost,
  i.notes,
];

const toItem = (r: Row): Item =>
  ItemSchema.parse({
    id: r.id,
    slotId: r.slot_id,
    placeId: optStr(r.place_id),
    customName: optStr(r.custom_name),
    order: num(r.ord),
    isPrimary: Boolean(num(r.is_primary)),
    durationMin: optNum(r.duration_min),
    estCost: optNum(r.est_cost),
    notes: optStr(r.notes),
  });

const toTrip = (r: Row): Trip =>
  TripSchema.parse({
    id: r.id,
    name: r.name,
    originCityId: optStr(r.origin_city_id),
    state: r.state,
    startDate: optStr(r.start_date),
    endDate: optStr(r.end_date),
    createdAt: r.created_at,
  });

// ----------------------------------------------------------------- catalog

export class Repo {
  constructor(readonly db: SqlExecutor) {}

  async upsertCountry(c: Country): Promise<void> {
    await this.db.execute(
      `INSERT INTO country (id, name, iso_code, currency) VALUES (?,?,?,?)
       ON CONFLICT(iso_code) DO UPDATE SET name = excluded.name, currency = COALESCE(excluded.currency, country.currency)`,
      [c.id, c.name, c.isoCode, c.currency],
    );
  }

  async countryByIso(isoCode: string): Promise<Country | null> {
    const rows = await this.db.select<Row>("SELECT * FROM country WHERE iso_code = ?", [isoCode]);
    return rows[0] ? toCountry(rows[0]) : null;
  }

  async listCountries(): Promise<Country[]> {
    return (await this.db.select<Row>("SELECT * FROM country ORDER BY name")).map(toCountry);
  }

  async upsertCity(c: City): Promise<void> {
    await this.db.execute(
      `INSERT INTO city (id, country_id, name, lat, lon, bbox_json, theme_tags_json, osm_relation_id, wikidata, source, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET country_id = excluded.country_id, name = excluded.name, lat = excluded.lat,
         lon = excluded.lon, bbox_json = excluded.bbox_json, theme_tags_json = excluded.theme_tags_json,
         osm_relation_id = excluded.osm_relation_id, wikidata = excluded.wikidata, source = excluded.source,
         fetched_at = excluded.fetched_at`,
      [
        c.id,
        c.countryId,
        c.name,
        c.lat,
        c.lon,
        json(c.bbox),
        json(c.themeTags),
        c.osmRelationId,
        c.wikidata,
        c.source,
        c.fetchedAt,
      ],
    );
  }

  async listCities(): Promise<City[]> {
    return (await this.db.select<Row>("SELECT * FROM city ORDER BY name")).map(toCity);
  }

  async cityByOsmRelation(relationId: number): Promise<City | null> {
    const rows = await this.db.select<Row>("SELECT * FROM city WHERE osm_relation_id = ?", [relationId]);
    return rows[0] ? toCity(rows[0]) : null;
  }

  async getCity(id: string): Promise<City | null> {
    const rows = await this.db.select<Row>("SELECT * FROM city WHERE id = ?", [id]);
    return rows[0] ? toCity(rows[0]) : null;
  }

  /** Inserts or refreshes places, keyed by OSM id so a re-fetch keeps place ids stable. */
  async upsertPlaces(places: readonly Place[]): Promise<void> {
    await insertRows(
      this.db,
      `INSERT INTO place (${PLACE_COLUMNS})`,
      18,
      places.map(placeRow),
      `ON CONFLICT(osm_id) DO UPDATE SET name = excluded.name, category = excluded.category, lat = excluded.lat,
        lon = excluded.lon, hours_raw = excluded.hours_raw, description = excluded.description,
        description_attribution_json = excluded.description_attribution_json, theme_tags_json = excluded.theme_tags_json,
        photo_path = COALESCE(excluded.photo_path, place.photo_path),
        photo_attribution_json = COALESCE(excluded.photo_attribution_json, place.photo_attribution_json),
        sources_json = excluded.sources_json, wikidata = excluded.wikidata, rank = excluded.rank,
        source = excluded.source, fetched_at = excluded.fetched_at`,
    );
  }

  async placesByCity(cityId: string): Promise<Place[]> {
    return (await this.db.select<Row>("SELECT * FROM place WHERE city_id = ? ORDER BY rank DESC", [cityId])).map(
      toPlace,
    );
  }

  async placeIdsByOsmId(osmIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < osmIds.length; i += 500) {
      const chunk = osmIds.slice(i, i + 500);
      const rows = await this.db.select<{ id: string; osm_id: string }>(
        `SELECT id, osm_id FROM place WHERE osm_id IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      );
      for (const r of rows) out.set(r.osm_id, r.id);
    }
    return out;
  }

  async countPlaces(cityId: string): Promise<number> {
    const rows = await this.db.select<{ n: number }>("SELECT COUNT(*) AS n FROM place WHERE city_id = ?", [cityId]);
    return num(rows[0]?.n ?? 0);
  }

  async replaceClimateNormals(cityId: string, normals: readonly ClimateNormal[]): Promise<void> {
    await this.db.execute("DELETE FROM climate_normal WHERE city_id = ?", [cityId]);
    await insertRows(
      this.db,
      `INSERT INTO climate_normal (city_id, day_of_year, tmin_p10, tmin_p50, tmin_p90, tmax_p10, tmax_p50, tmax_p90, rain_prob, precip_mm)`,
      10,
      normals.map((n) => [
        n.cityId,
        n.dayOfYear,
        n.tminP10,
        n.tminP50,
        n.tminP90,
        n.tmaxP10,
        n.tmaxP50,
        n.tmaxP90,
        n.rainProb,
        n.precipMm,
      ]),
    );
  }

  async climateNormals(cityId: string): Promise<ClimateNormal[]> {
    const rows = await this.db.select<Row>("SELECT * FROM climate_normal WHERE city_id = ? ORDER BY day_of_year", [
      cityId,
    ]);
    return rows.map((r) =>
      ClimateNormalSchema.parse({
        cityId: r.city_id,
        dayOfYear: num(r.day_of_year),
        tminP10: num(r.tmin_p10),
        tminP50: num(r.tmin_p50),
        tminP90: num(r.tmin_p90),
        tmaxP10: num(r.tmax_p10),
        tmaxP50: num(r.tmax_p50),
        tmaxP90: num(r.tmax_p90),
        rainProb: num(r.rain_prob),
        precipMm: num(r.precip_mm),
      }),
    );
  }

  // --------------------------------------------------------------- trips

  async listTrips(): Promise<Trip[]> {
    return (await this.db.select<Row>("SELECT * FROM trip ORDER BY created_at DESC")).map(toTrip);
  }

  async saveTrip(trip: Trip): Promise<void> {
    await this.db.execute(
      `INSERT INTO trip (id, name, origin_city_id, state, start_date, end_date, created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, origin_city_id = excluded.origin_city_id,
         state = excluded.state, start_date = excluded.start_date, end_date = excluded.end_date`,
      [trip.id, trip.name, trip.originCityId, trip.state, trip.startDate, trip.endDate, trip.createdAt],
    );
  }

  /** Writes a whole trip tree (used on create and on import). */
  async saveTripTree(tree: TripTree): Promise<void> {
    await this.saveTrip(tree.trip);
    const legs = tree.legs.map((l) => l.leg);
    const days = tree.legs.flatMap((l) => l.days.map((d) => d.day));
    const slots = tree.legs.flatMap((l) => l.days.flatMap((d) => d.slots.map((s) => s.slot)));
    const items = tree.legs.flatMap((l) => l.days.flatMap((d) => d.slots.flatMap((s) => s.items)));
    await insertRows(
      this.db,
      "INSERT OR REPLACE INTO leg (id, trip_id, city_id, ord, nights, is_stopover)",
      6,
      legs.map((l) => [l.id, l.tripId, l.cityId, l.order, l.nights, bool(l.isStopover)]),
    );
    await insertRows(
      this.db,
      "INSERT OR REPLACE INTO day (id, leg_id, date, idx)",
      4,
      days.map((d) => [d.id, d.legId, d.date, d.index]),
    );
    await insertRows(
      this.db,
      "INSERT OR REPLACE INTO slot (id, day_id, part, ord)",
      4,
      slots.map((s) => [s.id, s.dayId, s.part, s.order]),
    );
    await this.upsertItems(items);
    await insertRows(
      this.db,
      "INSERT OR REPLACE INTO transfer (id, trip_id, from_leg_id, to_leg_id, mode, est_minutes, depart_day_id)",
      7,
      tree.transfers.map((t) => [t.id, t.tripId, t.fromLegId, t.toLegId, t.mode, t.estMinutes, t.departDayId]),
    );
  }

  async loadTripTree(tripId: string): Promise<TripTree | null> {
    const tripRows = await this.db.select<Row>("SELECT * FROM trip WHERE id = ?", [tripId]);
    if (!tripRows[0]) return null;
    const trip = toTrip(tripRows[0]);
    const legs = (await this.db.select<Row>("SELECT * FROM leg WHERE trip_id = ? ORDER BY ord", [tripId])).map((r) =>
      LegSchema.parse({
        id: r.id,
        tripId: r.trip_id,
        cityId: r.city_id,
        order: num(r.ord),
        nights: num(r.nights),
        isStopover: Boolean(num(r.is_stopover)),
      }),
    );
    const days = (
      await this.db.select<Row>(
        "SELECT day.* FROM day JOIN leg ON leg.id = day.leg_id WHERE leg.trip_id = ? ORDER BY day.idx",
        [tripId],
      )
    ).map((r) => DaySchema.parse({ id: r.id, legId: r.leg_id, date: r.date, index: num(r.idx) }));
    const slots = (
      await this.db.select<Row>(
        `SELECT slot.* FROM slot JOIN day ON day.id = slot.day_id JOIN leg ON leg.id = day.leg_id
         WHERE leg.trip_id = ? ORDER BY slot.ord`,
        [tripId],
      )
    ).map((r) => SlotSchema.parse({ id: r.id, dayId: r.day_id, part: r.part, order: num(r.ord) }));
    const items = (
      await this.db.select<Row>(
        `SELECT item.* FROM item JOIN slot ON slot.id = item.slot_id JOIN day ON day.id = slot.day_id
         JOIN leg ON leg.id = day.leg_id WHERE leg.trip_id = ? ORDER BY item.ord`,
        [tripId],
      )
    ).map(toItem);
    const transfers = (await this.db.select<Row>("SELECT * FROM transfer WHERE trip_id = ?", [tripId])).map((r) =>
      TransferSchema.parse({
        id: r.id,
        tripId: r.trip_id,
        fromLegId: r.from_leg_id,
        toLegId: r.to_leg_id,
        mode: r.mode,
        estMinutes: num(r.est_minutes),
        departDayId: optStr(r.depart_day_id),
      }),
    );
    return {
      trip,
      transfers,
      legs: legs.map((leg) => ({
        leg,
        days: days
          .filter((d) => d.legId === leg.id)
          .map((day) => ({
            day,
            slots: slots
              .filter((s) => s.dayId === day.id)
              .map((slot) => ({ slot, items: items.filter((i) => i.slotId === slot.id) })),
          })),
      })),
    };
  }

  async upsertItems(items: readonly Item[]): Promise<void> {
    await insertRows(
      this.db,
      "INSERT OR REPLACE INTO item (id, slot_id, place_id, custom_name, ord, is_primary, duration_min, est_cost, notes)",
      9,
      items.map(itemRow),
    );
  }

  async deleteItems(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(`DELETE FROM item WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  }

  async deleteTrip(tripId: string): Promise<void> {
    const legScope = "SELECT id FROM leg WHERE trip_id = ?";
    const dayScope = `SELECT id FROM day WHERE leg_id IN (${legScope})`;
    const slotScope = `SELECT id FROM slot WHERE day_id IN (${dayScope})`;
    await this.db.execute(`DELETE FROM item WHERE slot_id IN (${slotScope})`, [tripId]);
    await this.db.execute(`DELETE FROM slot WHERE day_id IN (${dayScope})`, [tripId]);
    await this.db.execute(`DELETE FROM day WHERE leg_id IN (${legScope})`, [tripId]);
    await this.db.execute("DELETE FROM transfer WHERE trip_id = ?", [tripId]);
    await this.db.execute("DELETE FROM leg WHERE trip_id = ?", [tripId]);
    await this.db.execute("DELETE FROM trip WHERE id = ?", [tripId]);
  }

  // ------------------------------------------------------------ wishlist

  async listWishlist(): Promise<WishlistEntry[]> {
    return (await this.db.select<Row>("SELECT * FROM wishlist_entry ORDER BY saved_at DESC")).map((r) =>
      WishlistEntrySchema.parse({ id: r.id, placeId: r.place_id, savedAt: r.saved_at, note: optStr(r.note) }),
    );
  }

  async addToWishlist(entry: WishlistEntry): Promise<void> {
    await this.db.execute(
      "INSERT INTO wishlist_entry (id, place_id, saved_at, note) VALUES (?,?,?,?) ON CONFLICT(place_id) DO NOTHING",
      [entry.id, entry.placeId, entry.savedAt, entry.note],
    );
  }

  async removeFromWishlist(placeId: string): Promise<void> {
    await this.db.execute("DELETE FROM wishlist_entry WHERE place_id = ?", [placeId]);
  }

  // -------------------------------------------------------------- system

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.db.select<{ value: string }>("SELECT value FROM setting WHERE key = ?", [key]);
    return rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.execute(
      "INSERT INTO setting (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  async upsertCacheEntry(e: CacheEntry): Promise<void> {
    await this.db.execute(
      `INSERT INTO cache_entry (key, category, fetched_at, ttl_days, status) VALUES (?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET category = excluded.category, fetched_at = excluded.fetched_at,
         ttl_days = excluded.ttl_days, status = excluded.status`,
      [e.key, e.category, e.fetchedAt, e.ttlDays, e.status],
    );
  }

  async listCacheEntries(): Promise<CacheEntry[]> {
    return (await this.db.select<Row>("SELECT * FROM cache_entry ORDER BY key")).map((r) =>
      CacheEntrySchema.parse({
        key: r.key,
        category: r.category,
        fetchedAt: r.fetched_at,
        ttlDays: optNum(r.ttl_days),
        status: r.status,
      }),
    );
  }

  async upsertTilePack(t: TilePack): Promise<void> {
    await this.db.execute(
      `INSERT INTO tile_pack (id, region, bbox_json, path, size_bytes, built_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(region) DO UPDATE SET bbox_json = excluded.bbox_json, path = excluded.path,
         size_bytes = excluded.size_bytes, built_at = excluded.built_at`,
      [t.id, t.region, json(t.bbox), t.path, t.sizeBytes, t.builtAt],
    );
  }

  async listTilePacks(): Promise<TilePack[]> {
    return (await this.db.select<Row>("SELECT * FROM tile_pack ORDER BY region")).map((r) =>
      TilePackSchema.parse({
        id: r.id,
        region: r.region,
        bbox: parseJson(r.bbox_json),
        path: r.path,
        sizeBytes: num(r.size_bytes),
        builtAt: r.built_at,
      }),
    );
  }
}
