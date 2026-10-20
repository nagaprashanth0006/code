import { useStore } from "../state/store";

/** Loading and fatal-error screens. Fetching cities happens from the hub. */
export function Onboarding() {
  const { status } = useStore();

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <h1 className="wordmark">Itinera</h1>
        {status.kind === "loading" && <p className="muted">Opening your library…</p>}
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
