/**
 * Filters shared by Explore and the planner's Places pane: theme, distance
 * from home, region and country, a name filter, and (in Explore) travel
 * dates. Each screen keeps its own filters on this device.
 */
import {
  addDays,
  haversineKm,
  normalizeName,
  regionLabel,
  regionOf,
  REGIONS,
  type HomeCity,
  type IsoDate,
  type RegionId,
  type Theme,
} from "@itinera/core";
import { useCallback, useState } from "react";
import { ALL_THEMES, distanceText, THEME_LABELS, today } from "./ui";

export interface Filters {
  theme: Theme | null;
  /** Straight-line distance from home; null = any. */
  maxKm: number | null;
  region: RegionId | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  query: string;
  /** Travel dates; when set, Explore ranks by the typical weather on them. */
  start: IsoDate | null;
  end: IsoDate | null;
}

export const NO_FILTERS: Filters = {
  theme: null,
  maxKm: null,
  region: null,
  country: null,
  query: "",
  start: null,
  end: null,
};

/** Slider stops for distance from home; the last stop means any distance. */
export const DISTANCE_STOPS = [250, 500, 1000, 2000, 4000, 8000] as const;

export function useFilters(
  storageKey: string,
  initial?: Partial<Filters>,
): [Filters, (patch: Partial<Filters>) => void, () => void] {
  const [filters, setFilters] = useState<Filters>(() => {
    let saved: Partial<Filters> = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Filters>;
    } catch {
      // Storage can be unavailable; start without saved filters.
    }
    const f = { ...NO_FILTERS, ...saved, ...initial };
    // Dates in the past are no use for planning.
    if (f.start && f.start < today()) Object.assign(f, { start: null, end: null });
    return f;
  });
  const save = (f: Filters) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(f));
    } catch {
      // Not saved; the filters still apply for this visit.
    }
  };
  const set = useCallback(
    (patch: Partial<Filters>) =>
      setFilters((f) => {
        const next = { ...f, ...patch };
        save(next);
        return next;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );
  const clear = useCallback(() => {
    setFilters(NO_FILTERS);
    save(NO_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  return [filters, set, clear];
}

/** How many filters narrow the results (dates rank rather than narrow, so they don't count). */
export function activeCount(f: Filters): number {
  return [f.theme, f.maxKm, f.region ?? f.country, f.query.trim() || null].filter((v) => v !== null).length;
}

export interface Filterable {
  name: string;
  countryCode: string;
  lat: number;
  lon: number;
}

/** Location filters only: region, country, distance and name. Themes are matched by each screen. */
export function matchesLocation(
  c: Filterable,
  f: Filters,
  home: HomeCity | null,
  countryName: (code: string) => string,
): boolean {
  if (f.country && c.countryCode !== f.country) return false;
  if (!f.country && f.region && regionOf(c.countryCode) !== f.region) return false;
  if (f.maxKm !== null && home && haversineKm(home, c) > f.maxKm) return false;
  const q = normalizeName(f.query);
  if (q && !normalizeName(c.name).includes(q) && !normalizeName(countryName(c.countryCode)).includes(q)) return false;
  return true;
}

export const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function FilterBar({
  filters: f,
  set,
  clear,
  countries,
  home,
  dates = false,
  query = true,
  queryLabel = "Filter by name or country",
  compact = false,
}: {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  clear: () => void;
  /** Country codes that have something to show, for the region and country lists. */
  countries: readonly string[];
  home: HomeCity | null;
  dates?: boolean;
  query?: boolean;
  queryLabel?: string;
  compact?: boolean;
}) {
  const counts = new Map<string, number>();
  for (const c of countries) counts.set(c, (counts.get(c) ?? 0) + 1);
  const regions = REGIONS.filter((r) => countries.some((c) => regionOf(c) === r.id));
  const inRegion = [...counts.keys()]
    .filter((c) => !f.region || regionOf(c) === f.region)
    .sort((a, b) => countryName(a).localeCompare(countryName(b)));
  const stop =
    f.maxKm === null
      ? DISTANCE_STOPS.length
      : Math.max(
          0,
          DISTANCE_STOPS.findIndex((s) => s >= f.maxKm!),
        );
  const n = activeCount(f) + (f.start ? 1 : 0);
  const locationSet = f.region !== null || f.country !== null || f.maxKm !== null;
  // In a narrow pane, region and distance fold away until asked for (or in use).
  const [more, setMore] = useState(false);
  const showLocation = !compact || more || locationSet;

  return (
    <div className={`filters${compact ? " filters--compact" : ""}`}>
      <div className="chips chips--scroll" role="radiogroup" aria-label="Theme">
        <button role="radio" aria-checked={f.theme === null} className="chip-btn" onClick={() => set({ theme: null })}>
          All
        </button>
        {ALL_THEMES.map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={f.theme === t}
            className={`chip-btn chip-btn--${t}`}
            onClick={() => set({ theme: f.theme === t ? null : t })}
          >
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="filters__row">
        {query && (
          <input
            type="search"
            className="filters__query"
            placeholder={queryLabel}
            aria-label={queryLabel}
            value={f.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        )}

        {compact && (
          <button
            className="link filters__more"
            aria-expanded={showLocation}
            onClick={() => setMore(!showLocation)}
            disabled={locationSet}
          >
            {showLocation ? "Fewer filters" : "Region & distance"}
          </button>
        )}

        {showLocation && (
          <>
            <select
              aria-label="Region"
              value={f.region ?? ""}
              onChange={(e) =>
                set({
                  region: (e.target.value || null) as RegionId | null,
                  country: null,
                })
              }
            >
              <option value="">Anywhere</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>

            {inRegion.length > 1 && (
              <select aria-label="Country" value={f.country ?? ""} onChange={(e) => set({ country: e.target.value || null })}>
                <option value="">{f.region ? `All of ${regionLabel(f.region)}` : "All countries"}</option>
                {inRegion.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)} ({counts.get(c)})
                  </option>
                ))}
              </select>
            )}

            <label
              className={`range${home ? "" : " is-disabled"}`}
              title={home ? undefined : "Set your home city to filter by distance"}
            >
              <span className="range__label">
                {f.maxKm === null || !home ? "Any distance" : `Within ${distanceText(f.maxKm)}`}
              </span>
              <input
                type="range"
                min={0}
                max={DISTANCE_STOPS.length}
                step={1}
                value={stop}
                disabled={!home}
                aria-label="Distance from home"
                aria-valuetext={f.maxKm === null ? "Any distance" : `Within ${f.maxKm} km`}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  set({
                    maxKm: i >= DISTANCE_STOPS.length ? null : DISTANCE_STOPS[i]!,
                  });
                }}
              />
            </label>
          </>
        )}

        {dates && (
          <div className="dates" role="group" aria-label="Travel dates">
            <input
              type="date"
              aria-label="From"
              value={f.start ?? ""}
              min={today()}
              onChange={(e) => {
                const start = e.target.value || null;
                set({
                  start,
                  end: start && (!f.end || f.end < start) ? addDays(start, 4) : f.end,
                });
              }}
            />
            <span aria-hidden>–</span>
            <input
              type="date"
              aria-label="To"
              value={f.end ?? ""}
              min={f.start ?? today()}
              onChange={(e) =>
                set({
                  end: e.target.value || null,
                  start: f.start ?? (e.target.value || null),
                })
              }
            />
            {f.start && (
              <button className="icon" aria-label="Clear dates" onClick={() => set({ start: null, end: null })}>
                ×
              </button>
            )}
          </div>
        )}

        {n > 0 && (
          <button className="link filters__clear" onClick={clear}>
            Clear {n === 1 ? "filter" : `${n} filters`}
          </button>
        )}
      </div>
    </div>
  );
}
