/**
 * Landing data shared by the hub and the destination page: candidates (the
 * curated index merged with fetched cities), the scoring context, and rows.
 */
import {
  buildLanding,
  climateFor,
  homeAnchor,
  landingCandidates,
  monthlyClimateById,
  rankDestinations,
  type ClimateNormal,
  type DestinationScore,
  type LandingCandidate,
  type LandingRowResult,
  type ScoringContext,
  type WeatherSummary,
} from "@itinera/core";
import { useMemo } from "react";
import { useStore } from "../state/store";
import { today } from "./ui";

export interface Landing {
  candidates: LandingCandidate[];
  byId: Map<string, LandingCandidate>;
  ctx: ScoringContext | null;
  rows: LandingRowResult[];
  /** Best month in the window for one candidate across all themes. */
  bestFor(id: string): DestinationScore | null;
  climate(id: string, month: number): WeatherSummary | null;
}

export function useLanding(): Landing {
  const { destinations, cities, countries, normals, home, landingConfig } = useStore();

  return useMemo(() => {
    const candidates = landingCandidates(destinations, cities, countries);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    // Daily normals are keyed by city; scoring looks them up by candidate id.
    const normalsByCandidate = new Map<string, ClimateNormal[]>();
    for (const c of candidates) if (c.cityId) normalsByCandidate.set(c.id, normals.get(c.cityId) ?? []);
    const ctx: ScoringContext | null = home
      ? {
          home: homeAnchor(home, candidates),
          normalsByCity: normalsByCandidate,
          monthlyClimate: monthlyClimateById(candidates),
          routes: [],
        }
      : null;
    const rows = ctx ? buildLanding(landingConfig, candidates, today(), ctx) : [];
    const climateCtx = ctx ?? {
      home: { id: "", lat: 0, lon: 0 },
      normalsByCity: normalsByCandidate,
      monthlyClimate: monthlyClimateById(candidates),
      routes: [],
    };
    return {
      candidates,
      byId,
      ctx,
      rows,
      bestFor(id) {
        const c = byId.get(id);
        if (!c || !ctx) return null;
        return rankDestinations([c], null, today(), { ...ctx, home: { ...ctx.home, id: "" } }, landingConfig.windowMonths)[0] ?? null;
      },
      climate: (id, month) => climateFor(climateCtx, id, month),
    };
  }, [destinations, cities, countries, normals, home, landingConfig]);
}

/** Public URL of a destination photo shipped with the app. */
export const destinationPhoto = (c: LandingCandidate | undefined | null) =>
  c?.destination?.photo ? `/${c.destination.photo.path}` : null;
