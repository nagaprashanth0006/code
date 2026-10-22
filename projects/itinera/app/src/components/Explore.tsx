/**
 * Explore: every destination, narrowed by theme, distance, region and name,
 * ranked either at each one's best month in the window or, with dates set,
 * by the typical weather on those dates. The list and the map sit side by
 * side on wide screens; phones switch between them.
 */
import { monthWindow, rankDestinations, rankForDates, type DestinationScore } from "@itinera/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { ExploreMap, type MapItem } from "./ExploreMap";
import { countryName, FilterBar, matchesLocation, useFilters, type Filters } from "./filters";
import { shortDate } from "./hooks";
import { DestinationCard, TopBar, type HubNav } from "./Hub";
import { useLanding } from "./landing";
import { distanceText, monthName, THEME_LABELS, today, weatherWord } from "./ui";

type Sort = "score" | "travel" | "name";

export function Explore({ nav, onBack, initial }: { nav: HubNav; onBack: () => void; initial?: Partial<Filters> }) {
  const { home, landingConfig } = useStore();
  const landing = useLanding();
  const [f, set, clear] = useFilters("itinera.explore", initial);
  const [sort, setSort] = useState<Sort>("score");
  const [view, setView] = useState<"list" | "map">("list");
  const [hovered, setHovered] = useState<string | null>(null);
  const dated = !!(f.start && f.end);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // The map sticks just under the filter bar, whose height changes as it wraps.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(() => rootRef.current?.style.setProperty("--bar-h", `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  const filtered = useMemo(
    () => landing.candidates.filter((c) => (!f.theme || c.themeTags.includes(f.theme)) && matchesLocation(c, f, home, countryName)),
    [landing.candidates, f, home],
  );

  const ranked = useMemo(() => {
    if (!landing.ctx) return [];
    // The home city itself can be a destination here (a weekend at home is still a trip).
    const ctx = { ...landing.ctx, home: { ...landing.ctx.home, id: "" } };
    const scores: DestinationScore[] =
      f.start && f.end
        ? rankForDates(filtered, f.theme, f.start, f.end, ctx)
        : rankDestinations(filtered, f.theme, today(), ctx, landingConfig.windowMonths);
    if (sort === "travel") return [...scores].sort((a, b) => a.travelMinutes - b.travelMinutes);
    if (sort === "name") {
      const name = (s: DestinationScore) => landing.byId.get(s.destinationId)?.name ?? "";
      return [...scores].sort((a, b) => name(a).localeCompare(name(b)));
    }
    return scores;
  }, [filtered, f.theme, f.start, f.end, landing, landingConfig.windowMonths, sort]);

  const mapItems = useMemo<MapItem[]>(
    () =>
      ranked.flatMap((s) => {
        const c = landing.byId.get(s.destinationId);
        if (!c) return [];
        const when = dated ? weatherWord(s.factors.seasonFit) : `Best in ${monthName(s.month, "short")}`;
        return [{ id: c.id, name: c.name, lat: c.lat, lon: c.lon, ready: !!c.cityId, detail: `${when} · ${distanceText(s.distanceKm)} away` }];
      }),
    [ranked, landing.byId, dated],
  );

  const window = monthWindow(today(), landingConfig.windowMonths);
  const open = (id: string) => nav.openDestination(id, dated ? { start: f.start!, end: f.end! } : undefined);

  return (
    <div ref={rootRef} className="hub explore" data-mood={f.theme ?? undefined}>
      <TopBar onBack={onBack} title="Explore" />
      <div ref={barRef} className="explore__bar">
        <div className="explore__bar-inner">
          <FilterBar
            filters={f}
            set={set}
            clear={clear}
            countries={landing.candidates.map((c) => c.countryCode)}
            home={home}
            dates
          />
          <div className="explore__tools">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="score">{dated ? "Best for your dates" : "Best match"}</option>
              <option value="travel">Closest first</option>
              <option value="name">A–Z</option>
            </select>
            <div className="segmented segmented--inline explore__view" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")}>
                List
              </button>
              <button role="tab" aria-selected={view === "map"} onClick={() => setView("map")}>
                Map
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="explore__body" data-view={view}>
        <main className="explore__list">
          {!home ? (
            <p className="muted">Set your home city (top right) to rank destinations by travel time and distance.</p>
          ) : (
            <p className="muted small explore__summary">
              <strong>{ranked.length}</strong> destination{ranked.length === 1 ? "" : "s"}
              {f.theme ? ` for ${THEME_LABELS[f.theme].toLowerCase()} trips` : ""}
              {dated
                ? `, ranked by typical weather for ${shortDate(f.start!)} – ${shortDate(f.end!)}.`
                : `, each at its best month from ${monthName(window[0]!.month)} to ${monthName(window[window.length - 1]!.month)}.`}{" "}
              <span
                className="info"
                tabIndex={0}
                data-tip="Typical weather, not a forecast: 20 years of daily history. A rainy day is one with at least 1 mm of rain; the count is how many to expect in that month, or on your dates."
                aria-label="How weather is worked out"
              >
                ⓘ
              </span>
            </p>
          )}
          {home && ranked.length === 0 && (
            <div className="empty-state">
              <p>Nothing matches these filters.</p>
              <button onClick={clear}>Clear filters</button>
            </div>
          )}
          <ul className="grid">
            {ranked.map((d) => (
              <DestinationCard
                key={d.destinationId}
                score={d}
                landing={landing}
                dated={dated}
                highlighted={hovered === d.destinationId}
                onHover={setHovered}
                onOpen={() => open(d.destinationId)}
              />
            ))}
          </ul>
        </main>
        <aside className="explore__aside" aria-label="Map of destinations">
          <ExploreMap items={mapItems} home={home} hoveredId={hovered} onHover={setHovered} onOpen={open} />
        </aside>
      </div>
    </div>
  );
}
