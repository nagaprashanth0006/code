/** Candidate "great places" from OpenStreetMap via the Overpass API. */
import { z } from "zod";
import type { PlaceCategory } from "../schemas.js";
import { query, type HttpFetch } from "./http.js";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const OverpassElement = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).default({}),
});
const OverpassResponse = z.object({ elements: z.array(OverpassElement) });
export type OverpassElement = z.infer<typeof OverpassElement>;

export interface OsmPlace {
  osmId: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lon: number;
  hoursRaw: string | null;
  wikidata: string | null;
  website: string | null;
  tags: Record<string, string>;
}

/** OSM area ids for relations are offset by 3.6 billion. */
export const areaIdForRelation = (relationId: number) => 3_600_000_000 + relationId;

export function buildPlacesQuery(relationId: number): string {
  const a = "(area.city)";
  return `[out:json][timeout:180];
area(id:${areaIdForRelation(relationId)})->.city;
(
  nwr["tourism"~"^(museum|gallery|attraction|viewpoint|zoo|aquarium|theme_park)$"]["name"]${a};
  nwr["historic"~"^(castle|fort|palace|monastery|church|cathedral|monument|memorial|city_gate|tower|archaeological_site|ruins|building|aqueduct)$"]["name"]["wikidata"]${a};
  nwr["amenity"="place_of_worship"]["name"]["wikidata"]${a};
  nwr["leisure"~"^(park|garden)$"]["name"]["wikidata"]${a};
  nwr["amenity"~"^(theatre|arts_centre)$"]["name"]["wikidata"]${a};
  nwr["place"="square"]["name"]["wikidata"]${a};
);
out center tags qt;`;
}

export function categorize(tags: Record<string, string>): PlaceCategory {
  const tourism = tags.tourism;
  const historic = tags.historic;
  if (tourism === "museum") return "museum";
  if (tourism === "gallery") return "gallery";
  if (tourism === "zoo" || tourism === "aquarium") return "zoo";
  if (tourism === "viewpoint") return "viewpoint";
  if (historic === "castle" && tags.castle_type === "palace") return "palace";
  if (historic === "palace") return "palace";
  if (historic === "castle" || historic === "fort") return "castle";
  if (
    tags.amenity === "place_of_worship" ||
    historic === "monastery" ||
    historic === "church" ||
    historic === "cathedral" ||
    tags.building === "church" ||
    tags.building === "cathedral"
  ) {
    return "religious";
  }
  if (
    historic &&
    ["monument", "memorial", "city_gate", "tower", "archaeological_site", "ruins", "aqueduct"].includes(historic)
  ) {
    return "monument";
  }
  if (tags.leisure === "park") return "park";
  if (tags.leisure === "garden") return "garden";
  if (tags.amenity === "theatre" || tags.amenity === "arts_centre") return "theatre";
  if (tags.place === "square") return "square";
  if (tourism === "attraction" || tourism === "theme_park") return "attraction";
  if (historic) return "monument";
  return "other";
}

export function normalizeElements(elements: readonly OverpassElement[]): OsmPlace[] {
  const out: OsmPlace[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags["name:en"] ?? el.tags.name;
    if (lat === undefined || lon === undefined || !name) continue;
    out.push({
      osmId: `${el.type}/${el.id}`,
      name,
      category: categorize(el.tags),
      lat,
      lon,
      hoursRaw: el.tags.opening_hours ?? null,
      wikidata: el.tags.wikidata ?? null,
      website: el.tags.website ?? el.tags["contact:website"] ?? null,
      tags: el.tags,
    });
  }
  // The same sight is often mapped twice (e.g. a node and its building).
  // Keep one per Wikidata id, preferring the one with opening hours, then the area.
  const byWikidata = new Map<string, OsmPlace>();
  const result: OsmPlace[] = [];
  const score = (p: OsmPlace) => (p.hoursRaw ? 2 : 0) + (p.osmId.startsWith("node/") ? 0 : 1);
  for (const p of out) {
    if (!p.wikidata) {
      result.push(p);
      continue;
    }
    const prev = byWikidata.get(p.wikidata);
    if (!prev || score(p) > score(prev)) byWikidata.set(p.wikidata, p);
  }
  return [...result, ...byWikidata.values()];
}

export async function fetchOsmPlaces(fetch: HttpFetch, relationId: number): Promise<OsmPlace[]> {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query({ data: buildPlacesQuery(relationId) }),
  });
  return normalizeElements(OverpassResponse.parse(await res.json()).elements);
}
