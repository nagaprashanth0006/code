/**
 * Multi-city planning: a city order that avoids zig-zagging, nights per leg,
 * and transfer estimates between legs.
 */
import { estimateInterCityTravel, haversineKm, type LatLon } from "./geo.js";
import type { TransferEstimator, TripTree } from "./itinerary.js";
import type { RouteEdge, TransportMode } from "./schemas.js";

export interface CityPoint extends LatLon {
  id: string;
}

function pathKm(origin: LatLon | null, order: readonly CityPoint[], returnToOrigin: boolean): number {
  let km = 0;
  let prev: LatLon | null = origin;
  for (const c of order) {
    if (prev) km += haversineKm(prev, c);
    prev = c;
  }
  if (returnToOrigin && origin && prev) km += haversineKm(prev, origin);
  return km;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) out.push([item, ...rest]);
  });
  return out;
}

/**
 * Orders cities to minimise total straight-line distance from the origin
 * (and back, for a round trip). Exact for up to 8 cities; nearest neighbour
 * plus 2-opt beyond that.
 */
export function orderCities(
  origin: LatLon | null,
  cities: readonly CityPoint[],
  options: { returnToOrigin?: boolean } = {},
): { order: CityPoint[]; km: number } {
  const round = options.returnToOrigin ?? true;
  if (cities.length <= 1) return { order: [...cities], km: pathKm(origin, cities, round) };
  if (cities.length <= 8) {
    let best: CityPoint[] = [...cities];
    let bestKm = Infinity;
    for (const p of permutations(cities)) {
      const km = pathKm(origin, p, round);
      if (km < bestKm - 1e-9) {
        best = p;
        bestKm = km;
      }
    }
    return { order: best, km: bestKm };
  }
  // Nearest neighbour from the origin (or the first city).
  const left = [...cities];
  const order: CityPoint[] = [];
  let at: LatLon = origin ?? left[0]!;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (haversineKm(at, left[i]!) < haversineKm(at, left[bi]!)) bi = i;
    at = left[bi]!;
    order.push(left.splice(bi, 1)[0]!);
  }
  // 2-opt until no improving reversal remains.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (pathKm(origin, candidate, round) < pathKm(origin, order, round) - 1e-9) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return { order, km: pathKm(origin, order, round) };
}

export interface LegDemand {
  cityId: string;
  /** Key for the result when a city appears in more than one leg (default: cityId). */
  key?: string;
  /** Saved places for this city (wishlist or already planned). */
  savedPlaces: number;
  /** Total planned visit minutes, if known; otherwise estimated from savedPlaces. */
  visitMinutes?: number;
  isStopover?: boolean;
}

export const MIN_NIGHTS = 2;
export const STOPOVER_NIGHTS = 1;
/** Sightseeing minutes in a full day, and the average visit with travel. */
const DAY_MINUTES = 7 * 60;
const AVG_VISIT_MINUTES = 100;

export interface NightsAllocation {
  nights: Map<string, number>;
  warning: string | null;
}

/**
 * Nights per leg: every leg gets its minimum (two nights, one for a stopover),
 * and remaining nights go to legs in proportion to the days their saved places
 * need beyond that minimum (largest remainder, so the total is exact).
 */
export function allocateNights(legs: readonly LegDemand[], totalNights: number): NightsAllocation {
  const nights = new Map<string, number>();
  const minimum = (l: LegDemand) => (l.isStopover ? STOPOVER_NIGHTS : MIN_NIGHTS);
  const key = (l: LegDemand) => l.key ?? l.cityId;
  const required = legs.reduce((a, l) => a + minimum(l), 0);
  for (const l of legs) nights.set(key(l), minimum(l));
  if (totalNights < required) {
    return { nights, warning: `These ${legs.length} stops need at least ${required} nights; the trip has ${totalNights}.` };
  }
  const extra = totalNights - required;
  const flexible = legs.filter((l) => !l.isStopover);
  if (extra === 0 || flexible.length === 0) {
    return { nights, warning: extra > 0 ? `${extra} night(s) left unallocated.` : null };
  }
  const need = flexible.map((l) => {
    const days = (l.visitMinutes ?? l.savedPlaces * AVG_VISIT_MINUTES) / DAY_MINUTES;
    return Math.max(days - minimum(l), 0);
  });
  const totalNeed = need.reduce((a, b) => a + b, 0);
  const weights = totalNeed > 0 ? need.map((n) => n / totalNeed) : flexible.map(() => 1 / flexible.length);
  const shares = weights.map((w) => w * extra);
  const floors = shares.map(Math.floor);
  let remaining = extra - floors.reduce((a, b) => a + b, 0);
  const byRemainder = shares.map((s, i) => [s - Math.floor(s), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of byRemainder) {
    if (remaining <= 0) break;
    floors[i]!++;
    remaining--;
  }
  flexible.forEach((l, i) => nights.set(key(l), minimum(l) + floors[i]!));
  return { nights, warning: null };
}

export interface TransferEstimate {
  fromCityId: string;
  toCityId: string;
  mode: TransportMode;
  minutes: number;
  estimated: boolean;
}

/** Transfers between consecutive legs, from known routes or a distance estimate. */
export function planTransfers(ordered: readonly CityPoint[], routes: readonly RouteEdge[]): TransferEstimate[] {
  const out: TransferEstimate[] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    const edges = routes.filter(
      (r) => (r.fromCityId === a.id && r.toCityId === b.id) || (r.fromCityId === b.id && r.toCityId === a.id),
    );
    if (edges.length > 0) {
      const best = edges.reduce((x, y) => (y.typicalMinutes < x.typicalMinutes ? y : x));
      out.push({ fromCityId: a.id, toCityId: b.id, mode: best.mode, minutes: best.typicalMinutes, estimated: false });
    } else {
      const est = estimateInterCityTravel(a, b);
      out.push({ fromCityId: a.id, toCityId: b.id, mode: est.mode, minutes: est.minutes, estimated: true });
    }
  }
  return out;
}

/** A `TransferEstimator` over known city positions and routes, for the itinerary's leg edits. */
export function transferEstimator(cities: readonly CityPoint[], routes: readonly RouteEdge[] = []): TransferEstimator {
  const byId = new Map(cities.map((c) => [c.id, c]));
  return (fromCityId, toCityId) => {
    const a = byId.get(fromCityId);
    const b = byId.get(toCityId);
    if (!a || !b) throw new Error(`Unknown city ${a ? toCityId : fromCityId}`);
    const [t] = planTransfers([a, b], routes);
    return { mode: t!.mode, minutes: t!.minutes };
  };
}

/**
 * A leg order that avoids zig-zagging (see `orderCities`): from `origin` and
 * back when given, otherwise an open path. Returns leg ids; legs whose city
 * has no known position keep their place at the end.
 */
export function suggestLegOrder(
  tree: TripTree,
  positions: ReadonlyMap<string, LatLon>,
  origin: LatLon | null,
): string[] {
  const known: CityPoint[] = [];
  const unknown: string[] = [];
  for (const { leg } of tree.legs) {
    const p = positions.get(leg.cityId);
    if (p) known.push({ id: leg.id, lat: p.lat, lon: p.lon });
    else unknown.push(leg.id);
  }
  const { order } = orderCities(origin, known, { returnToOrigin: origin !== null });
  return [...order.map((c) => c.id), ...unknown];
}

/**
 * Nights per leg for a trip of `total` nights: `allocateNights` keyed by leg,
 * with each leg's demand taken from how many places are saved or planned there.
 */
export function allocateTripNights(
  tree: TripTree,
  total: number,
  savedPlaces: (legId: string, cityId: string) => number,
): NightsAllocation {
  return allocateNights(
    tree.legs.map(({ leg }) => ({
      cityId: leg.cityId,
      key: leg.id,
      savedPlaces: savedPlaces(leg.id, leg.cityId),
      isStopover: leg.isStopover,
    })),
    total,
  );
}
