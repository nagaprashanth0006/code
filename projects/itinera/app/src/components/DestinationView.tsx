/**
 * One destination before any planning: photo, summary, typical weather for
 * every month, why it is recommended now, and a plan card where dates can be
 * tried against the typical weather. "Plan this trip" fetches the city's
 * places first when they aren't on this device yet.
 */
import {
  addDays,
  daysBetween,
  formatDuration,
  monthClimate,
  monthOf,
  monthWindow,
  suggestTripDates,
  summarizeMonthly,
  summarizeWeather,
  type WeatherSummary,
} from "@itinera/core";
import { useMemo, useState, type FormEvent } from "react";
import { useStore } from "../state/store";
import { countryLabel, TopBar } from "./Hub";
import { destinationPhoto, useLanding } from "./landing";
import { monthName, Photo, PhotoCredit, rainText, THEME_LABELS, today } from "./ui";
import { WeatherChart } from "./WeatherChart";

export function DestinationView({
  id,
  onBack,
  onPlanned,
  onBrowse,
}: {
  id: string;
  onBack: () => void;
  onPlanned: () => void;
  onBrowse: () => void;
}) {
  const { home, normals, landingConfig, platform, createTrip, addCity, adding } = useStore();
  const landing = useLanding();
  const c = landing.byId.get(id);
  const best = c ? landing.bestFor(c.id) : null;
  const firstDates = best ? suggestTripDates(best.year, best.month, today()) : suggestTripDates(...nextMonth());
  const [startDate, setStartDate] = useState(firstDates.startDate);
  const [endDate, setEndDate] = useState(firstDates.endDate);
  const [name, setName] = useState(c ? `${c.name} in ${monthName(monthOf(firstDates.startDate))}` : "Trip");
  const [busy, setBusy] = useState(false);

  const daily = c?.cityId ? normals.get(c.cityId) ?? [] : [];
  // Fetched cities have 20-year daily normals; otherwise the index's monthly figures.
  const months = useMemo<(WeatherSummary | null)[]>(
    () =>
      daily.length > 0
        ? Array.from({ length: 12 }, (_, i) => monthClimate(daily, i + 1))
        : [...(c?.destination?.months ?? Array(12).fill(null))],
    [daily, c],
  );
  const validDates = endDate >= startDate;
  const forDates = validDates
    ? daily.length > 0
      ? summarizeWeather(daily, startDate, endDate)
      : summarizeMonthly(months, startDate, endDate)
    : null;
  const selectedMonths = validDates ? [...new Set([monthOf(startDate), monthOf(endDate)])] : [];
  const window = monthWindow(today(), landingConfig.windowMonths).map((m) => m.month);

  if (!c) {
    return (
      <div className="hub">
        <TopBar onBack={onBack} />
        <main className="hub__main">
          <p>This destination isn't in the catalog any more.</p>
        </main>
      </div>
    );
  }

  const open = (url: string) => platform?.openExternal(url);
  const canFetch = !!c.destination?.ingestQuery;
  const fetchingThis = adding && c.destination?.ingestQuery === adding.city;

  const plan = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      let cityId = c.cityId;
      if (!cityId && c.destination?.ingestQuery) cityId = (await addCity(c.destination.ingestQuery))?.id ?? null;
      if (!cityId) return;
      await createTrip({ name: name.trim() || c.name, cityId, startDate, endDate });
      onPlanned();
    } finally {
      setBusy(false);
    }
  };

  const fetchOnly = async () => {
    if (c.destination?.ingestQuery) await addCity(c.destination.ingestQuery);
  };

  const nights = validDates ? daysBetween(startDate, endDate) : 0;

  return (
    <div className="dest-page">
      <section className="dest-hero">
        <Photo src={destinationPhoto(c)} alt={c.name} className="dest-hero__photo" />
        <button className="icon-btn dest-hero__back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="dest-hero__text">
          <p className="dest-hero__country">{countryLabel(c)}</p>
          <h1>{c.name}</h1>
          <div className="chips">
            {c.themeTags.map((t) => (
              <span key={t} className="chip chip--glass">
                {THEME_LABELS[t]}
              </span>
            ))}
            {c.cityId && <span className="chip chip--glass">Offline ready</span>}
          </div>
        </div>
        {c.destination?.photo && (
          <div className="dest-hero__credit">
            <PhotoCredit attribution={c.destination.photo.attribution} onOpen={open} />
          </div>
        )}
      </section>

      <div className="dest-body">
        <main className="dest-main">
          {c.destination?.summary && (
            <section className="panel-card">
              <p className="lede">{c.destination.summary}</p>
              {c.destination.wikipediaUrl && (
                <p className="muted small">
                  From{" "}
                  <button className="link" onClick={() => open(c.destination!.wikipediaUrl!)}>
                    Wikipedia
                  </button>
                  , CC BY-SA 4.0
                </p>
              )}
            </section>
          )}

          <section className="panel-card">
            <div className="panel-card__head">
              <h2>Typical weather</h2>
              <span className="muted small">
                {daily.length > 0 ? "20 years of daily history (Open-Meteo)" : `Approximate · ${c.destination?.climateSource ?? ""}`}
              </span>
            </div>
            <WeatherChart months={months} window={window} best={best?.month ?? null} selected={selectedMonths} />
          </section>

          {best && home && (
            <section className="panel-card">
              <div className="panel-card__head">
                <h2>Why now</h2>
                <span className="muted small">
                  Best in {monthName(best.month)} of the next {landingConfig.windowMonths} months
                </span>
              </div>
              <ul className="factors">
                <Factor label="Season" value={best.factors.seasonFit} note={months[best.month - 1] ? `${Math.round(months[best.month - 1]!.highC)} °C highs, ${rainText(months[best.month - 1]!.rainDays)}` : "no weather data"} />
                <Factor label="Getting there" value={best.factors.reachability} note={`~${formatDuration(best.travelMinutes)} from ${home.name}`} />
                <Factor label="Price" value={best.factors.priceSignal} note="no price data yet" />
              </ul>
            </section>
          )}
        </main>

        <aside className="plan-card" aria-label="Plan a trip">
          <h2>Plan a trip</h2>
          <form onSubmit={plan} className="plan-card__form">
            <label className="field">
              <span>Trip name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>From</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </label>
              <label className="field">
                <span>To</span>
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
              </label>
            </div>

            <div className="forecastish" aria-live="polite">
              {forDates ? (
                <>
                  <div className="forecastish__temp">
                    {Math.round(forDates.lowC)}–{Math.round(forDates.highC)}
                    <span>°C</span>
                  </div>
                  <div className="small">
                    Typical for these dates · {rainText(forDates.rainDays)} over {nights + 1} day{nights === 0 ? "" : "s"}
                    <br />
                    <span className="muted">
                      Expect {Math.round(forDates.coldC)}° to {Math.round(forDates.warmC)}° at the extremes. Not a forecast.
                    </span>
                  </div>
                </>
              ) : (
                <span className="muted small">{validDates ? "No weather data for these dates." : "The end date is before the start."}</span>
              )}
            </div>

            {best && home && (
              <p className="small muted">
                ~{formatDuration(best.travelMinutes)} from {home.name} · {nights} night{nights === 1 ? "" : "s"}
              </p>
            )}

            {fetchingThis ? (
              <div className="progress" aria-live="polite">
                <span className="small">
                  {adding!.progress.step}
                  {adding!.progress.total ? ` (${adding!.progress.done ?? 0}/${adding!.progress.total})` : ""}…
                </span>
                {adding!.progress.total ? <progress max={adding!.progress.total} value={adding!.progress.done ?? 0} /> : <progress />}
              </div>
            ) : (
              <button className="primary primary--block" type="submit" disabled={busy || !validDates || (!c.cityId && !canFetch) || !!adding}>
                {c.cityId ? "Plan this trip" : "Fetch places and plan"}
              </button>
            )}
            {!c.cityId && canFetch && !fetchingThis && (
              <p className="small muted">Places, opening hours and photos are fetched once (about 3 minutes), then work offline.</p>
            )}
            {!c.cityId && !canFetch && (
              <p className="small muted">This place has no city boundary on OpenStreetMap yet, so its places can't be fetched automatically.</p>
            )}
          </form>
          <div className="plan-card__alt">
            {c.cityId ? (
              <button onClick={onBrowse}>Browse places</button>
            ) : (
              canFetch && (
                <button onClick={() => void fetchOnly()} disabled={!!adding}>
                  Just fetch places
                </button>
              )
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Factor({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <li className="factor">
      <span className="factor__label">{label}</span>
      <span className="factor__track">
        <span className="factor__fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="factor__note small muted">{note}</span>
    </li>
  );
}

function nextMonth(): [number, number, string] {
  const t = today();
  const d = addDays(t, 30);
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), t];
}
