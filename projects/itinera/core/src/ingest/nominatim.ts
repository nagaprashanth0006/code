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
  osmRelationId: number;
  countryName: string;
  countryCode: string;
  wikidata: string | null;
}

export async function geocodeCity(fetch: HttpFetch, name: string): Promise<GeocodedCity> {
  const url = `https://nominatim.openstreetmap.org/search?${query({
    q: name,
    format: "jsonv2",
    limit: 5,
    addressdetails: 1,
    extratags: 1,
    featureType: "city",
    "accept-language": "en",
  })}`;
  const results = z.array(NominatimResult).parse(await (await fetch(url)).json());
  const hit = results.find((r) => r.osm_type === "relation");
  if (!hit) throw new Error(`No city boundary found for "${name}"`);
  const [south, north, west, east] = hit.boundingbox.map(Number) as [number, number, number, number];
  const countryCode = hit.address?.country_code?.toUpperCase();
  if (!countryCode || !hit.address?.country) throw new Error(`No country for "${name}"`);
  return {
    name: hit.name,
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    bbox: [west, south, east, north],
    osmRelationId: hit.osm_id,
    countryName: hit.address.country,
    countryCode,
    wikidata: hit.extratags?.wikidata ?? null,
  };
}
