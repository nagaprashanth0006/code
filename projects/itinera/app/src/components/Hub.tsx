/**
 * The landing hub: a hero with search and the three doors (Plan, Explore,
 * My trips) over rows of destinations ranked for this month and the next
 * three. Rows come from the landing config setting; candidates are the
 * curated destination index merged with fetched cities.
 */
import {
  formatDuration,
  monthWindow,
  normalizeName,
  TRIP_STATE_LABELS,
  type DestinationScore,
  type LandingCandidate,
  type Theme,
  type Trip,
} from "@itinera/core";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useStore } from "../state/store";
import { destinationPhoto, useLanding, type Landing } from "./landing";
import { ALL_THEMES, monthName, Photo, THEME_LABELS, today, weatherText } from "./ui";

export interface HubNav {
  openDestination(id: string): void;
  openTrip(tripId: string): void;
  openExplore(): void;
}

export function Hub({ nav }: { nav: HubNav }) {
  const { home, trips, landingConfig } = useStore();
  const landing = useLanding();
  const candidatesCount = landing.candidates.length;
  const searchRef = useRef<HTMLInputElement>(null);
  const months = monthWindow(today(), landingConfig.windowMonths);
  const first = months[0]!;
  const last = months[months.length - 1]!;

  return (
    <div className="hub">
      <TopBar />

      <section className="hero">
        <div className="hero__inner">
          <h1>Where to next?</h1>
          <p className="hero__sub">
            {home
              ? `Picked for ${monthName(first.month)} – ${monthName(last.month)} from ${home.name}, by theme, typical weather and travel time.`
              : "Tell Itinera where you usually start from, and it ranks destinations by travel time, season and theme."}
          </p>
          {!home && <HomeForm />}
          <DestinationSearch inputRef={searchRef} landing={landing} onOpen={nav.openDestination} />

          <nav className="doors" aria-label="Start">
            <button className="door" onClick={() => searchRef.current?.focus()}>
              <span className="door__icon" aria-hidden>
                ✈︎
              </span>
              <span className="door__text">
                <strong>Plan a trip</strong>
                <span>Pick a place, check its weather, set dates</span>
              </span>
            </button>
            <button className="door" onClick={nav.openExplore}>
              <span className="door__icon" aria-hidden>
                ◎
              </span>
              <span className="door__text">
                <strong>Explore</strong>
                <span>{candidatesCount} destinations by theme</span>
              </span>
            </button>
            <button
              className="door"
              onClick={() => document.getElementById("my-trips")?.scrollIntoView({ behavior: "smooth" })}
              disabled={trips.length === 0}
            >
              <span className="door__icon" aria-hidden>
                ▤
              </span>
              <span className="door__text">
                <strong>My trips</strong>
                <span>{trips.length === 0 ? "None yet" : `${trips.length} trip${trips.length === 1 ? "" : "s"}`}</span>
              </span>
            </button>
          </nav>
        </div>
      </section>

      <main className="hub__main">
        {trips.length > 0 && (
          <section className="row" id="my-trips" aria-label="My trips">
            <div className="row__head">
              <h2>My trips</h2>
            </div>
            <ul className="carousel">
              {trips.map((t) => (
                <TripCard key={t.id} trip={t} landing={landing} onOpen={() => nav.openTrip(t.id)} />
              ))}
            </ul>
          </section>
        )}

        {home &&
          landing.rows.map(({ row, destinations }) =>
            destinations.length === 0 ? null : (
              <section key={row.id} className="row" aria-label={row.title}>
                <div className="row__head">
                  <h2>{row.title}</h2>
                  {row.id === "short-hops" && <span className="muted small">under ~{row.filters.maxTravelHours} h door to door</span>}
                </div>
                <ul className="carousel">
                  {destinations.map((d) => (
                    <DestinationCard key={d.destinationId} score={d} landing={landing} onOpen={() => nav.openDestination(d.destinationId)} />
                  ))}
                </ul>
              </section>
            ),
          )}

        <p className="muted small hub__note">
          Typical weather is from 20 years of daily history, not a forecast: approximate (NASA POWER, ~50 km grid) until a
          city's places are fetched, then from Open-Meteo. Photos from Wikimedia Commons; credits on each destination.
        </p>
      </main>
    </div>
  );
}



export function TopBar({ onBack, title }: { onBack?: () => void; title?: string }) {
  const { home } = useStore();
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
      ) : null}
      <span className="wordmark">{title ?? "Itinera"}</span>
      <span className="topbar__spacer" />
      {home && <HomePill />}
    </header>
  );
}

// ------------------------------------------------------------ cards

export function DestinationCard({
  score,
  landing,
  onOpen,
}: {
  score: DestinationScore;
  landing: Landing;
  onOpen: () => void;
}) {
  const c = landing.byId.get(score.destinationId);
  if (!c) return null;
  const weather = landing.climate(c.id, score.month);
  return (
    <li className="card">
      <button className="card__hit" onClick={onOpen} aria-label={`${c.name}: best in ${monthName(score.month)}`}>
        <Photo src={destinationPhoto(c)} alt={c.name} className="card__photo" />
        <span className="card__badge">Best in {monthName(score.month, "short")}</span>
        {c.cityId && <span className="card__badge card__badge--right" title="Places, hours and maps are on this device">Offline ready</span>}
        <span className="card__title">
          <strong>{c.name}</strong>
          <span>{countryLabel(c)}</span>
        </span>
      </button>
      <div className="card__meta">
        {weather && <span>{weatherText(weather)}</span>}
        <span className="muted">~{formatDuration(score.travelMinutes)} away</span>
      </div>
    </li>
  );
}

function TripCard({ trip, landing, onOpen }: { trip: Trip; landing: Landing; onOpen: () => void }) {
  const { tripCities } = useStore();
  const cityId = tripCities.get(trip.id)?.[0];
  const c = landing.candidates.find((x) => x.cityId === cityId);
  return (
    <li className="card card--trip">
      <button className="card__hit" onClick={onOpen} aria-label={`Open ${trip.name}`}>
        <Photo src={destinationPhoto(c)} alt={trip.name} className="card__photo" />
        <span className="card__badge">{TRIP_STATE_LABELS[trip.state]}</span>
        <span className="card__title">
          <strong>{trip.name}</strong>
          <span>{trip.startDate && trip.endDate ? `${trip.startDate} → ${trip.endDate}` : "No dates yet"}</span>
        </span>
      </button>
    </li>
  );
}

export const countryLabel = (c: LandingCandidate) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(c.countryCode) ?? c.countryCode;
  } catch {
    return c.countryCode;
  }
};

// ------------------------------------------------------------ search

function DestinationSearch({
  inputRef,
  landing,
  onOpen,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  landing: Landing;
  onOpen: (id: string) => void;
}) {
  const { addCity, adding } = useStore();
  const [q, setQ] = useState("");
  const query = normalizeName(q);
  const matches = useMemo(
    () =>
      query.length < 2
        ? []
        : landing.candidates
            .filter((c) => normalizeName(c.name).includes(query) || normalizeName(countryLabel(c)).includes(query))
            .slice(0, 6),
    [query, landing.candidates],
  );

  const fetchCity = async (e?: FormEvent) => {
    e?.preventDefault();
    if (matches[0]) return onOpen(matches[0].id);
    const name = q.trim();
    if (name.length < 2) return;
    const city = await addCity(name);
    if (city) {
      setQ("");
      onOpen(landing.candidates.find((c) => c.cityId === city.id)?.id ?? city.id);
    }
  };

  return (
    <form className="search" onSubmit={fetchCity} role="search">
      <input
        ref={inputRef}
        type="search"
        placeholder="Search destinations, or any city to fetch"
        aria-label="Search destinations"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {query.length >= 2 && (
        <ul className="search__results" role="listbox">
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" className="search__item" onClick={() => onOpen(c.id)}>
                <Photo src={destinationPhoto(c)} alt="" className="search__thumb" />
                <span>
                  <strong>{c.name}</strong>
                  <span className="muted small"> · {countryLabel(c)}</span>
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li>
              <button type="submit" className="search__item" disabled={!!adding}>
                <span className="search__thumb search__thumb--icon" aria-hidden>
                  ⤓
                </span>
                <span>
                  Fetch <strong>{q.trim()}</strong> from OpenStreetMap
                  <span className="muted small"> · places, photos and weather, about 3 minutes</span>
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </form>
  );
}

// ------------------------------------------------------------ home city

function HomePill() {
  const { home } = useStore();
  const [editing, setEditing] = useState(false);
  if (editing) return <HomeForm compact onDone={() => setEditing(false)} initial={home?.name} />;
  return (
    <button className="pill" onClick={() => setEditing(true)} title="Change home city">
      <span aria-hidden>⌂</span> {home?.name}
    </button>
  );
}

function HomeForm({ onDone, initial = "", compact = false }: { onDone?: () => void; initial?: string; compact?: boolean }) {
  const { setHome, destinations } = useStore();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await setHome(name);
    setBusy(false);
    onDone?.();
  };
  return (
    <form className={`home-form${compact ? " home-form--compact" : ""}`} onSubmit={submit}>
      <input
        aria-label="Home city"
        placeholder="Your home city, e.g. Bengaluru"
        value={name}
        onChange={(e) => setName(e.target.value)}
        list="known-cities"
        required
        autoFocus={compact}
      />
      <datalist id="known-cities">
        {destinations.map((d) => (
          <option key={d.id} value={d.name} />
        ))}
      </datalist>
      <button className="primary" type="submit" disabled={busy || !name.trim()}>
        {busy ? "Finding…" : "Save"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------ explore

/** Every candidate as a grid, filtered by theme, ranked for the window. */
export function Explore({ nav, onBack }: { nav: HubNav; onBack: () => void }) {
  const { home, landingConfig } = useStore();
  const landing = useLanding();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [sort, setSort] = useState<"score" | "travel">("score");

  const ranked = useMemo(() => {
    const scores = landing.candidates
      .filter((c) => !theme || c.themeTags.includes(theme))
      .map((c) => landing.bestFor(c.id))
      .filter((s): s is DestinationScore => !!s);
    return sort === "travel" ? scores.sort((a, b) => a.travelMinutes - b.travelMinutes) : scores.sort((a, b) => b.score - a.score);
  }, [landing, theme, sort]);

  return (
    <div className="hub">
      <TopBar onBack={onBack} title="Explore" />
      <main className="hub__main">
        <div className="explore__bar">
          <div className="chips" role="radiogroup" aria-label="Theme">
            <button role="radio" aria-checked={theme === null} className="chip-btn" onClick={() => setTheme(null)}>
              All
            </button>
            {ALL_THEMES.map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} className="chip-btn" onClick={() => setTheme(t)}>
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as "score" | "travel")} aria-label="Sort">
            <option value="score">Best match</option>
            <option value="travel">Closest first</option>
          </select>
        </div>
        {!home ? (
          <p className="muted">Set your home city on the hub to rank destinations.</p>
        ) : (
          <>
            <p className="muted small">
              {ranked.length} destinations, each at its best month in the next {landingConfig.windowMonths}.
            </p>
            <ul className="grid">
              {ranked.map((d) => (
                <DestinationCard key={d.destinationId} score={d} landing={landing} onOpen={() => nav.openDestination(d.destinationId)} />
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
