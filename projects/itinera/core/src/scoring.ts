/**
 * Destination score for the landing hub:
 *   score = theme fit × season fit (for the month) × reachability from home × price signal
 * Each factor is in (0, 1] and returned alongside the score, so every ranking
 * can be explained. Rows cover the current month plus the next three.
 */
import { z } from "zod";
import { monthClimate, type WeatherSummary } from "./climate.js";
import { monthWindow, type IsoDate } from "./dates.js";
import { estimateInterCityTravel } from "./geo.js";
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
  cityId: string;
  theme: Theme;
  year: number;
  month: number;
  score: number;
  factors: ScoreFactors;
  travelMinutes: number;
}

export interface ScoringContext {
  home: Pick<City, "id" | "lat" | "lon">;
  normalsByCity: ReadonlyMap<string, readonly ClimateNormal[]>;
  routes: readonly RouteEdge[];
  /** Typical stay price (p50 per night, any single currency) by city; missing = neutral. */
  stayPriceByCity?: ReadonlyMap<string, number>;
}

/** A tagged theme fits fully; an untagged one still scores a little so rows aren't empty. */
export function themeFit(city: Pick<City, "themeTags">, theme: Theme): number {
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

function travelTo(ctx: ScoringContext, city: Pick<City, "id" | "lat" | "lon">): { minutes: number; direct: boolean } {
  const edges = ctx.routes.filter((r) => r.fromCityId === ctx.home.id && r.toCityId === city.id);
  if (edges.length > 0) {
    const best = edges.reduce((a, b) => (b.typicalMinutes < a.typicalMinutes ? b : a));
    return { minutes: best.typicalMinutes, direct: best.direct };
  }
  const est = estimateInterCityTravel(ctx.home, city);
  return { minutes: est.minutes, direct: est.mode !== "flight" };
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
  cities: readonly City[],
  theme: Theme,
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
      const normals = ctx.normalsByCity.get(city.id) ?? [];
      const factors: ScoreFactors = { ...factorsBase, seasonFit: seasonFit(monthClimate(normals, month)) };
      const score = factors.themeFit * factors.seasonFit * factors.reachability * factors.priceSignal;
      if (!best || score > best.score) {
        best = { cityId: city.id, theme, year, month, score: Math.round(score * 1000) / 1000, factors, travelMinutes: travel.minutes };
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
  theme: ThemeSchema,
  limit: z.number().int().positive().default(8),
  order: z.enum(["score", "travel-time"]).default("score"),
  filters: z
    .object({
      maxTravelHours: z.number().positive().optional(),
      countries: z.array(z.string()).optional(),
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

export function buildLanding(
  config: LandingConfig,
  cities: readonly City[],
  today: IsoDate,
  ctx: ScoringContext,
): LandingRowResult[] {
  const byId = new Map(cities.map((c) => [c.id, c]));
  return config.rows.map((row) => {
    let ranked = rankDestinations(cities, row.theme, today, ctx, config.windowMonths);
    const { maxTravelHours, countries } = row.filters;
    if (maxTravelHours) ranked = ranked.filter((d) => d.travelMinutes <= maxTravelHours * 60);
    if (countries?.length) ranked = ranked.filter((d) => countries.includes(byId.get(d.cityId)?.countryId ?? ""));
    if (row.order === "travel-time") ranked = [...ranked].sort((a, b) => a.travelMinutes - b.travelMinutes);
    return { row, destinations: ranked.slice(0, row.limit) };
  });
}
