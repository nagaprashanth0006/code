/**
 * Ingests one city end to end: geocode → Wikivoyage guide → OSM places in the
 * search region → Wikidata → merge, rank, dedupe and select (selection.ts) →
 * Commons photos → climate normals, then writes normalized rows (never raw
 * responses) plus cache entries. Runs in the app on demand and from
 * the `ingest/` CLI, with the platform supplying fetch, storage and files.
 */
import { newCacheEntry } from "../cache.js";
import { CATEGORY_INFO, deriveCityThemes } from "../categories.js";
import { computeClimateNormals } from "../climate.js";
import { haversineKm } from "../geo.js";
import type { Repo } from "../db/repo.js";
import { ulid } from "../ids.js";
import type { Attribution, BBox, City, Place, PlaceCategory, SourceLink } from "../schemas.js";
import { fetchImageInfo } from "./commons.js";
import { abortError, type HttpFetch } from "./http.js";
import { geocodeCity } from "./nominatim.js";
import { fetchDailyHistory, historyWindow } from "./openmeteo.js";
import { dedupeByName, isGenericName, keysMatch, matchKeys, nameKey } from "./matching.js";
import { fetchOsmPlaces, type OsmPlace } from "./overpass.js";
import {
  DEFAULT_SELECT,
  listingCategory,
  listingIsPlace,
  rankCandidate,
  searchRegion,
  selectRanked,
  type SelectOptions,
} from "./selection.js";
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
  /** Cancels the fetch. Nothing about the city is saved unless it gets to the final save step. */
  signal?: AbortSignal;
}

export interface IngestOptions {
  maxPlaces?: number;
  /** Overrides for how places are kept (see selection.ts). */
  select?: Partial<SelectOptions>;
  /** Wikivoyage pages to read instead of the city's own article and subpages. */
  wikivoyagePages?: string[];
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

/** A place found by OSM, by a Wikivoyage listing, or both. */
interface Candidate {
  name: string;
  lat: number;
  lon: number;
  category: PlaceCategory;
  osm: OsmPlace | null;
  listing: Listing | null;
  info: WikidataInfo | undefined;
  rank: number;
}

/** Features whose mapped centre can sit far from where a guide pins them (a park's middle, a lake's). */
const SPREAD_OUT = new Set<PlaceCategory>(["nature_reserve", "lake", "park", "peak", "beach"]);

const WIKIVOYAGE_LICENSE = {
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
};

/** Makes every request and progress report fail fast once the signal aborts. */
function cancellable(fetch: HttpFetch, signal: AbortSignal): HttpFetch {
  return (url, init) => {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      fetch(url, init).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };
}

export async function ingestCity(deps: IngestDeps, cityQuery: string, options: IngestOptions = {}): Promise<IngestResult> {
  const { repo, signal } = deps;
  const fetch = signal ? cancellable(deps.fetch, signal) : deps.fetch;
  const now = deps.now ?? (() => new Date());
  const report = deps.onProgress ?? (() => {});
  const progress = (p: IngestProgress) => {
    if (signal?.aborted) throw abortError();
    report(p);
  };
  const warn = deps.onWarning ?? (() => {});
  const select: SelectOptions = { ...DEFAULT_SELECT, ...(options.maxPlaces ? { max: options.maxPlaces } : {}), ...options.select };

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

  // The travel guide first: its listings say what's worth seeing and how far out to look.
  progress({ step: "Reading the Wikivoyage guide" });
  const cityInfo = geo.wikidata ? (await fetchEntities(fetch, [geo.wikidata])).get(geo.wikidata) : undefined;
  const voyTitle = cityInfo?.enwikivoyage || geo.name;
  const listings = await fetchListings(fetch, options.wikivoyagePages ?? (await cityPages(fetch, voyTitle))).catch(
    () => [] as Listing[],
  );
  const region = searchRegion(geo, listings);

  progress({
    step: region.mode === "city" ? "Fetching places from OpenStreetMap" : `Fetching places within ${Math.round(region.radiusKm)} km`,
  });
  // A region is fetched as a box; keep what lies inside its radius.
  const osm = (await fetchOsmPlaces(fetch, region.scope)).filter(
    (p) => region.mode === "city" || haversineKm(region.center, p) <= region.radiusKm,
  );

  progress({ step: "Fetching Wikidata", done: 0, total: osm.length });
  const wikidataIds = [...osm.flatMap((p) => (p.wikidata ? [p.wikidata] : [])), ...listings.flatMap((l) => (l.wikidata ? [l.wikidata] : []))];
  const wd = await fetchEntities(fetch, wikidataIds);

  // Match listings to OSM features: by Wikidata id, else by a spelling-tolerant name nearby.
  const listingByQid = new Map(listings.flatMap((l) => (l.wikidata ? [[l.wikidata, l] as const] : [])));
  // A distinctive name ("Lakkam Waterfalls", not "Photo Point") matches anywhere in the region:
  // guide pins are sometimes several km off.
  const listingKeys = listings.map((l) => {
    const keys = matchKeys(l.name);
    return { l, keys, distinctive: keys.core.length >= 5 && !isGenericName(l.name) };
  });
  const matched = new Set<Listing>();
  const findListing = (p: OsmPlace, info: WikidataInfo | undefined): Listing | null => {
    const byQid = p.wikidata ? listingByQid.get(p.wikidata) : undefined;
    if (byQid) return byQid;
    const names = [p.name, p.tags["name:en"], info?.label].flatMap((n) => (n ? [matchKeys(n)] : []));
    const reachKm = SPREAD_OUT.has(p.category) ? 10 : 3;
    let best: Listing | null = null;
    let bestKm = Infinity;
    for (const { l, keys, distinctive } of listingKeys) {
      if (!names.some((n) => keysMatch(n, keys))) continue;
      const km = l.lat !== null && l.lon !== null ? haversineKm(p, { lat: l.lat, lon: l.lon }) : reachKm;
      if ((km > reachKm && !distinctive) || km >= bestKm) continue;
      best = l;
      bestKm = km;
    }
    return best;
  };

  const distanceShare = (p: { lat: number; lon: number }) =>
    region.mode === "region" ? haversineKm(region.center, p) / region.radiusKm : 0;
  const rank = (c: Omit<Candidate, "rank">) =>
    rankCandidate({
      name: c.name,
      category: c.category,
      sitelinks: c.info?.sitelinkCount ?? 0,
      hasImage: !!c.info?.image,
      hasHours: !!c.osm?.hoursRaw,
      listed: c.listing !== null,
      hasWikidata: !!c.info,
      distanceShare: distanceShare(c),
    });

  // English UI: OSM's name:en, else Wikidata's English label, else the local name.
  const osmCandidates = osm.map((p) => {
    const info = p.wikidata ? wd.get(p.wikidata) : undefined;
    return { name: p.tags["name:en"] ?? info?.label ?? p.name, lat: p.lat, lon: p.lon, category: p.category, osm: p, info, listing: findListing(p, info) };
  });
  // A listing describes one place: when several features match it (three "Photo Point"s), only the
  // nearest to the listing's pin, or to the centre when it has none, keeps it.
  const holder = new Map<Listing, (typeof osmCandidates)[number]>();
  for (const c of osmCandidates) {
    if (!c.listing) continue;
    const l = c.listing;
    const anchor = l.lat !== null && l.lon !== null ? { lat: l.lat, lon: l.lon } : region.center;
    const prev = holder.get(l);
    if (!prev || haversineKm(c, anchor) < haversineKm(prev, anchor)) holder.set(l, c);
  }
  const candidates: Candidate[] = [];
  for (const c of osmCandidates) {
    const listing = c.listing && holder.get(c.listing) === c ? c.listing : null;
    if (listing) matched.add(listing);
    const withListing = { ...c, listing };
    candidates.push({ ...withListing, rank: rank(withListing) });
  }
  // Listed sights OSM doesn't have (or names too differently) stand on their own when the guide pins them.
  for (const l of listings) {
    if (matched.has(l) || l.lat === null || l.lon === null || !listingIsPlace(l)) continue;
    if (haversineKm(region.center, { lat: l.lat, lon: l.lon }) > region.radiusKm) continue;
    const c = { name: l.name, lat: l.lat, lon: l.lon, category: listingCategory(l), osm: null, listing: l, info: l.wikidata ? wd.get(l.wikidata) : undefined };
    candidates.push({ ...c, rank: rank(c) });
  }

  // Best first, so de-duplication keeps the best-described of each name and selection reads in order.
  candidates.sort((a, b) => b.rank - a.rank || Number(!!b.osm) - Number(!!a.osm));
  // A guide's pin and OSM's point for the same sight can be a few km apart; a park's centre and its gate further.
  const dedupeKm = (a: Candidate, b: Candidate) => (SPREAD_OUT.has(a.category) || SPREAD_OUT.has(b.category) ? 15 : 5);
  const ranked = selectRanked(dedupeByName(candidates, dedupeKm), select);

  const images = new Map<string, { path: string; attribution: Attribution }>();
  const imageFiles = [...new Set(ranked.flatMap((r) => (r.info?.image ? [r.info.image] : [])))];
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

  // Listing-only places get a stable synthetic id so re-fetching updates them in place.
  const sourceId = (c: Candidate) => c.osm?.osmId ?? `wikivoyage:${c.listing!.page}#${nameKey(c.listing!.name).replace(/ /g, "-")}`;
  const existingIds = await repo.placeIdsByOsmId(ranked.map(sourceId));
  const places: Place[] = ranked.map((c) => {
    const { osm: p, info, listing, rank } = c;
    const qid = p?.wikidata ?? listing?.wikidata ?? null;
    const photo = info?.image ? images.get(info.image) : undefined;
    const sources: SourceLink[] = p ? [{ label: "OpenStreetMap", url: `https://www.openstreetmap.org/${p.osmId}` }] : [];
    if (qid) sources.push({ label: "Wikidata", url: `https://www.wikidata.org/wiki/${qid}` });
    if (info?.enwiki) {
      sources.push({ label: "Wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(info.enwiki.replace(/ /g, "_"))}` });
    }
    if (listing) sources.push({ label: "Wikivoyage", url: wikivoyageUrl(listing.page) });
    if (p?.website) sources.push({ label: "Website", url: p.website });

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
      id: existingIds.get(sourceId(c)) ?? ulid(),
      cityId,
      name: c.name,
      category: c.category,
      lat: c.lat,
      lon: c.lon,
      hoursRaw: p?.hoursRaw ?? null,
      description,
      descriptionAttribution,
      themeTags: CATEGORY_INFO[c.category].themes,
      photoPath: photo?.path ?? null,
      photoAttribution: photo?.attribution ?? null,
      sources,
      osmId: sourceId(c),
      wikidata: qid,
      rank,
      source: p ? "osm" : "wikivoyage",
      fetchedAt,
    };
  });

  const city: City = {
    id: cityId,
    countryId: country.id,
    name: geo.name,
    lat: geo.lat,
    lon: geo.lon,
    // A region's places spread well beyond the town, so the map frames them rather than the town.
    bbox: region.mode === "region" && places.length > 0 ? placesBox(geo.bbox, places) : geo.bbox,
    themeTags: deriveCityThemes(places),
    osmRelationId: geo.osmRelationId,
    wikidata: geo.wikidata,
    source: "nominatim",
    fetchedAt,
  };
  // Weather before saving anything, so a cancelled or failed fetch leaves no half-fetched city.
  let normals: ReturnType<typeof computeClimateNormals> | null = null;
  if (options.climate !== false) {
    progress({ step: "Computing typical weather (20 years of history)" });
    const history = await fetchDailyHistory(fetch, geo.lat, geo.lon, historyWindow(now()));
    normals = computeClimateNormals(cityId, history);
  }

  progress({ step: "Saving places" });
  await repo.upsertCity(city);
  await repo.upsertPlaces(places);
  await repo.prunePlaces(cityId, places.map((p) => p.id));

  let climateDays = 0;
  if (normals) {
    await repo.replaceClimateNormals(cityId, normals);
    climateDays = normals.length;
    await repo.upsertCacheEntry(newCacheEntry("climate", cityId, now()));
  }

  for (const category of ["geocode", "places", "hours", "descriptions", "photos"] as const) {
    await repo.upsertCacheEntry(newCacheEntry(category, cityId, now()));
  }
  report({ step: "Done" });

  return {
    city,
    places: places.length,
    withHours: places.filter((p) => p.hoursRaw).length,
    withDescription: places.filter((p) => p.description).length,
    withPhoto: places.filter((p) => p.photoPath).length,
    climateDays,
  };
}

/** The town's box grown to take in its places, with a little margin. */
function placesBox(town: BBox, places: ReadonlyArray<{ lat: number; lon: number }>): BBox {
  const lats = places.map((p) => p.lat);
  const lons = places.map((p) => p.lon);
  const pad = 0.01;
  return [
    Math.min(town[0], ...lons) - pad,
    Math.min(town[1], ...lats) - pad,
    Math.max(town[2], ...lons) + pad,
    Math.max(town[3], ...lats) + pad,
  ];
}
