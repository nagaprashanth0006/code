import { CATEGORY_INFO, describeDayHours, hoursOnRaw, PLACE_CATEGORIES, type Place } from "@itinera/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { countryName, FilterBar, matchesLocation, useFilters } from "./filters";
import { useSelectedDate } from "./hooks";

/** Catalog tree: Country → City → great places. */
export function CatalogPane() {
  const { countries, cities, places, selectedPlaceId, selectPlace, wishlist, toggleWishlist, addPlace, targetSlotId, home } =
    useStore();
  const [f, set, clear] = useFilters("itinera.places");
  const query = f.query;
  const [category, setCategory] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const date = useSelectedDate();
  const selectedRef = useRef<HTMLLIElement | null>(null);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const isoOf = useMemo(() => new Map(countries.map((c) => [c.id, c.isoCode])), [countries]);
  // Theme, region, country and distance pick the cities; the name search and kind pick places within them.
  const shownCities = useMemo(
    () =>
      new Set(
        cities
          .filter((c) => matchesLocation({ ...c, countryCode: isoOf.get(c.countryId) ?? "" }, { ...f, query: "" }, home, countryName))
          .map((c) => c.id),
      ),
    [cities, isoOf, f, home],
  );

  const byCity = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = new Map<string, Place[]>();
    for (const p of places.values()) {
      if (!shownCities.has(p.cityId)) continue;
      if (f.theme && !CATEGORY_INFO[p.category].themes.includes(f.theme)) continue;
      if (category === "saved" ? !wishlist.has(p.id) : category && p.category !== category) continue;
      if (q && !p.name.toLowerCase().includes(q) && !(p.description ?? "").toLowerCase().includes(q)) continue;
      const list = m.get(p.cityId) ?? [];
      list.push(p);
      m.set(p.cityId, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.rank - a.rank);
    return m;
  }, [places, query, category, wishlist, shownCities, f.theme]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedPlaceId]);

  return (
    <div className="catalog">
      <div className="pane__header pane__header--filters">
        <FilterBar
          compact
          filters={f}
          set={set}
          clear={clear}
          countries={cities.map((c) => isoOf.get(c.countryId) ?? "")}
          home={home}
          queryLabel="Search places"
        />
        <select className="pane__kind" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter">
          <option value="">All kinds</option>
          <option value="saved">Saved (wishlist)</option>
          {PLACE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_INFO[c].label}
            </option>
          ))}
        </select>
      </div>

      {countries.length === 0 && <p className="muted pad">No places yet. Pick a destination on the hub and fetch its places.</p>}
      {countries.length > 0 && shownCities.size === 0 && (
        <p className="muted pad">
          No downloaded cities match these filters.{" "}
          <button className="link" onClick={clear}>
            Clear filters
          </button>
        </p>
      )}

      <ul className="tree" role="tree" aria-label="Catalog">
        {countries.map((country) => {
          const countryCities = cities.filter((c) => c.countryId === country.id && shownCities.has(c.id));
          if (countryCities.length === 0) return null;
          const open = !collapsed.has(country.id);
          return (
            <li key={country.id} role="treeitem" aria-expanded={open}>
              <button className="tree__toggle" onClick={() => toggle(country.id)}>
                <span className="caret">{open ? "▾" : "▸"}</span> {country.name}
              </button>
              {open && (
                <ul role="group">
                  {countryCities.map((city) => {
                    const cityOpen = !collapsed.has(city.id);
                    const list = byCity.get(city.id) ?? [];
                    return (
                      <li key={city.id} role="treeitem" aria-expanded={cityOpen}>
                        <button className="tree__toggle" onClick={() => toggle(city.id)}>
                          <span className="caret">{cityOpen ? "▾" : "▸"}</span> {city.name}{" "}
                          <span className="muted small">{list.length} places</span>
                        </button>
                        {cityOpen && (
                          <ul role="group" className="places">
                            {list.map((p) => {
                              const hours = date ? hoursOnRaw(p.hoursRaw, date) : null;
                              const isSel = p.id === selectedPlaceId;
                              return (
                                <li
                                  key={p.id}
                                  role="treeitem"
                                  aria-selected={isSel}
                                  ref={isSel ? selectedRef : undefined}
                                  className={`place-row${isSel ? " is-selected" : ""}`}
                                >
                                  <button className="place-row__main" onClick={() => selectPlace(isSel ? null : p.id)}>
                                    <span className="place-row__name">{p.name}</span>
                                    <span className="muted small">
                                      {CATEGORY_INFO[p.category].label}
                                      {hours && hours.status !== "unknown" && (
                                        <span className={hours.status === "closed" ? "closed" : ""}>
                                          {" · "}
                                          {describeDayHours(hours)}
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                  <button
                                    className={`icon${wishlist.has(p.id) ? " is-on" : ""}`}
                                    aria-label={wishlist.has(p.id) ? `Unsave ${p.name}` : `Save ${p.name}`}
                                    aria-pressed={wishlist.has(p.id)}
                                    onClick={() => void toggleWishlist(p.id)}
                                  >
                                    {wishlist.has(p.id) ? "★" : "☆"}
                                  </button>
                                  <button
                                    className="icon"
                                    aria-label={`Add ${p.name} to plan`}
                                    title={targetSlotId ? "Add to the selected slot" : "Select a slot in the plan first"}
                                    disabled={!targetSlotId}
                                    onClick={() => void addPlace(p.id)}
                                  >
                                    +
                                  </button>
                                </li>
                              );
                            })}
                            {list.length === 0 && <li className="muted small empty">No places match.</li>}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
