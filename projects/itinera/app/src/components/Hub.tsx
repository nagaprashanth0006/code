/**
 * The landing hub: Plan and Explore side by side as equal ways in, then
 * your trips and rows of destinations ranked for this month and the next
 * three. Rows come from the landing config setting; candidates are the
 * curated destination index merged with fetched cities.
 */
import {
  formatDuration,
  haversineKm,
  monthWindow,
  normalizeName,
  TRIP_STATE_LABELS,
  regionOf,
  REGIONS,
  type DestinationScore,
  type IsoDate,
  type LandingCandidate,
  type Trip,
} from "@itinera/core";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useStore } from "../state/store";
import { destinationPhoto, useLanding, type Landing } from "./landing";
import type { Filters } from "./filters";
import { ThemeToggle } from "./theme";
import { ALL_THEMES, distanceText, monthName, Photo, THEME_LABELS, today, weatherText, weatherWord } from "./ui";

export interface HubNav {
  /** Dates chosen in Explore carry over to the destination's plan card. */
  openDestination(id: string, dates?: { start: IsoDate; end: IsoDate }): void;
  openTrip(tripId: string): void;
  openExplore(initial?: Partial<Filters>): void;
}

export function Hub({ nav }: { nav: HubNav }) {
  const { home, trips, landingConfig } = useStore();
  const landing = useLanding();
  const candidatesCount = landing.candidates.length;
  const searchRef = useRef<HTMLInputElement>(null);
  // Quick starts for planning: places already on this device, else the nearest ones.
  const picks = useMemo(() => {
    const ready = landing.candidates.filter((c) => c.cityId);
    if (ready.length >= 3 || !home) return { ready: true, list: ready.slice(0, 8) };
    const near = [...landing.candidates].sort((a, b) => haversineKm(home, a) - haversineKm(home, b)).slice(0, 6);
    return { ready: false, list: near };
  }, [landing.candidates, home]);
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

          <div className="paths">
            <section className="path" aria-labelledby="path-plan">
              <div className="path__head">
                <span className="path__icon" aria-hidden>
                  ✈︎
                </span>
                <div>
                  <h2 id="path-plan">Plan a trip</h2>
                  <p className="muted small">You know where: check its weather, pick dates, build the days.</p>
                </div>
              </div>
              <DestinationSearch inputRef={searchRef} landing={landing} onOpen={(id) => nav.openDestination(id)} />
              {picks.list.length > 0 && (
                <div className="path__links">
                  <span className="muted small">{picks.ready ? "Ready offline" : "Closest"}</span>
                  {picks.list.map((c) => (
                    <button key={c.id} className="chip-btn chip-btn--quiet" onClick={() => nav.openDestination(c.id)}>
                      {c.cityId && <span className="dot dot--ready" aria-label="Offline ready" />}
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {trips.length > 0 && (
                <div className="path__links">
                  <span className="muted small">Continue</span>
                  {trips.slice(0, 3).map((t) => (
                    <button key={t.id} className="chip-btn" onClick={() => nav.openTrip(t.id)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="path" aria-labelledby="path-explore">
              <div className="path__head">
                <span className="path__icon" aria-hidden>
                  ◎
                </span>
                <div>
                  <h2 id="path-explore">Explore</h2>
                  <p className="muted small">
                    Not sure yet: {candidatesCount} destinations on a map, by theme, distance, region and dates.
                  </p>
                </div>
              </div>
              <div className="path__links">
                {ALL_THEMES.map((t) => (
                  <button key={t} className={`chip-btn chip-btn--${t}`} onClick={() => nav.openExplore({ theme: t, region: null, country: null })}>
                    {THEME_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className="path__links">
                {regionsWithCounts(landing.candidates).map((r) => (
                  <button key={r.id} className="chip-btn chip-btn--quiet" onClick={() => nav.openExplore({ region: r.id, country: null, theme: null })}>
                    {r.label} <span className="muted">{r.count}</span>
                  </button>
                ))}
              </div>
              <button className="primary path__go" onClick={() => nav.openExplore()}>
                Open Explore
              </button>
            </section>
          </div>
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

        {home && <OfflineCard landing={landing} />}

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
      <div className="topbar__inner">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            ←
          </button>
        ) : null}
        <span className="wordmark">{title ?? "Itinera"}</span>
        <span className="topbar__spacer" />
        {home && <HomePill />}
        <ThemeToggle />
      </div>
    </header>
  );
}

// ------------------------------------------------------------ cards

export function DestinationCard({
  score,
  landing,
  onOpen,
  dated = false,
  highlighted = false,
  onHover,
}: {
  score: DestinationScore;
  landing: Landing;
  onOpen: () => void;
  /** Scored for chosen dates rather than the best month. */
  dated?: boolean;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const c = landing.byId.get(score.destinationId);
  if (!c) return null;
  const weather = score.weather;
  const period = dated ? " on your dates" : ` in ${monthName(score.month, "short")}`;
  return (
    <li
      className={`card${highlighted ? " is-highlighted" : ""}`}
      onMouseEnter={onHover && (() => onHover(c.id))}
      onMouseLeave={onHover && (() => onHover(null))}
    >
      <button className="card__hit" onClick={onOpen} aria-label={`${c.name}: ${dated ? weatherWord(score.factors.seasonFit) : `best in ${monthName(score.month)}`}`}>
        <Photo src={destinationPhoto(c)} alt={c.name} className="card__photo" />
        <span className="card__badge">{dated ? weatherWord(score.factors.seasonFit) : `Best in ${monthName(score.month, "short")}`}</span>
        {c.cityId && <span className="offline-dot" role="img" aria-label="Offline ready" data-tip="Offline ready" />}
        <span className="card__title">
          <strong>{c.name}</strong>
          <span>{countryLabel(c)}</span>
        </span>
      </button>
      <div className="card__meta">
        {weather && (
          <span title="Typical, not a forecast. A rainy day has at least 1 mm of rain (20 years of history).">{weatherText(weather, period)}</span>
        )}
        <span className="muted">
          ~{formatDuration(score.travelMinutes)} · {distanceText(score.distanceKm)} away
        </span>
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

function regionsWithCounts(candidates: readonly LandingCandidate[]) {
  return REGIONS.map((r) => ({ ...r, count: candidates.filter((c) => regionOf(c.countryCode) === r.id).length })).filter((r) => r.count > 0);
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
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
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

  // "/" focuses the search from anywhere on the hub; a click elsewhere closes the results.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!formRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [inputRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open && q) setOpen(false);
      else setQ("");
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && matches.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
    }
  };

  const fetchCity = async (e?: FormEvent) => {
    e?.preventDefault();
    const pick = matches[active] ?? matches[0];
    if (pick) return onOpen(pick.id);
    const name = q.trim();
    if (name.length < 2) return;
    const city = await addCity(name);
    if (city) {
      setQ("");
      onOpen(landing.candidates.find((c) => c.cityId === city.id)?.id ?? city.id);
    }
  };

  return (
    <form ref={formRef} className="search" onSubmit={fetchCity} role="search">
      <span className="search__icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={inputRef}
        type="search"
        placeholder="Search destinations, or any city to fetch"
        aria-label="Search destinations"
        aria-expanded={open && query.length >= 2}
        aria-controls="search-results"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd className="search__kbd" aria-hidden>
        /
      </kbd>
      {open && query.length >= 2 && (
        <ul className="search__results" role="listbox" id="search-results">
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={`search__item${i === active ? " is-active" : ""}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => onOpen(c.id)}
              >
                <Photo src={destinationPhoto(c)} alt="" className="search__thumb" />
                <span>
                  <strong>{c.name}</strong>
                  <span className="muted small"> · {countryLabel(c)}</span>
                </span>
                {c.cityId && <span className="search__tag">Offline</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li>
              <button type="submit" className="search__item is-active" disabled={!!adding && !adding.queued}>
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

// ------------------------------------------------------------ offline

/**
 * Fetching every destination's places takes hours, so it runs in the
 * background one city at a time, best matches first, and carries on after a
 * restart.
 */
function OfflineCard({ landing }: { landing: Landing }) {
  const { fetchQueue, queueFetches, stopQueue, adding } = useStore();
  const { fetchable, ready, missing } = useMemo(() => {
    const fetchable = landing.candidates.filter((c) => c.destination?.ingestQuery);
    const missing = fetchable
      .filter((c) => !c.cityId)
      .map((c) => ({ query: c.destination!.ingestQuery!, score: landing.bestFor(c.id)?.score ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .map((c) => c.query);
    return { fetchable: fetchable.length, ready: fetchable.length - missing.length, missing };
  }, [landing]);
  const left = fetchQueue.length;
  const hours = Math.max(1, Math.round((missing.length * 3) / 60));

  return (
    <section className="offline-card" aria-label="Offline downloads">
      <div className="offline-card__text">
        <h2>Take it all offline</h2>
        <p className="muted">
          {ready} of {fetchable} destinations have their places, hours and photos on this device.
          {left > 0
            ? ` Downloading the rest in the background: ${left} left${adding?.queued ? `, now ${adding.city}` : ""}.`
            : missing.length > 0
              ? ` Fetch the other ${missing.length} in the background, one at a time and best matches first (about ${hours} h in all). It carries on after a restart.`
              : " Everything is offline-ready."}
        </p>
        <span className="meter" aria-hidden>
          <span style={{ width: `${fetchable ? Math.round((ready / fetchable) * 100) : 0}%` }} />
        </span>
      </div>
      {left > 0 ? (
        <button onClick={stopQueue}>Stop downloading</button>
      ) : (
        missing.length > 0 && (
          <button className="primary" onClick={() => queueFetches(missing)}>
            Download all in the background
          </button>
        )
      )}
    </section>
  );
}
