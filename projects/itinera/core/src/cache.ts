/**
 * Cache/TTL policy per data category, and the plan for a background refresh.
 * Stale data stays usable and is labelled with its fetch date until refreshed.
 */
import type { CacheCategory, CacheEntry, CacheStatus } from "./schemas.js";

export interface CachePolicy {
  /** Days until stale; null = never expires (refreshed only on demand or on new data). */
  ttlDays: number | null;
  source: string;
}

/** Refresh intervals from the PRD's data-sources table (midpoints where a range is given). */
export const CACHE_POLICIES: Record<CacheCategory, CachePolicy> = {
  geocode: { ttlDays: null, source: "Nominatim" },
  places: { ttlDays: 42, source: "OSM / Overpass" },
  hours: { ttlDays: 10, source: "OSM / Overpass" },
  descriptions: { ttlDays: 42, source: "Wikidata, Wikivoyage" },
  photos: { ttlDays: 42, source: "Wikimedia Commons" },
  climate: { ttlDays: 365, source: "Open-Meteo archive" },
  travel_times: { ttlDays: null, source: "Estimate / OSRM" },
  routes: { ttlDays: 365, source: "Open routes dataset" },
  stay_prices: { ttlDays: null, source: "Inside Airbnb + logged" },
  flight_prices: { ttlDays: null, source: "Fare model + logged" },
  tiles: { ttlDays: null, source: "Protomaps" },
};

export const cacheKey = (category: CacheCategory, scope: string) => `${category}:${scope}`;

export function newCacheEntry(
  category: CacheCategory,
  scope: string,
  now: Date,
  status: CacheStatus = "ok",
): CacheEntry {
  return {
    key: cacheKey(category, scope),
    category,
    fetchedAt: now.toISOString(),
    ttlDays: CACHE_POLICIES[category].ttlDays,
    status,
  };
}

export interface Freshness {
  stale: boolean;
  ageDays: number;
  /** Days past the TTL (negative while fresh); null if it never expires. */
  overdueDays: number | null;
}

export function freshness(entry: CacheEntry, now: Date): Freshness {
  const ageDays = (now.getTime() - Date.parse(entry.fetchedAt)) / 86_400_000;
  if (entry.ttlDays === null) return { stale: entry.status === "error", ageDays, overdueDays: null };
  const overdueDays = ageDays - entry.ttlDays;
  return { stale: overdueDays >= 0 || entry.status === "error", ageDays, overdueDays };
}

export interface RefreshPlanOptions {
  /** Most entries to refresh in one pass. */
  limit?: number;
  /** Skip entries that errored within this many minutes (back off). */
  errorBackoffMinutes?: number;
}

/**
 * Stale entries in the order to refresh them: errors and the most overdue
 * first. The refresher then runs them sequentially through the polite fetcher,
 * which enforces each source's rate limit.
 */
export function planRefresh(entries: readonly CacheEntry[], now: Date, options: RefreshPlanOptions = {}): CacheEntry[] {
  const limit = options.limit ?? 10;
  const backoffMs = (options.errorBackoffMinutes ?? 60) * 60_000;
  return entries
    .filter((e) => e.status !== "refreshing")
    .filter((e) => !(e.status === "error" && now.getTime() - Date.parse(e.fetchedAt) < backoffMs))
    .map((e) => ({ e, f: freshness(e, now) }))
    .filter(({ f }) => f.stale)
    .sort((a, b) => (b.f.overdueDays ?? Infinity) - (a.f.overdueDays ?? Infinity))
    .slice(0, limit)
    .map(({ e }) => e);
}

/** "Fetched 3 Oct 2026" plus " · stale" when past its TTL. */
export function fetchedLabel(entry: CacheEntry, now: Date): string {
  const d = new Date(entry.fetchedAt);
  const label = `Fetched ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
  return freshness(entry, now).stale ? `${label} · stale` : label;
}
