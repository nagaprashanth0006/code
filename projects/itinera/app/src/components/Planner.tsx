/**
 * The planner: the map fills the window and the plan floats over it. Wide
 * screens get a side panel (Itinerary / Places) and a place card on the
 * right; phones get the same panel as a bottom sheet with three heights.
 */
import { cacheKey, fetchedLabel, summarizeWeather, TRIP_STATE_LABELS } from "@itinera/core";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { CatalogPane } from "./CatalogPane";
import { ItineraryPane } from "./ItineraryPane";
import { MapPane, type MapInset } from "./MapPane";
import { NewTripForm } from "./NewTripForm";
import { PlaceDetail } from "./PlaceDetail";
import { Sheet, weatherText } from "./ui";
import { shortDate } from "./hooks";

export type PlannerTab = "plan" | "places";
type SheetSize = "peek" | "half" | "full";

const PHONE = window.matchMedia("(max-width: 699px)");
const PANEL_WIDTH = 400;
const GAP = 16;

function usePhone(): boolean {
  const [phone, setPhone] = useState(PHONE.matches);
  useEffect(() => {
    const on = () => setPhone(PHONE.matches);
    PHONE.addEventListener("change", on);
    return () => PHONE.removeEventListener("change", on);
  }, []);
  return phone;
}

const SHEET_VH: Record<SheetSize, number> = { peek: 0.22, half: 0.55, full: 0.88 };

export function Planner({ tab, onTab, onHome }: { tab: PlannerTab; onTab: (t: PlannerTab) => void; onHome: () => void }) {
  const { tree, trips, openTrip, deleteTrip, cities, normals, cacheEntries, places, selectedPlaceId } = useStore();
  const phone = usePhone();
  const [sheet, setSheet] = useState<SheetSize>("half");
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const city = tree ? cities.find((c) => c.id === tree.legs[0]?.leg.cityId) : undefined;
  const selected = selectedPlaceId ? places.get(selectedPlaceId) : undefined;

  const weather = useMemo(() => {
    if (!tree?.trip.startDate || !tree.trip.endDate || !city) return null;
    return summarizeWeather(normals.get(city.id) ?? [], tree.trip.startDate, tree.trip.endDate);
  }, [tree, city, normals]);
  const placesEntry = city ? cacheEntries.find((e) => e.key === cacheKey("places", city.id)) : undefined;

  const inset: MapInset = phone
    ? { left: 0, bottom: Math.round(window.innerHeight * SHEET_VH[sheet]) }
    : { left: PANEL_WIDTH + GAP * 2, bottom: 0, right: selected ? 360 + GAP * 2 : 0 };

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
                {city?.name}
                {tree.trip.startDate && tree.trip.endDate && ` · ${shortDate(tree.trip.startDate)} – ${shortDate(tree.trip.endDate)}`}
              </p>
            )}
          </div>
          <div className="menu">
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
            {weather && (
              <span className="chip" title="Typical weather from 20 years of daily history, not a forecast">
                {weatherText(weather)}
              </span>
            )}
            {placesEntry && <span className="muted small">{fetchedLabel(placesEntry, new Date())}</span>}
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
