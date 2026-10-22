/**
 * Destination score for the landing hub:
 *   score = theme fit × season fit (for the month) × reachability from home × price signal
 * Each factor is in (0, 1] and returned alongside the score, so every ranking
 * can be explained. Rows cover the current month plus the next three.
 */
import { z } from "zod";
import { monthClimate, summarizeWeather, type WeatherSummary } from "./climate.js";
import { addDays, monthOf, monthWindow, weekdayIndex, type IsoDate } from "./dates.js";
import { summarizeMonthly } from "./destinations.js";
import { estimateInterCityTravel, haversineKm } from "./geo.js";
import type { City, ClimateNormal, RouteEdge, Theme } from "./schemas.js";
import { ThemeSchema } from "./schemas.js";
import { clamp } from "./stats.js";

export interface ScoreFactors {
  themeFit: number;
  seasonFit: number;
  reachability: number;
  priceSignal: number;
}

export interface DestinationScore {
  /** A landing candidate's id: a destination slug or a fetched city's id. */
  destinationId: string;
  /** Null for rows that rank across all themes. */
  theme: Theme | null;
  year: number;
  month: number;
  score: number;
  factors: ScoreFactors;
  travelMinutes: number;
  /** Straight-line distance from home. */
  distanceKm: number;
  /** Typical weather for the scored month, or for the dates when ranked for dates. */
  weather: WeatherSummary | null;
}

/** Anything rankable: a fetched city or a curated destination (see destinations.ts). */
export interface RankCandidate {
  id: string;
  lat: number;
  lon: number;
  themeTags: readonly Theme[];
  /** ISO 3166-1 alpha-2, for the landing config's country filter. */
  countryCode?: string;
}

export interface ScoringContext {
  home: Pick<City, "id" | "lat" | "lon">;
  /** Daily normals by candidate id: precise, preferred when present. */
  normalsByCity: ReadonlyMap<string, readonly ClimateNormal[]>;
  /** Typical weather per month (January first) by candidate id, for candidates without daily normals. */
  monthlyClimate?: ReadonlyMap<string, ReadonlyArray<WeatherSummary | null>>;
  routes: readonly RouteEdge[];
  /** Typical stay price (p50 per night, any single currency) by city; missing = neutral. */
  stayPriceByCity?: ReadonlyMap<string, number>;
}

/**
 * A tagged theme fits fully; an untagged one still scores a little so rows
 * aren't empty. A null theme (a row across all themes) fits everything.
 */
export function themeFit(city: { themeTags: readonly Theme[] }, theme: Theme | null): number {
  if (theme === null) return 1;
  const i = city.themeTags.indexOf(theme);
  if (i < 0) return 0.25;
  // Earlier tags are stronger (deriveCityThemes sorts by weight).
  return 1 - Math.min(i, 4) * 0.05;
}

/**
 * Comfort from typical highs (best 18–27 °C, falling to 0.2 at 10 °C outside
 * that band) times a rain penalty (all-rainy month → 0.4).
 */
export function seasonFit(w: WeatherSummary | null): number {
  if (!w) return 0.6;
  const t = w.highC;
  const distance = t < 18 ? 18 - t : t > 27 ? t - 27 : 0;
  const comfort = clamp(1 - (distance / 10) * 0.8, 0.2, 1);
  const rainShare = clamp(w.rainDays / Math.max(w.days, 1), 0, 1);
  return comfort * (1 - 0.6 * rainShare);
}

/** Full marks up to 3 h door to door, sliding to 0.3 at 24 h. Direct routes get a small bonus. */
export function reachability(minutes: number, direct: boolean): number {
  const h = minutes / 60;
  const base = h <= 3 ? 1 : clamp(1 - ((h - 3) / 21) * 0.7, 0.3, 1);
  return clamp(base * (direct ? 1 : 0.9), 0.05, 1);
}

/** Cheaper than the median of candidates → up to 1; pricier → down to 0.5; unknown → 0.75. */
export function priceSignal(price: number | undefined, median: number | undefined): number {
  if (price === undefined || median === undefined || median <= 0) return 0.75;
  return clamp(0.75 * (median / price), 0.5, 1);
}

/** Daily normals when the candidate has them, else the index's monthly figures. */
export function climateFor(ctx: ScoringContext, id: string, month: number): WeatherSummary | null {
  const normals = ctx.normalsByCity.get(id);
  if (normals && normals.length > 0) return monthClimate(normals, month);
  return ctx.monthlyClimate?.get(id)?.[month - 1] ?? null;
}

function travelTo(ctx: ScoringContext, city: Pick<RankCandidate, "id" | "lat" | "lon">): { minutes: number; direct: boolean } {
  const edges = ctx.routes.filter((r) => r.fromCityId === ctx.home.id && r.toCityId === city.id);
  if (edges.length > 0) {
    const best = edges.reduce((a, b) => (b.typicalMinutes < a.typicalMinutes ? b : a));
    return { minutes: best.typicalMinutes, direct: best.direct };
  }
  const est = estimateInterCityTravel(ctx.home, city);
  return { minutes: est.minutes, direct: est.mode !== "flight" };
}

/** Typical weather for a date range: daily normals when the candidate has them, else the index's monthly figures. */
export function climateForDates(ctx: ScoringContext, id: string, start: IsoDate, end: IsoDate): WeatherSummary | null {
  const normals = ctx.normalsByCity.get(id);
  if (normals && normals.length > 0) return summarizeWeather(normals, start, end);
  const months = ctx.monthlyClimate?.get(id);
  return months ? summarizeMonthly(months, start, end) : null;
}

/**
 * Ranks candidates for fixed dates instead of each one's best month: the
 * season factor comes from the typical weather on those dates.
 */
export function rankForDates(
  cities: readonly RankCandidate[],
  theme: Theme | null,
  start: IsoDate,
  end: IsoDate,
  ctx: ScoringContext,
): DestinationScore[] {
  const priceMedian = median([...(ctx.stayPriceByCity?.values() ?? [])]);
  const out: DestinationScore[] = [];
  for (const city of cities) {
    if (city.id === ctx.home.id) continue;
    const travel = travelTo(ctx, city);
    const weather = climateForDates(ctx, city.id, start, end);
    const factors: ScoreFactors = {
      themeFit: themeFit(city, theme),
      seasonFit: seasonFit(weather),
      reachability: reachability(travel.minutes, travel.direct),
      priceSignal: priceSignal(ctx.stayPriceByCity?.get(city.id), priceMedian),
    };
    const score = factors.themeFit * factors.seasonFit * factors.reachability * factors.priceSignal;
    out.push({
      destinationId: city.id,
      theme,
      year: Number(start.slice(0, 4)),
      month: monthOf(start),
      score: Math.round(score * 1000) / 1000,
      factors,
      travelMinutes: travel.minutes,
      distanceKm: Math.round(haversineKm(ctx.home, city)),
      weather,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Ranks cities for a theme over the window. Each city appears once, at its
 * best month in the window.
 */
export function rankDestinations(
  cities: readonly RankCandidate[],
  theme: Theme | null,
  today: IsoDate,
  ctx: ScoringContext,
  windowMonths = 4,
): DestinationScore[] {
  const months = monthWindow(today, windowMonths);
  const priceMedian = median([...(ctx.stayPriceByCity?.values() ?? [])]);
  const out: DestinationScore[] = [];
  for (const city of cities) {
    if (city.id === ctx.home.id) continue;
    const travel = travelTo(ctx, city);
    const factorsBase = {
      themeFit: themeFit(city, theme),
      reachability: reachability(travel.minutes, travel.direct),
      priceSignal: priceSignal(ctx.stayPriceByCity?.get(city.id), priceMedian),
    };
    let best: DestinationScore | null = null;
    for (const { year, month } of months) {
      const factors: ScoreFactors = { ...factorsBase, seasonFit: seasonFit(climateFor(ctx, city.id, month)) };
      const score = factors.themeFit * factors.seasonFit * factors.reachability * factors.priceSignal;
      if (!best || score > best.score) {
        best = {
          destinationId: city.id,
          theme,
          year,
          month,
          score: Math.round(score * 1000) / 1000,
          factors,
          travelMinutes: travel.minutes,
          distanceKm: Math.round(haversineKm(ctx.home, city)),
          weather: climateFor(ctx, city.id, month),
        };
      }
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------- landing config

/** Landing layout is data, not code, so a designer can edit it later. */
export const LandingRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Omitted: rank across all themes (e.g. "Great this season"). */
  theme: ThemeSchema.optional(),
  limit: z.number().int().positive().default(10),
  order: z.enum(["score", "travel-time"]).default("score"),
  filters: z
    .object({
      maxTravelHours: z.number().positive().optional(),
      /** ISO 3166-1 alpha-2 codes. */
      countries: z.array(z.string().length(2)).optional(),
    })
    .default({}),
});
export type LandingRow = z.infer<typeof LandingRowSchema>;

export const LandingConfigSchema = z.object({
  windowMonths: z.number().int().min(1).max(12).default(4),
  rows: z.array(LandingRowSchema),
});
export type LandingConfig = z.infer<typeof LandingConfigSchema>;

export const DEFAULT_LANDING_CONFIG: LandingConfig = LandingConfigSchema.parse({
  windowMonths: 4,
  rows: [
    { id: "season", title: "Great this season" },
    { id: "short-hops", title: "Short hops from home", filters: { maxTravelHours: 7 } },
    { id: "romantic", title: "Romantic", theme: "romantic" },
    { id: "solo", title: "Solo", theme: "solo" },
    { id: "adventure", title: "Adventure", theme: "adventure" },
    { id: "nature", title: "Nature / Scenic", theme: "nature" },
    { id: "historical", title: "Historical", theme: "historical" },
    { id: "culture", title: "Culture", theme: "culture" },
  ],
});

export interface LandingRowResult {
  row: LandingRow;
  destinations: DestinationScore[];
}

/** Setting keys the landing hub reads. Both hold JSON. */
export const LANDING_CONFIG_SETTING = "landingConfig";
export const HOME_CITY_SETTING = "homeCity";

/**
 * The stored landing layout if it parses, else the default. A bad edit to the
 * setting falls back rather than leaving the hub empty.
 */
export function landingConfigFrom(raw: string | null): LandingConfig {
  if (!raw) return DEFAULT_LANDING_CONFIG;
  try {
    const parsed = LandingConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_LANDING_CONFIG;
  } catch {
    return DEFAULT_LANDING_CONFIG;
  }
}

// ---------------------------------------------------------- home city

/** Asked once and stored as a setting. Home need not be in the catalog. */
export const HomeCitySchema = z.object({
  name: z.string().min(1),
  countryCode: z.string().length(2),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type HomeCity = z.infer<typeof HomeCitySchema>;

export function homeCityFrom(raw: string | null): HomeCity | null {
  if (!raw) return null;
  try {
    const parsed = HomeCitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A catalog city this close to home is home, and isn't ranked as a destination. */
export const HOME_MATCH_KM = 25;

/** The scoring anchor for home: the id of the candidate (fetched city or destination) that is home, if any. */
export function homeAnchor(
  home: HomeCity,
  cities: ReadonlyArray<Pick<City, "id" | "lat" | "lon">>,
): Pick<City, "id" | "lat" | "lon"> {
  const match = cities.find((c) => haversineKm(c, home) <= HOME_MATCH_KM);
  return { id: match?.id ?? "home", lat: home.lat, lon: home.lon };
}

/**
 * Dates to prefill when planning a ranked destination: a long weekend
 * (Friday to Monday) starting on the first Friday of the month that is at
 * least a week away.
 */
export function suggestTripDates(year: number, month: number, today: IsoDate): { startDate: IsoDate; endDate: IsoDate } {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const earliest = addDays(today, 7) > first ? addDays(today, 7) : first;
  const startDate = addDays(earliest, (4 - weekdayIndex(earliest) + 7) % 7);
  return { startDate, endDate: addDays(startDate, 3) };
}

/**
 * One ranked list per configured row. Theme rows keep only candidates tagged
 * with the theme; the untagged fallback score is for direct ranking.
 */
export function buildLanding(
  config: LandingConfig,
  candidates: readonly RankCandidate[],
  today: IsoDate,
  ctx: ScoringContext,
): LandingRowResult[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return config.rows.map((row) => {
    const theme = row.theme ?? null;
    let ranked = rankDestinations(candidates, theme, today, ctx, config.windowMonths);
    if (theme) ranked = ranked.filter((d) => byId.get(d.destinationId)?.themeTags.includes(theme));
    const { maxTravelHours, countries } = row.filters;
    if (maxTravelHours) ranked = ranked.filter((d) => d.travelMinutes <= maxTravelHours * 60);
    if (countries?.length) {
      ranked = ranked.filter((d) => countries.includes(byId.get(d.destinationId)?.countryCode ?? ""));
    }
    if (row.order === "travel-time") ranked = [...ranked].sort((a, b) => a.travelMinutes - b.travelMinutes);
    return { row, destinations: ranked.slice(0, row.limit) };
  });
}
