/**
 * The planner: the map fills the window and the plan floats over it. Wide
 * screens get a side panel (Itinerary / Places) and a place card on the
 * right; phones get the same panel as a bottom sheet with three heights.
 */
import { cacheKey, fetchedLabel, TRIP_STATE_LABELS } from "@itinera/core";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "../state/store";
import { CatalogPane } from "./CatalogPane";
import { ItineraryPane } from "./ItineraryPane";
import { MapPane, type MapInset } from "./MapPane";
import { NewTripForm } from "./NewTripForm";
import { PlaceDetail } from "./PlaceDetail";
import { ThemeToggle } from "./theme";
import { Sheet } from "./ui";
import { shortDate, useDismiss } from "./hooks";

export type PlannerTab = "plan" | "places";
type SheetSize = "peek" | "half" | "full";

const PHONE = window.matchMedia("(max-width: 699px)");
const NARROW = window.matchMedia("(max-width: 860px)");
const WIDE = window.matchMedia("(min-width: 1600px)");
const GAP = 16;

function useMedia(query: MediaQueryList): boolean {
  const [matches, setMatches] = useState(query.matches);
  useEffect(() => {
    const on = () => setMatches(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query]);
  return matches;
}

const SHEET_VH: Record<SheetSize, number> = { peek: 0.22, half: 0.55, full: 0.88 };

export function Planner({ tab, onTab, onHome }: { tab: PlannerTab; onTab: (t: PlannerTab) => void; onHome: () => void }) {
  const { tree, trips, openTrip, deleteTrip, cities, cacheEntries, places, selectedPlaceId, selectedLeg, cityName } = useStore();
  const phone = useMedia(PHONE);
  const narrow = useMedia(NARROW);
  const wide = useMedia(WIDE);
  // Must match the panel and place-card widths in styles.css.
  const panelWidth = wide ? 460 : narrow ? 360 : 400;
  const cardWidth = wide ? 400 : narrow ? 320 : 360;
  const [sheet, setSheet] = useState<SheetSize>("half");
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const menuRef = useDismiss(menu, closeMenu);
  const city = selectedLeg ? cities.find((c) => c.id === selectedLeg.leg.cityId) : undefined;
  const selected = selectedPlaceId ? places.get(selectedPlaceId) : undefined;
  const placesEntry = city ? cacheEntries.find((e) => e.key === cacheKey("places", city.id)) : undefined;

  const inset: MapInset = phone
    ? { left: 0, bottom: Math.round(window.innerHeight * SHEET_VH[sheet]) }
    : { left: panelWidth + GAP * 2, bottom: 0, right: selected ? cardWidth + GAP * 2 : 0 };

  const cycleSheet = () => setSheet((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));

  return (
    <div className={`planner${phone ? " planner--phone" : ""}`}>
      <MapPane inset={inset} />

      <aside className="panel" data-size={phone ? sheet : undefined} aria-label="Plan">
        {phone && <button className="panel__grabber" onClick={cycleSheet} aria-label="Resize panel" />}
        <header className="panel__head">
          <button className="icon-btn" onClick={onHome} aria-label="Back to the hub" title="Back to the hub">
            ←
          </button>
          <div className="panel__title">
            {tree ? (
              <select className="title-select" aria-label="Trip" value={tree.trip.id} onChange={(e) => void openTrip(e.target.value)}>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <h2>Plan</h2>
            )}
            {tree && (
              <p className="panel__sub">
                {tree.legs.map((l) => cityName(l.leg.cityId)).join(" → ")}
                {tree.trip.startDate && tree.trip.endDate && ` · ${shortDate(tree.trip.startDate)} – ${shortDate(tree.trip.endDate)}`}
              </p>
            )}
          </div>
          <ThemeToggle />
          <div className="menu" ref={menuRef}>
            <button className="icon-btn" aria-label="Trip actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              ⋯
            </button>
            {menu && (
              <div className="menu__list" role="menu" onClick={() => setMenu(false)}>
                <button role="menuitem" onClick={() => setCreating(true)} disabled={cities.length === 0}>
                  New trip
                </button>
                {tree && (
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      if (confirm(`Delete "${tree.trip.name}"? This can't be undone.`)) void deleteTrip(tree.trip.id);
                    }}
                  >
                    Delete trip
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {tree && (
          <div className="panel__facts">
            <span className="chip">{TRIP_STATE_LABELS[tree.trip.state]}</span>
            {placesEntry && city && (
              <span className="muted small">
                {tree.legs.length > 1 ? `${city.name}: ` : ""}
                {fetchedLabel(placesEntry, new Date())}
              </span>
            )}
          </div>
        )}

        <div className="segmented" role="tablist" aria-label="Panel">
          <button role="tab" aria-selected={tab === "plan"} onClick={() => onTab("plan")}>
            Itinerary
          </button>
          <button role="tab" aria-selected={tab === "places"} onClick={() => onTab("places")}>
            Places
          </button>
        </div>

        <div className="panel__body">
          {phone && selected && (
            <div className="panel__detail">
              <PlaceDetail place={selected} />
            </div>
          )}
          {tab === "plan" ? <ItineraryPane /> : <CatalogPane />}
        </div>
      </aside>

      {!phone && selected && (
        <aside className="floatcard" aria-label={selected.name}>
          <PlaceDetail place={selected} />
        </aside>
      )}

      {creating && (
        <Sheet title="New trip" onClose={() => setCreating(false)}>
          <NewTripForm onDone={() => setCreating(false)} />
        </Sheet>
      )}
    </div>
  );
}
