/**
 * Ingests one city end to end: geocode → OSM places → Wikidata → Wikivoyage
 * descriptions → Commons photos → climate normals, then writes normalized rows
 * (never raw responses) plus cache entries. Runs in the app on demand and from
 * the `ingest/` CLI, with the platform supplying fetch, storage and files.
 */
import { newCacheEntry } from "../cache.js";
import { CATEGORY_INFO, deriveCityThemes } from "../categories.js";
import { computeClimateNormals } from "../climate.js";
import { haversineKm } from "../geo.js";
import type { Repo } from "../db/repo.js";
import { ulid } from "../ids.js";
import type { Attribution, City, Place, SourceLink } from "../schemas.js";
import { fetchImageInfo } from "./commons.js";
import type { HttpFetch } from "./http.js";
import { geocodeCity } from "./nominatim.js";
import { fetchDailyHistory, historyWindow } from "./openmeteo.js";
import { fetchOsmPlaces, type OsmPlace } from "./overpass.js";
import { fetchCountryCurrency, fetchEntities, type WikidataInfo } from "./wikidata.js";
import { cityPages, fetchListings, normalizeName, wikivoyageUrl, type Listing } from "./wikivoyage.js";

export interface IngestProgress {
  step: string;
  done?: number;
  total?: number;
}

export interface FileStore {
  /** Saves a thumbnail and returns the path (or URL) to store on the place. */
  saveThumbnail(name: string, bytes: Uint8Array): Promise<string>;
}

export interface IngestDeps {
  /** Should already be wrapped with politeFetch. */
  fetch: HttpFetch;
  repo: Repo;
  /** Without a file store, places keep the remote thumbnail URL. */
  files?: FileStore | null;
  onProgress?: (p: IngestProgress) => void;
  /** Non-fatal problems, e.g. a photo that couldn't be downloaded. */
  onWarning?: (message: string) => void;
  now?: () => Date;
}

export interface IngestOptions {
  maxPlaces?: number;
  minRank?: number;
  thumbnails?: boolean;
  climate?: boolean;
}

export interface IngestResult {
  city: City;
  places: number;
  withHours: number;
  withDescription: number;
  withPhoto: number;
  climateDays: number;
}

/**
 * Notability: Wikidata sitelinks (how many Wikipedias cover it) dominate,
 * a Wikivoyage listing means travellers recommend it, and photos/hours add a
 * little because they make the place usable in the planner.
 */
export function rankPlace(p: OsmPlace, wd: WikidataInfo | undefined, listing: Listing | undefined): number {
  let rank = Math.log2(1 + (wd?.sitelinkCount ?? 0));
  if (listing) rank += 1.5;
  if (wd?.image) rank += 0.5;
  if (p.hoursRaw) rank += 0.25;
  if (p.category === "other") rank -= 1;
  return Math.round(rank * 100) / 100;
}

const WIKIVOYAGE_LICENSE = {
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
};

export async function ingestCity(deps: IngestDeps, cityQuery: string, options: IngestOptions = {}): Promise<IngestResult> {
  const { fetch, repo } = deps;
  const now = deps.now ?? (() => new Date());
  const progress = deps.onProgress ?? (() => {});
  const warn = deps.onWarning ?? (() => {});
  const maxPlaces = options.maxPlaces ?? 150;
  const minRank = options.minRank ?? 1.5;

  progress({ step: `Finding ${cityQuery}` });
  const geo = await geocodeCity(fetch, cityQuery);
  const fetchedAt = now().toISOString();

  let country = await repo.countryByIso(geo.countryCode);
  if (!country) {
    progress({ step: `Looking up ${geo.countryName}` });
    const currency = await fetchCountryCurrency(fetch, geo.countryCode).catch(() => null);
    country = { id: ulid(), name: geo.countryName, isoCode: geo.countryCode, currency };
    await repo.upsertCountry(country);
    country = (await repo.countryByIso(geo.countryCode)) ?? country;
  }
  // Re-fetching a city updates it in place: by boundary, or by name and position for point-only places.
  const existingCity =
    geo.osmRelationId !== null
      ? await repo.cityByOsmRelation(geo.osmRelationId)
      : ((await repo.listCities()).find(
          (c) => c.osmRelationId === null && normalizeName(c.name) === normalizeName(geo.name) && haversineKm(c, geo) < 10,
        ) ?? null);
  const cityId = existingCity?.id ?? ulid();

  progress({ step: "Fetching places from OpenStreetMap" });
  const osm = await fetchOsmPlaces(fetch, geo.osmRelationId !== null ? { relationId: geo.osmRelationId } : { bbox: geo.bbox });

  progress({ step: "Fetching Wikidata", done: 0, total: osm.length });
  const wikidataIds = osm.flatMap((p) => (p.wikidata ? [p.wikidata] : []));
  if (geo.wikidata) wikidataIds.push(geo.wikidata);
  const wd = await fetchEntities(fetch, wikidataIds);

  progress({ step: "Fetching Wikivoyage descriptions" });
  const voyTitle = (geo.wikidata && wd.get(geo.wikidata)?.enwikivoyage) || geo.name;
  const listings = await fetchListings(fetch, await cityPages(fetch, voyTitle)).catch(() => [] as Listing[]);
  const listingByQid = new Map(listings.flatMap((l) => (l.wikidata ? [[l.wikidata, l] as const] : [])));
  const listingByName = new Map(listings.map((l) => [normalizeName(l.name), l] as const));
  const findListing = (p: OsmPlace, info: WikidataInfo | undefined) =>
    (p.wikidata ? listingByQid.get(p.wikidata) : undefined) ??
    listingByName.get(normalizeName(p.name)) ??
    (info?.label ? listingByName.get(normalizeName(info.label)) : undefined);

  const ranked = osm
    .map((p) => {
      const info = p.wikidata ? wd.get(p.wikidata) : undefined;
      const listing = findListing(p, info);
      return { p, info, listing, rank: rankPlace(p, info, listing) };
    })
    .filter((r) => r.rank >= minRank)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxPlaces);

  const images = new Map<string, { path: string; attribution: Attribution }>();
  const imageFiles = ranked.flatMap((r) => (r.info?.image ? [r.info.image] : []));
  if (options.thumbnails !== false && imageFiles.length > 0) {
    progress({ step: "Fetching photo details", done: 0, total: imageFiles.length });
    const infos = await fetchImageInfo(fetch, imageFiles);
    let done = 0;
    for (const img of infos.values()) {
      let path = img.thumbUrl;
      if (deps.files) {
        try {
          const res = await fetch(img.thumbUrl);
          const ext = /\.(png|webp|gif)$/i.exec(img.thumbUrl)?.[1]?.toLowerCase() ?? "jpg";
          const safe = img.file.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
          path = await deps.files.saveThumbnail(`${safe}.${ext}`, new Uint8Array(await res.arrayBuffer()));
        } catch (e) {
          warn(`Photo ${img.file} skipped: ${e instanceof Error ? e.message : String(e)}`);
          progress({ step: "Saving photos", done: ++done, total: infos.size });
          continue;
        }
      }
      images.set(img.file, { path, attribution: img.attribution });
      progress({ step: "Saving photos", done: ++done, total: infos.size });
    }
  }

  const existingIds = await repo.placeIdsByOsmId(ranked.map((r) => r.p.osmId));
  const places: Place[] = ranked.map(({ p, info, listing, rank }) => {
    const photo = info?.image ? images.get(info.image) : undefined;
    const sources: SourceLink[] = [{ label: "OpenStreetMap", url: `https://www.openstreetmap.org/${p.osmId}` }];
    if (p.wikidata) sources.push({ label: "Wikidata", url: `https://www.wikidata.org/wiki/${p.wikidata}` });
    if (info?.enwiki) {
      sources.push({ label: "Wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(info.enwiki.replace(/ /g, "_"))}` });
    }
    if (listing) sources.push({ label: "Wikivoyage", url: wikivoyageUrl(listing.page) });
    if (p.website) sources.push({ label: "Website", url: p.website });

    let description: string | null = null;
    let descriptionAttribution: Attribution | null = null;
    if (listing) {
      description = listing.content;
      descriptionAttribution = { text: `Wikivoyage: ${listing.page}`, url: wikivoyageUrl(listing.page), ...WIKIVOYAGE_LICENSE };
    } else if (info?.description) {
      description = info.description.charAt(0).toUpperCase() + info.description.slice(1) + ".";
      descriptionAttribution = {
        text: "Wikidata",
        url: `https://www.wikidata.org/wiki/${info.id}`,
        license: "CC0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      };
    }
    return {
      id: existingIds.get(p.osmId) ?? ulid(),
      cityId,
      // English UI: OSM's name:en, else Wikidata's English label, else the local name.
      name: p.tags["name:en"] ?? info?.label ?? p.name,
      category: p.category,
      lat: p.lat,
      lon: p.lon,
      hoursRaw: p.hoursRaw,
      description,
      descriptionAttribution,
      themeTags: CATEGORY_INFO[p.category].themes,
      photoPath: photo?.path ?? null,
      photoAttribution: photo?.attribution ?? null,
      sources,
      osmId: p.osmId,
      wikidata: p.wikidata,
      rank,
      source: "osm",
      fetchedAt,
    };
  });

  const city: City = {
    id: cityId,
    countryId: country.id,
    name: geo.name,
    lat: geo.lat,
    lon: geo.lon,
    bbox: geo.bbox,
    themeTags: deriveCityThemes(places),
    osmRelationId: geo.osmRelationId,
    wikidata: geo.wikidata,
    source: "nominatim",
    fetchedAt,
  };
  progress({ step: "Saving places" });
  await repo.upsertCity(city);
  await repo.upsertPlaces(places);

  let climateDays = 0;
  if (options.climate !== false) {
    progress({ step: "Computing typical weather (20 years of history)" });
    const history = await fetchDailyHistory(fetch, geo.lat, geo.lon, historyWindow(now()));
    const normals = computeClimateNormals(cityId, history);
    await repo.replaceClimateNormals(cityId, normals);
    climateDays = normals.length;
    await repo.upsertCacheEntry(newCacheEntry("climate", cityId, now()));
  }

  for (const category of ["geocode", "places", "hours", "descriptions", "photos"] as const) {
    await repo.upsertCacheEntry(newCacheEntry(category, cityId, now()));
  }
  progress({ step: "Done" });

  return {
    city,
    places: places.length,
    withHours: places.filter((p) => p.hoursRaw).length,
    withDescription: places.filter((p) => p.description).length,
    withPhoto: places.filter((p) => p.photoPath).length,
    climateDays,
  };
}
