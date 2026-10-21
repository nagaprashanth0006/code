import { useState } from "react";
import { DestinationView } from "./components/DestinationView";
import { Explore, Hub, type HubNav } from "./components/Hub";
import { Onboarding } from "./components/Onboarding";
import { Planner, type PlannerTab } from "./components/Planner";
import { useStore } from "./state/store";

type View =
  | { name: "hub" }
  | { name: "explore" }
  | { name: "destination"; id: string }
  | { name: "planner"; tab: PlannerTab };

/** The app opens on the hub; views stack so Back returns to where you came from. */
export function App() {
  const store = useStore();
  const [stack, setStack] = useState<View[]>([{ name: "hub" }]);
  const view = stack[stack.length - 1]!;
  const push = (v: View) => {
    setStack((s) => [...s, v]);
    window.scrollTo(0, 0);
  };
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const home = () => setStack([{ name: "hub" }]);

  if (store.status.kind !== "ready") return <Onboarding />;

  const nav: HubNav = {
    openDestination: (id) => push({ name: "destination", id }),
    openExplore: () => push({ name: "explore" }),
    openTrip: async (tripId) => {
      await store.openTrip(tripId);
      push({ name: "planner", tab: "plan" });
    },
  };

  return (
    <>
      {view.name === "hub" && <Hub nav={nav} />}
      {view.name === "explore" && <Explore nav={nav} onBack={back} />}
      {view.name === "destination" && (
        <DestinationView
          key={view.id}
          id={view.id}
          onBack={back}
          onPlanned={() => push({ name: "planner", tab: "plan" })}
          onBrowse={() => push({ name: "planner", tab: "places" })}
        />
      )}
      {view.name === "planner" && (
        <Planner
          tab={view.tab}
          onTab={(tab) => setStack((s) => [...s.slice(0, -1), { name: "planner", tab }])}
          onHome={home}
        />
      )}
      <FetchProgress />
      <Toast />
    </>
  );
}

/** A city fetch (and the background download) keeps running while you move around the app. */
function FetchProgress() {
  const { adding, fetchQueue, queuePaused, cancelFetch, stopQueue, resumeQueue } = useStore();
  const waiting = fetchQueue.filter((q) => q !== adding?.city).length;
  if (!adding && !(queuePaused && waiting > 0)) return null;
  if (!adding) {
    return (
      <div className="fetch-pill" role="status">
        <span className="fetch-pill__text">
          Background download paused · <span className="muted">{waiting} left</span>
        </span>
        <span className="fetch-pill__actions">
          <button className="link" onClick={resumeQueue}>
            Resume
          </button>
          <button className="link danger" onClick={stopQueue}>
            Stop
          </button>
        </span>
      </div>
    );
  }
  const { step, done, total } = adding.progress;
  return (
    <div className="fetch-pill" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span className="fetch-pill__text">
        <span>
          Fetching <strong>{adding.city}</strong>: {step}
          {total ? ` ${done ?? 0}/${total}` : ""}
        </span>
        {adding.queued && waiting > 0 && <span className="muted small">Background download · {waiting} more after this</span>}
        <span className="fetch-pill__bar" aria-hidden>
          <span style={total ? { width: `${Math.round(((done ?? 0) / total) * 100)}%` } : undefined} className={total ? "" : "is-indeterminate"} />
        </span>
      </span>
      <span className="fetch-pill__actions">
        <button className="link" onClick={cancelFetch} title={adding.queued ? "Skip this city" : "Stop fetching; nothing is saved"}>
          {adding.queued ? "Skip" : "Cancel"}
        </button>
        {adding.queued && (
          <button className="link danger" onClick={stopQueue} title="Stop the background download">
            Stop all
          </button>
        )}
      </span>
    </div>
  );
}

function Toast() {
  const { lastError, dismissError } = useStore();
  if (!lastError) return null;
  return (
    <div className="toast" role="alert">
      {lastError}
      <button className="link" onClick={dismissError}>
        Dismiss
      </button>
    </div>
  );
}
