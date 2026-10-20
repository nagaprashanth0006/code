/**
 * Choosing a destination's "great places" from what the sources return.
 *
 * Where to look: a large city's own boundary; for towns and small cities, a
 * radius around them sized by how far the travel guide's own listings reach
 * (Munnar's sights are 10–35 km out in the hills, Coorg's up to 45 km).
 *
 * What counts: a Wikivoyage listing (travellers recommend it) is the
 * strongest signal, then Wikipedia coverage (Wikidata sitelinks), then the
 * kind of feature. Wikidata links are dense in European OSM data and sparse
 * elsewhere, so a fixed notability floor kept 150 places in Lisbon and one in
 * Coorg; selection now keeps every notable place and tops up with the best of
 * the rest until a destination has a usable minimum.
 */
import { haversineKm, type LatLon } from "../geo.js";
import type { PlaceCategory } from "../schemas.js";
import { isGenericName } from "./matching.js";
import type { PlacesScope } from "./overpass.js";
import type { Listing } from "./wikivoyage.js";

/** A boundary this large (half-diagonal, km) is a city to search within; smaller ones get a region. */
export const CITY_HALF_DIAGONAL_KM = 6;
export const MIN_REGION_KM = 25;
export const MAX_REGION_KM = 60;

export interface SearchRegion {
  scope: PlacesScope;
  center: LatLon;
  /** Listings farther than this from the centre are left out. */
  radiusKm: number;
  mode: "city" | "region";
}

export function searchRegion(
  geo: LatLon & { bbox: [number, number, number, number]; osmRelationId: number | null },
  listings: readonly Listing[],
): SearchRegion {
  const [w, s, e, n] = geo.bbox;
  const halfDiagonal = haversineKm({ lat: s, lon: w }, { lat: n, lon: e }) / 2;
  const center = { lat: geo.lat, lon: geo.lon };
  if (geo.osmRelationId !== null && halfDiagonal >= CITY_HALF_DIAGONAL_KM) {
    return { scope: { relationId: geo.osmRelationId }, center, radiusKm: Math.max(halfDiagonal * 1.5, MIN_REGION_KM), mode: "city" };
  }
  const reach = listings
    .flatMap((l) => (l.lat !== null && l.lon !== null ? [haversineKm(center, { lat: l.lat, lon: l.lon })] : []))
    .filter((d) => d <= MAX_REGION_KM);
  const radiusKm = Math.min(MAX_REGION_KM, Math.max(MIN_REGION_KM, halfDiagonal, ...reach.map((d) => d + 2)));
  return { scope: { bbox: boxAround(center, radiusKm) }, center, radiusKm, mode: "region" };
}

/** The box enclosing a circle: [west, south, east, north]. */
export function boxAround(c: LatLon, radiusKm: number): [number, number, number, number] {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.05, Math.cos((c.lat * Math.PI) / 180)));
  return [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat];
}

/**
 * Can a listing with no OSM feature stand as a place? Sights can; activities
 * ("Wild elephant spotting", a performance) only when their name says what
 * kind of place they are.
 */
export function listingIsPlace(l: Pick<Listing, "name" | "kind">): boolean {
  const c = listingCategory(l);
  if (c !== "attraction" && c !== "theatre") return true;
  const activity = /spotting|watching|performances?|\bshows?\b|\btours?\b|\btrek|\bhike|\brides?\b|safari|cruise|class(es)?\b|rafting|lessons?/i;
  return l.kind === "see" && !activity.test(l.name);
}

/** A category for a listing that has no OSM feature, from its name. */
export function listingCategory(l: Pick<Listing, "name" | "kind">): PlaceCategory {
  const n = l.name.toLowerCase();
  const rules: Array<[RegExp, PlaceCategory]> = [
    [/water ?falls?|\bfalls?\b|\bjhar|\bkund\b/, "waterfall"],
    [/national park|sanctuary|wildlife|tiger reserve|\breserve\b|\bforest\b|bird/, "nature_reserve"],
    [/\blake\b|\bdam\b|reservoir|\bkere\b|\btal\b/, "lake"],
    [/\bbeach\b/, "beach"],
    [/\bpeak\b|\bhills?\b|\bmala\b|\bmalai\b|\bbetta\b|\btop station\b/, "peak"],
    [/museum/, "museum"],
    [/gallery/, "gallery"],
    [/temple|church|mosque|monastery|cathedral|gurud?wara|dargah|basilica|shrine|mutt|math\b/, "religious"],
    [/palace/, "palace"],
    [/\bfort\b|castle/, "castle"],
    [/garden|botanical|nisargadhama/, "garden"],
    [/\bpark\b/, "park"],
    [/view ?point|\bpoint\b|\bseat\b|viewpoint/, "viewpoint"],
    [/performance|theatre|theater|kathakali/, "theatre"],
  ];
  return rules.find(([re]) => re.test(n))?.[1] ?? "attraction";
}

/** How much a feature of this kind is worth before anything is known about it. */
export const CATEGORY_WEIGHT: Record<PlaceCategory, number> = {
  museum: 0.75,
  gallery: 0.5,
  monument: 0.25,
  castle: 0.75,
  palace: 0.75,
  religious: 0.25,
  viewpoint: 0.5,
  park: 0.25,
  garden: 0.5,
  attraction: 0.75,
  zoo: 0.75,
  theatre: 0.25,
  square: 0.25,
  waterfall: 1,
  lake: 0.5,
  nature_reserve: 1,
  peak: 0.5,
  beach: 0.75,
  other: -1,
};

export interface RankInput {
  name: string;
  category: PlaceCategory;
  sitelinks: number;
  hasImage: boolean;
  hasHours: boolean;
  listed: boolean;
  hasWikidata: boolean;
  /** 0 at the centre of a region search, 1 at its edge; 0 for city searches. */
  distanceShare: number;
}

export const LISTING_WEIGHT = 3;

/** Hotels and resorts are sometimes tagged as attractions in OSM. */
const LODGING = /\b(resort|hotel|homestay|home stay|cottages?|villas?|inn|lodge|spa|guest ?house)\b/i;

export function rankCandidate(c: RankInput): number {
  let rank = Math.log2(1 + c.sitelinks) + CATEGORY_WEIGHT[c.category];
  if (c.listed) rank += LISTING_WEIGHT;
  if (c.hasImage) rank += 0.5;
  if (c.hasHours) rank += 0.25;
  if (!c.listed && !c.hasWikidata && (isGenericName(c.name) || LODGING.test(c.name))) rank -= 2;
  rank -= 0.5 * Math.min(1, Math.max(0, c.distanceShare));
  return Math.round(rank * 100) / 100;
}

export interface SelectOptions {
  /** Most places to keep. */
  max: number;
  /** Places at or above this are notable and always kept (up to max). */
  notable: number;
  /** Top up to this many with the best of the rest… */
  minPlaces: number;
  /** …as long as they score at least this. */
  floor: number;
}

export const DEFAULT_SELECT: SelectOptions = { max: 150, notable: 2, minPlaces: 30, floor: 0.25 };

/** Keeps notable places, then tops up sparse destinations; input must be sorted best first. */
export function selectRanked<T extends { rank: number }>(sorted: readonly T[], o: SelectOptions = DEFAULT_SELECT): T[] {
  const out: T[] = [];
  for (const item of sorted) {
    if (out.length >= o.max) break;
    if (item.rank >= o.notable || (out.length < o.minPlaces && item.rank >= o.floor)) out.push(item);
  }
  return out;
}
