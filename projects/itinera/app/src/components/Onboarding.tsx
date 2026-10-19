import { DEFAULT_CITY, useStore } from "../state/store";

/** Loading, first-run fetch and fatal-error screens. */
export function Onboarding() {
  const { status, ingest, platform } = useStore();

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <h1>Itinera</h1>
        {status.kind === "loading" && <p className="muted">Opening your library…</p>}

        {status.kind === "needs-data" && (
          <>
            <p>
              Itinera works offline. Before the first plan it fetches {DEFAULT_CITY}'s great places, opening hours,
              descriptions, photos and 20 years of weather history once, from free sources.
            </p>
            <ul className="sources">
              <li>Places and opening hours: OpenStreetMap (Overpass)</li>
              <li>Descriptions: Wikivoyage and Wikidata</li>
              <li>Photos: Wikimedia Commons</li>
              <li>Typical weather: Open-Meteo historical archive</li>
            </ul>
            <p className="muted">Takes about 3 minutes at the sources' polite rate limits.</p>
            <button className="primary" onClick={() => void ingest(DEFAULT_CITY)}>
              Fetch {DEFAULT_CITY}
            </button>
            {platform?.kind === "browser" && (
              <p className="muted small">
                Browser harness: run <code>npm run ingest -- city Lisbon</code> and reload with <code>?reset-db</code> to
                skip the fetch.
              </p>
            )}
          </>
        )}

        {status.kind === "ingesting" && (
          <div aria-live="polite">
            <p>{status.progress.step}…</p>
            {status.progress.total ? (
              <progress max={status.progress.total} value={status.progress.done ?? 0} />
            ) : (
              <progress />
            )}
          </div>
        )}

        {status.kind === "error" && (
          <>
            <p className="error">{status.message}</p>
            <button className="primary" onClick={() => location.reload()}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
