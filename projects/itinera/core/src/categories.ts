/**
 * Per-category defaults: how long a visit usually takes, which themes a place
 * of that kind supports, and a display label.
 */
import type { PlaceCategory, Theme } from "./schemas.js";

export interface CategoryInfo {
  label: string;
  visitMinutes: number;
  themes: Theme[];
}

export const CATEGORY_INFO: Record<PlaceCategory, CategoryInfo> = {
  museum: { label: "Museum", visitMinutes: 120, themes: ["culture", "historical", "solo"] },
  gallery: { label: "Gallery", visitMinutes: 75, themes: ["culture", "solo"] },
  monument: { label: "Monument", visitMinutes: 45, themes: ["historical"] },
  castle: { label: "Castle / fort", visitMinutes: 90, themes: ["historical", "adventure"] },
  palace: { label: "Palace", visitMinutes: 90, themes: ["historical", "romantic", "culture"] },
  religious: { label: "Church / temple", visitMinutes: 45, themes: ["historical", "culture"] },
  viewpoint: { label: "Viewpoint", visitMinutes: 30, themes: ["romantic", "nature", "solo"] },
  park: { label: "Park", visitMinutes: 60, themes: ["nature", "romantic"] },
  garden: { label: "Garden", visitMinutes: 60, themes: ["nature", "romantic"] },
  attraction: { label: "Attraction", visitMinutes: 60, themes: ["culture"] },
  zoo: { label: "Zoo / aquarium", visitMinutes: 150, themes: ["nature"] },
  theatre: { label: "Theatre / venue", visitMinutes: 120, themes: ["culture", "romantic"] },
  square: { label: "Square / street", visitMinutes: 30, themes: ["culture", "solo"] },
  waterfall: { label: "Waterfall", visitMinutes: 60, themes: ["nature", "romantic", "adventure"] },
  lake: { label: "Lake / dam", visitMinutes: 60, themes: ["nature", "romantic"] },
  nature_reserve: { label: "National park / sanctuary", visitMinutes: 180, themes: ["nature", "adventure"] },
  peak: { label: "Peak / hill", visitMinutes: 180, themes: ["adventure", "nature"] },
  beach: { label: "Beach", visitMinutes: 120, themes: ["nature", "romantic"] },
  other: { label: "Other", visitMinutes: 45, themes: [] },
};

export function defaultVisitMinutes(category: PlaceCategory): number {
  return CATEGORY_INFO[category].visitMinutes;
}

export const THEME_LABELS: Record<Theme, string> = {
  romantic: "Romantic",
  solo: "Solo",
  adventure: "Adventure",
  nature: "Nature / Scenic",
  historical: "Historical",
  culture: "Culture",
};

/**
 * City theme tags derived from its places: a theme is tagged when places
 * supporting it make up at least `minShare` of the rank-weighted catalog.
 */
export function deriveCityThemes(
  places: ReadonlyArray<{ themeTags: readonly Theme[]; rank: number }>,
  minShare = 0.2,
): Theme[] {
  const totals = new Map<Theme, number>();
  let all = 0;
  for (const p of places) {
    const w = Math.max(p.rank, 0.1);
    all += w;
    for (const t of p.themeTags) totals.set(t, (totals.get(t) ?? 0) + w);
  }
  if (all === 0) return [];
  return [...totals.entries()]
    .filter(([, w]) => w / all >= minShare)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}
