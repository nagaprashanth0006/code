/**
 * Prices as historical ranges with provenance, never a single live price.
 * Month-specific p10–p90 when a month has enough observations, otherwise the
 * annual band × a seasonal multiplier. Fare-model estimates are labelled.
 */
import { monthOf, type IsoDate } from "./dates.js";
import type { PriceBand, PriceKind, PriceObservation } from "./schemas.js";
import { percentile } from "./stats.js";

/**
 * Minimum observations in a month before showing a month-specific band.
 * Open question in the PRD (to be settled in P1.2); 8 keeps p10/p90 from being
 * just the min and max of a handful of points.
 */
export const DEFAULT_MIN_MONTH_OBSERVATIONS = 8;

/**
 * Default seasonal multipliers (Jan…Dec) for the annual-band fallback, a
 * northern-hemisphere leisure pattern: summer and December peaks. Replace with
 * per-city multipliers once a city has observations across the year.
 */
export const DEFAULT_SEASONAL_MULTIPLIERS: Record<PriceKind, readonly number[]> = {
  stay: [0.85, 0.85, 0.95, 1.0, 1.05, 1.15, 1.3, 1.3, 1.1, 1.0, 0.9, 1.1],
  flight: [0.9, 0.85, 0.95, 1.0, 1.0, 1.15, 1.3, 1.25, 1.0, 0.95, 0.9, 1.2],
};

function band(kind: PriceKind, key: string, month: number, obs: readonly PriceObservation[]): PriceBand {
  const prices = obs.map((o) => o.price);
  const dates = obs.map((o) => o.observedAt.slice(0, 10)).sort();
  return {
    kind,
    key,
    month,
    p10: percentile(prices, 10),
    p50: percentile(prices, 50),
    p90: percentile(prices, 90),
    n: obs.length,
    spanStart: dates[0]!,
    spanEnd: dates[dates.length - 1]!,
    currency: obs[0]!.currency,
  };
}

/**
 * Bands for every (kind, key): one annual band (month 0) plus a band for each
 * travel month with enough observations. Observations in other currencies than
 * the key's first one are skipped; conversion is out of scope here.
 */
export function computePriceBands(
  observations: readonly PriceObservation[],
  minMonthObservations = DEFAULT_MIN_MONTH_OBSERVATIONS,
): PriceBand[] {
  const groups = new Map<string, PriceObservation[]>();
  for (const o of observations) {
    const k = `${o.kind}|${o.key}`;
    const list = groups.get(k) ?? [];
    list.push(o);
    groups.set(k, list);
  }
  const bands: PriceBand[] = [];
  for (const list of groups.values()) {
    const currency = list[0]!.currency;
    const same = list.filter((o) => o.currency === currency);
    const { kind, key } = same[0]!;
    bands.push(band(kind, key, 0, same));
    for (let m = 1; m <= 12; m++) {
      const inMonth = same.filter((o) => monthOf(o.travelDate) === m);
      if (inMonth.length >= minMonthObservations) bands.push(band(kind, key, m, inMonth));
    }
  }
  return bands;
}

export type PriceBasis = "month" | "annual-seasonal" | "estimate";

export interface PriceRange {
  low: number;
  mid: number;
  high: number;
  currency: string;
  basis: PriceBasis;
  n: number;
  spanStart: IsoDate | null;
  spanEnd: IsoDate | null;
  source: string;
}

/** The range to show for a travel month, choosing the best available basis. */
export function priceRangeFor(
  bands: readonly PriceBand[],
  kind: PriceKind,
  key: string,
  month: number,
  multipliers: readonly number[] = DEFAULT_SEASONAL_MULTIPLIERS[kind],
): PriceRange | null {
  const forKey = bands.filter((b) => b.kind === kind && b.key === key);
  const monthBand = forKey.find((b) => b.month === month);
  const source = "observations";
  if (monthBand) {
    return { low: monthBand.p10, mid: monthBand.p50, high: monthBand.p90, currency: monthBand.currency, basis: "month", n: monthBand.n, spanStart: monthBand.spanStart, spanEnd: monthBand.spanEnd, source };
  }
  const annual = forKey.find((b) => b.month === 0);
  if (!annual) return null;
  const k = multipliers[month - 1] ?? 1;
  return { low: annual.p10 * k, mid: annual.p50 * k, high: annual.p90 * k, currency: annual.currency, basis: "annual-seasonal", n: annual.n, spanStart: annual.spanStart, spanEnd: annual.spanEnd, source };
}

/**
 * Fare estimate when no observations exist: a calibrated distance-and-season
 * model. Coefficients are placeholders in USD until calibrated against logged
 * fares; the result is always labelled an estimate.
 */
export function estimateFlightFare(distanceKm: number, month: number): PriceRange {
  const base = 40 + 0.09 * distanceKm;
  const k = DEFAULT_SEASONAL_MULTIPLIERS.flight[month - 1] ?? 1;
  return {
    low: Math.round(base * 0.7 * k),
    mid: Math.round(base * k),
    high: Math.round(base * 1.6 * k),
    currency: "USD",
    basis: "estimate",
    n: 0,
    spanStart: null,
    spanEnd: null,
    source: "distance-and-season fare model",
  };
}

const monthYear = (iso: IsoDate) =>
  new Date(`${iso}T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function money(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

/** e.g. "₹4,200–7,800 · 14 observations · Jan 2025–Sep 2026". */
export function formatPriceRange(range: PriceRange, locale = "en-IN"): string {
  const low = money(range.low, range.currency, locale);
  const high = money(range.high, range.currency, locale).replace(/^[^\d]+/, "");
  const parts = [`${low}–${high}`];
  if (range.basis === "estimate") {
    parts.push(`estimate (${range.source})`);
  } else {
    parts.push(`${range.n} observation${range.n === 1 ? "" : "s"}`);
    if (range.spanStart && range.spanEnd) {
      const a = monthYear(range.spanStart);
      const b = monthYear(range.spanEnd);
      parts.push(a === b ? a : `${a}–${b}`);
    }
    if (range.basis === "annual-seasonal") parts.push("seasonally adjusted");
  }
  return parts.join(" · ");
}

// ------------------------------------------------------------- deep links

/** "Check prices" for flights; the external site does the live search. */
export function flightSearchUrl(from: string, to: string, depart: IsoDate, returnDate?: IsoDate | null): string {
  const q = `Flights from ${from} to ${to} on ${depart}${returnDate ? ` returning ${returnDate}` : ""}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

export function hotelSearchUrl(city: string, checkin: IsoDate, checkout: IsoDate, adults = 2): string {
  const p = new URLSearchParams({ ss: city, checkin, checkout, group_adults: String(adults), no_rooms: "1" });
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
}
