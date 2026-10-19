/**
 * Distance and travel-time estimates. These are deliberate, documented
 * approximations used until real routing (OSRM/Valhalla) is wired in; they are
 * deterministic so the constraint checker gives stable answers offline.
 */
import type { BBox, TransportMode } from "./schemas.js";

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TravelEstimate {
  mode: TransportMode;
  minutes: number;
  km: number;
}

/** Tunables for in-city travel. Street networks are ~30% longer than straight lines. */
export const IN_CITY = {
  detourFactor: 1.3,
  walkKmh: 4.5,
  /** Straight-line distance above which we assume public transport or a taxi. */
  maxWalkKm: 1.8,
  transitKmh: 18,
  transitOverheadMin: 10,
} as const;

const roundUp5 = (m: number) => Math.max(5, Math.ceil(m / 5) * 5);

/** Travel between two points in the same city. */
export function estimateInCityTravel(a: LatLon, b: LatLon): TravelEstimate {
  const km = haversineKm(a, b);
  if (km < 0.05) return { mode: "walk", minutes: 0, km };
  const roadKm = km * IN_CITY.detourFactor;
  if (km <= IN_CITY.maxWalkKm) {
    return { mode: "walk", minutes: roundUp5((roadKm / IN_CITY.walkKmh) * 60), km };
  }
  return {
    mode: "transit",
    minutes: roundUp5(IN_CITY.transitOverheadMin + (roadKm / IN_CITY.transitKmh) * 60),
    km,
  };
}

/**
 * Travel between cities when no route edge is known: road for short hops,
 * rail/road for medium, flight (with airport overhead) for long.
 */
export function estimateInterCityTravel(a: LatLon, b: LatLon): TravelEstimate {
  const km = haversineKm(a, b);
  if (km <= 150) return { mode: "road", minutes: roundUp5(((km * 1.25) / 60) * 60 + 15), km };
  if (km <= 650) return { mode: "rail", minutes: roundUp5(((km * 1.2) / 90) * 60 + 30), km };
  return { mode: "flight", minutes: roundUp5((km / 750) * 60 + 180), km };
}

export function bboxCenter([w, s, e, n]: BBox): LatLon {
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}

export function bboxContains([w, s, e, n]: BBox, p: LatLon): boolean {
  return p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
}
