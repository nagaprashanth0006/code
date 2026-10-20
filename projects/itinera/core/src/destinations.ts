/**
 * The destination index: a curated set of places worth a trip, each with
 * coordinates, theme tags, a photo, a short summary and typical weather by
 * month. It lets the landing hub recommend destinations before any city has
 * been fetched. Fetching a city adds its places and replaces the approximate
 * monthly weather with 20-year daily normals.
 *
 * The data is written by `npm run ingest -- destinations` from a hand-curated
 * seed list and committed, so the hub works offline from the first launch.
 */
import { z } from "zod";
import type { WeatherSummary } from "./climate.js";
import indexJson from "./data/destinations.json";
import { dateRange, monthOf, type IsoDate } from "./dates.js";
import { haversineKm } from "./geo.js";
import { normalizeName } from "./ingest/wikivoyage.js";
import { AttributionSchema, ThemeSchema, type City, type Country, type Theme } from "./schemas.js";

export const MonthClimateSchema = z.object({
  days: z.number(),
  lowC: z.number(),
  highC: z.number(),
  coldC: z.number(),
  warmC: z.number(),
  rainDays: z.number(),
  precipMm: z.number(),
});

export const DestinationSchema = z.object({
  /** Stable slug, also the photo's file name. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  countryCode: z.string().length(2),
  lat: z.number(),
  lon: z.number(),
  /** Metres above sea level; typical temperatures are corrected to it. */
  elevationM: z.number().nullable().default(null),
  /** Hand-curated, strongest first. */
  themeTags: z.array(ThemeSchema).min(1),
  /** What to pass to the city ingest; null when no city boundary was found for it. */
  ingestQuery: z.string().nullable(),
  /** First sentences of the English Wikipedia article (CC BY-SA). */
  summary: z.string().nullable(),
  wikipediaUrl: z.string().nullable(),
  photo: z
    .object({
      /** Path under the app's public folder. */
      path: z.string(),
      attribution: AttributionSchema,
    })
    .nullable(),
  /** Typical weather for each month, January first. */
  months: z.array(MonthClimateSchema.nullable()).length(12),
  climateSource: z.string(),
});
export type Destination = z.infer<typeof DestinationSchema>;

export const DestinationIndexSchema = z.object({
  generatedAt: z.string(),
  note: z.string(),
  destinations: z.array(DestinationSchema),
});
export type DestinationIndex = z.infer<typeof DestinationIndexSchema>;

let parsed: Destination[] | null = null;

/** The bundled index, validated once on first use. */
export function destinationIndex(): Destination[] {
  parsed ??= DestinationIndexSchema.parse(indexJson).destinations;
  return parsed;
}

/** Within this distance a fetched city and a destination are the same place. */
export const SAME_PLACE_KM = 25;

/**
 * Is this fetched city the destination? Same place by distance, or the city
 * the destination's ingest query names (a region fetched as its main town,
 * such as the Andaman Islands as Port Blair).
 */
export function isSamePlace(d: Destination, city: Pick<City, "name" | "lat" | "lon">): boolean {
  if (haversineKm(d, city) <= SAME_PLACE_KM) return true;
  return d.ingestQuery !== null && normalizeName(d.ingestQuery) === normalizeName(city.name);
}

/**
 * Something the landing hub can rank: a curated destination, a fetched city,
 * or both when they are the same place.
 */
export interface LandingCandidate {
  id: string;
  name: string;
  countryCode: string;
  lat: number;
  lon: number;
  themeTags: Theme[];
  destination: Destination | null;
  /** Set once the city's places, hours and daily weather are in the catalog. */
  cityId: string | null;
}

/**
 * Merges the curated index with fetched cities. A fetched city keeps the
 * destination's id, photo and summary; its own derived themes are appended
 * after the curated ones. Fetched cities with no matching destination (added
 * by name) are candidates on their own.
 */
export function landingCandidates(
  destinations: readonly Destination[],
  cities: readonly City[],
  countries: readonly Country[],
): LandingCandidate[] {
  const isoByCountryId = new Map(countries.map((c) => [c.id, c.isoCode]));
  const claimed = new Set<string>();
  const out: LandingCandidate[] = destinations.map((d) => {
    const city = cities.find((c) => !claimed.has(c.id) && isSamePlace(d, c));
    if (city) claimed.add(city.id);
    return {
      id: d.id,
      name: d.name,
      countryCode: d.countryCode,
      lat: d.lat,
      lon: d.lon,
      themeTags: city ? [...new Set([...d.themeTags, ...city.themeTags])] : [...d.themeTags],
      destination: d,
      cityId: city?.id ?? null,
    };
  });
  for (const c of cities) {
    if (claimed.has(c.id)) continue;
    out.push({
      id: c.id,
      name: c.name,
      countryCode: isoByCountryId.get(c.countryId) ?? "",
      lat: c.lat,
      lon: c.lon,
      themeTags: [...c.themeTags],
      destination: null,
      cityId: c.id,
    });
  }
  return out;
}

/** Monthly weather per candidate from the index, for scoring candidates without daily normals. */
export function monthlyClimateById(
  candidates: readonly LandingCandidate[],
): Map<string, ReadonlyArray<WeatherSummary | null>> {
  const m = new Map<string, ReadonlyArray<WeatherSummary | null>>();
  for (const c of candidates) if (c.destination) m.set(c.id, c.destination.months);
  return m;
}

/**
 * Typical weather for a date range from monthly figures: each day counts as
 * an average day of its month. Used before a city's daily normals exist.
 */
export function summarizeMonthly(
  months: ReadonlyArray<WeatherSummary | null>,
  start: IsoDate,
  end: IsoDate,
): WeatherSummary | null {
  const days = dateRange(start, end)
    .map((d) => months[monthOf(d) - 1])
    .filter((m): m is WeatherSummary => !!m && m.days > 0);
  if (days.length === 0) return null;
  const avg = (f: (m: WeatherSummary) => number) => Math.round((days.reduce((a, m) => a + f(m), 0) / days.length) * 10) / 10;
  const sum = (f: (m: WeatherSummary) => number) => Math.round(days.reduce((a, m) => a + f(m) / m.days, 0) * 10) / 10;
  return {
    days: days.length,
    lowC: avg((m) => m.lowC),
    highC: avg((m) => m.highC),
    coldC: Math.min(...days.map((m) => m.coldC)),
    warmC: Math.max(...days.map((m) => m.warmC)),
    rainDays: sum((m) => m.rainDays),
    precipMm: sum((m) => m.precipMm),
  };
}

/** "Portugal" from "PT", in English; falls back to the code. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
