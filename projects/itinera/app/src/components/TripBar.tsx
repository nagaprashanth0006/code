import {
  addDays,
  cacheKey,
  fetchedLabel,
  summarizeWeather,
  TRIP_STATE_LABELS,
  weekdayIndex,
  type IsoDate,
} from "@itinera/core";
import { useMemo, useState, type FormEvent } from "react";
import { useStore } from "../state/store";

function nextSaturday(): IsoDate {
  const today = new Date().toISOString().slice(0, 10);
  return addDays(today, ((5 - weekdayIndex(today) + 7) % 7) || 7);
}

export function NewTripForm({ onDone }: { onDone?: () => void }) {
  const { cities, createTrip } = useStore();
  const [cityId, setCityId] = useState(cities[0]?.id ?? "");
  const start = nextSaturday();
  const [name, setName] = useState(`${cities[0]?.name ?? "City"} weekend`);
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(addDays(start, 2));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await createTrip({ name: name.trim() || "Trip", cityId, startDate, endDate });
    onDone?.();
  };

  return (
    <form className="new-trip" onSubmit={submit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        City
        <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        From
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </label>
      <label>
        To
        <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
      </label>
      <button className="primary" type="submit" disabled={!cityId || endDate < startDate}>
        Create trip
      </button>
    </form>
  );
}

export function TripBar() {
  const { tree, trips, openTrip, deleteTrip, normals, cacheEntries, cities } = useStore();
  const [creating, setCreating] = useState(false);
  const city = tree ? cities.find((c) => c.id === tree.legs[0]?.leg.cityId) : cities[0];

  const weather = useMemo(() => {
    if (!tree?.trip.startDate || !tree.trip.endDate || !city) return null;
    return summarizeWeather(normals.get(city.id) ?? [], tree.trip.startDate, tree.trip.endDate);
  }, [tree, city, normals]);

  const placesEntry = city ? cacheEntries.find((e) => e.key === cacheKey("places", city.id)) : undefined;

  return (
    <header className="tripbar">
      <span className="brand">Itinera</span>
      <div className="tripbar__trip">
        {trips.length > 0 && (
          <select
            aria-label="Trip"
            value={tree?.trip.id ?? ""}
            onChange={(e) => void openTrip(e.target.value)}
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {tree && (
          <span className="chip" title="Trip state">
            {TRIP_STATE_LABELS[tree.trip.state]}
          </span>
        )}
        <button onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New trip"}</button>
        {tree && (
          <button
            className="link danger"
            onClick={() => {
              if (confirm(`Delete "${tree.trip.name}"? This can't be undone.`)) void deleteTrip(tree.trip.id);
            }}
          >
            Delete
          </button>
        )}
      </div>
      {weather && city && (
        <span className="tripbar__weather" title="Typical weather from 20 years of daily history — not a forecast">
          Typical in {city.name}: {Math.round(weather.lowC)}–{Math.round(weather.highC)} °C ·{" "}
          {weather.rainDays < 1 ? "little rain" : `~${Math.round(weather.rainDays)} rainy day${Math.round(weather.rainDays) === 1 ? "" : "s"}`}
        </span>
      )}
      {placesEntry && <span className="tripbar__fresh muted small">{fetchedLabel(placesEntry, new Date())}</span>}
      {creating && (
        <div className="popover">
          <NewTripForm onDone={() => setCreating(false)} />
        </div>
      )}
    </header>
  );
}
