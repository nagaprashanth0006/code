import { useEffect, useState } from "react";
import { CatalogPane } from "./components/CatalogPane";
import { ItineraryPane } from "./components/ItineraryPane";
import { MapPane } from "./components/MapPane";
import { Onboarding } from "./components/Onboarding";
import { TripBar } from "./components/TripBar";
import { useStore } from "./state/store";

export type Layout = "desktop" | "tablet" | "phone";
type Pane = "catalog" | "plan" | "map";

/** Three panes on desktop, two on tablet (lists share a column), one on phone. */
const DESKTOP = window.matchMedia("(min-width: 1100px)");
const TABLET = window.matchMedia("(min-width: 700px)");

function useLayout(): Layout {
  const query = (): Layout => (DESKTOP.matches ? "desktop" : TABLET.matches ? "tablet" : "phone");
  const [layout, setLayout] = useState<Layout>(query);
  useEffect(() => {
    const onChange = () => setLayout(query());
    DESKTOP.addEventListener("change", onChange);
    TABLET.addEventListener("change", onChange);
    return () => {
      DESKTOP.removeEventListener("change", onChange);
      TABLET.removeEventListener("change", onChange);
    };
  }, []);
  return layout;
}

export function App() {
  const store = useStore();
  const layout = useLayout();
  const [pane, setPane] = useState<Pane>("plan");

  if (store.status.kind !== "ready") return <Onboarding />;

  // On phone one pane is visible; on tablet the map is always visible beside one list.
  const visible = (p: Pane) => {
    if (layout === "desktop") return true;
    if (layout === "tablet") return p === "map" || p === (pane === "map" ? "plan" : pane);
    return p === pane;
  };

  return (
    <div className={`app app--${layout}`}>
      <TripBar />
      {layout !== "desktop" && (
        <nav className="tabs" role="tablist" aria-label="Panes">
          {(layout === "phone" ? (["catalog", "plan", "map"] as const) : (["catalog", "plan"] as const)).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={visible(p) && (layout === "phone" || p !== "map")}
              className="tab"
              onClick={() => setPane(p)}
            >
              {p === "catalog" ? "Places" : p === "plan" ? "Plan" : "Map"}
            </button>
          ))}
        </nav>
      )}
      <main className="panes">
        <section className="pane pane--catalog" hidden={!visible("catalog")} aria-label="Places">
          <CatalogPane />
        </section>
        <section className="pane pane--plan" hidden={!visible("plan")} aria-label="Itinerary">
          <ItineraryPane />
        </section>
        <section className="pane pane--map" hidden={!visible("map")} aria-label="Map">
          <MapPane />
        </section>
      </main>
      {store.lastError && (
        <div className="toast" role="alert">
          {store.lastError}
          <button className="link" onClick={store.dismissError}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
