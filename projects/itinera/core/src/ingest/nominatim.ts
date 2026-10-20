/** City geocoding via Nominatim (max 1 request/second; results cached permanently). */
import { z } from "zod";
import type { BBox } from "../schemas.js";
import { query, type HttpFetch } from "./http.js";

const NominatimResult = z.object({
  osm_type: z.string(),
  osm_id: z.number(),
  lat: z.string(),
  lon: z.string(),
  name: z.string(),
  display_name: z.string(),
  boundingbox: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  address: z.object({ country: z.string().optional(), country_code: z.string().optional() }).optional(),
  extratags: z.record(z.string(), z.string()).nullable().optional(),
});

export interface GeocodedCity {
  name: string;
  lat: number;
  lon: number;
  bbox: BBox;
  /** The boundary relation; null when only the place's point is mapped (Mumbai, Munnar). */
  osmRelationId: number | null;
  countryName: string;
  countryCode: string;
  wikidata: string | null;
}

async function search(fetch: HttpFetch, name: string, featureType: "city" | "settlement") {
  const url = `https://nominatim.openstreetmap.org/search?${query({
    q: name,
    format: "jsonv2",
    limit: 5,
    addressdetails: 1,
    extratags: 1,
    featureType,
    "accept-language": "en",
  })}`;
  return z.array(NominatimResult).parse(await (await fetch(url)).json());
}

/** Half-width in degrees of the box searched around a place mapped only as a point. */
const POINT_RADIUS_DEG = { city: 0.12, other: 0.05 };

/**
 * A city's boundary, or failing that a town's (Panaji). Places mapped only as
 * a point (Mumbai, Munnar) get a box around the point instead.
 */
export async function geocodeCity(fetch: HttpFetch, name: string): Promise<GeocodedCity> {
  const isRelation = (r: z.infer<typeof NominatimResult>) => r.osm_type === "relation";
  const isNode = (r: z.infer<typeof NominatimResult>) => r.osm_type === "node";
  const cities = await search(fetch, name, "city");
  let hit = cities.find(isRelation);
  let settlements: z.infer<typeof NominatimResult>[] = [];
  if (!hit) {
    settlements = await search(fetch, name, "settlement");
    hit = settlements.find(isRelation) ?? cities.find(isNode) ?? settlements.find(isNode);
  }
  if (!hit) throw new Error(`No city boundary found for "${name}"`);
  let [south, north, west, east] = hit.boundingbox.map(Number) as [number, number, number, number];
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (hit.osm_type === "node") {
    const r = cities.includes(hit) ? POINT_RADIUS_DEG.city : POINT_RADIUS_DEG.other;
    [south, north, west, east] = [Math.min(south, lat - r), Math.max(north, lat + r), Math.min(west, lon - r), Math.max(east, lon + r)];
  }
  const countryCode = hit.address?.country_code?.toUpperCase();
  if (!countryCode || !hit.address?.country) throw new Error(`No country for "${name}"`);
  return {
    name: hit.name,
    lat,
    lon,
    bbox: [west, south, east, north],
    osmRelationId: hit.osm_type === "relation" ? hit.osm_id : null,
    countryName: hit.address.country,
    countryCode,
    wikidata: hit.extratags?.wikidata ?? null,
  };
}
