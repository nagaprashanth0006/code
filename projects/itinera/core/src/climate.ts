/**
 * Typical weather from ~20 years of daily history. For each day of the year we
 * pool that calendar day ± a window across all years, then take percentiles.
 * Output is "typical", never a forecast.
 */
import { dateRange, dayOfYear366, type IsoDate } from "./dates.js";
import type { ClimateNormal } from "./schemas.js";
import { mean, percentile, round1 } from "./stats.js";

export interface DailyHistory {
  time: readonly IsoDate[];
  tmin: ReadonlyArray<number | null>;
  tmax: ReadonlyArray<number | null>;
  precip: ReadonlyArray<number | null>;
}

/** A day counts as rainy at or above this much precipitation. */
export const RAIN_DAY_MM = 1;

export function computeClimateNormals(cityId: string, history: DailyHistory, halfWindow = 7): ClimateNormal[] {
  const byDoy: Array<{ tmin: number[]; tmax: number[]; precip: number[] }> = Array.from({ length: 367 }, () => ({
    tmin: [],
    tmax: [],
    precip: [],
  }));
  history.time.forEach((date, i) => {
    const bucket = byDoy[dayOfYear366(date)]!;
    const tmin = history.tmin[i];
    const tmax = history.tmax[i];
    const precip = history.precip[i];
    if (tmin != null) bucket.tmin.push(tmin);
    if (tmax != null) bucket.tmax.push(tmax);
    if (precip != null) bucket.precip.push(precip);
  });

  const normals: ClimateNormal[] = [];
  for (let doy = 1; doy <= 366; doy++) {
    const tmin: number[] = [];
    const tmax: number[] = [];
    const precip: number[] = [];
    for (let k = -halfWindow; k <= halfWindow; k++) {
      const d = ((doy - 1 + k + 366) % 366) + 1;
      const b = byDoy[d]!;
      tmin.push(...b.tmin);
      tmax.push(...b.tmax);
      precip.push(...b.precip);
    }
    if (tmin.length === 0 || tmax.length === 0 || precip.length === 0) continue;
    normals.push({
      cityId,
      dayOfYear: doy,
      tminP10: round1(percentile(tmin, 10)),
      tminP50: round1(percentile(tmin, 50)),
      tminP90: round1(percentile(tmin, 90)),
      tmaxP10: round1(percentile(tmax, 10)),
      tmaxP50: round1(percentile(tmax, 50)),
      tmaxP90: round1(percentile(tmax, 90)),
      rainProb: Math.round((precip.filter((p) => p >= RAIN_DAY_MM).length / precip.length) * 1000) / 1000,
      precipMm: round1(mean(precip)),
    });
  }
  return normals;
}

export interface WeatherSummary {
  days: number;
  /** Typical (median) daily low and high, averaged over the period. */
  lowC: number;
  highC: number;
  /** Cold and warm extremes to expect: p10 of lows, p90 of highs. */
  coldC: number;
  warmC: number;
  /** Expected number of rainy days in the period. */
  rainDays: number;
  /** Expected total precipitation over the period. */
  precipMm: number;
}

function summarize(normals: readonly ClimateNormal[]): WeatherSummary | null {
  if (normals.length === 0) return null;
  return {
    days: normals.length,
    lowC: round1(mean(normals.map((n) => n.tminP50))),
    highC: round1(mean(normals.map((n) => n.tmaxP50))),
    coldC: round1(Math.min(...normals.map((n) => n.tminP10))),
    warmC: round1(Math.max(...normals.map((n) => n.tmaxP90))),
    rainDays: round1(normals.reduce((a, n) => a + n.rainProb, 0)),
    precipMm: round1(normals.reduce((a, n) => a + n.precipMm, 0)),
  };
}

/** Typical weather for a date range (e.g. a leg's dates). */
export function summarizeWeather(
  normals: readonly ClimateNormal[],
  start: IsoDate,
  end: IsoDate,
): WeatherSummary | null {
  const byDoy = new Map(normals.map((n) => [n.dayOfYear, n]));
  const picked = dateRange(start, end)
    .map((d) => byDoy.get(dayOfYear366(d)))
    .filter((n): n is ClimateNormal => n !== undefined);
  return summarize(picked);
}

/** Typical weather for a calendar month (1–12), per-month totals. */
export function monthClimate(normals: readonly ClimateNormal[], month: number): WeatherSummary | null {
  const starts = [1, 32, 61, 92, 122, 153, 183, 214, 245, 275, 306, 336, 367];
  const from = starts[month - 1]!;
  const to = starts[month]! - 1;
  // Skip Feb 29 so month totals reflect a common year.
  return summarize(normals.filter((n) => n.dayOfYear >= from && n.dayOfYear <= to && n.dayOfYear !== 60));
}
