/**
 * Explore's map: every destination that passes the filters, clustered when
 * zoomed out, with home marked. It follows the list: hovering a card lights
 * up its dot, hovering a dot lights up its card, and a dot's popup opens the
 * destination. Uses the online basemap; city tile packs are too local for a
 * world view.
 */
import { LngLatBounds, Map as MlMap, NavigationControl, Popup, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { onlineStyle, registerPmtiles } from "./MapPane";
import { useDark } from "./theme";

export interface MapItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Places, hours and photos are on this device. */
  ready: boolean;
  /** One line under the name in the popup, e.g. "Best in Jan · 1,240 km". */
  detail: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function ExploreMap({
  items,
  home,
  hoveredId,
  onHover,
  onOpen,
}: {
  items: MapItem[];
  home: { lat: number; lon: number; name: string } | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [styleTick, setStyleTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const dark = useDark();
  // Handlers change every render; the map's listeners read the latest through refs.
  const handlers = useRef({ onHover, onOpen });
  handlers.current = { onHover, onOpen };

  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: items.map((d) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [d.lon, d.lat] },
        properties: { id: d.id, name: d.name, ready: d.ready, detail: d.detail },
      })),
    }),
    [items],
  );

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    registerPmtiles();
    const map = new MlMap({
      container: container.current,
      style: onlineStyle(dark),
      center: [home?.lon ?? 40, home?.lat ?? 20],
      zoom: 1.6,
      attributionControl: { compact: true },
      renderWorldCopies: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("style.load", () => setStyleTick((t) => t + 1));
    map.on("error", (e) => {
      // A style or tile that can't be fetched (offline) leaves an empty map; say so.
      if (!map.isStyleLoaded() && /Failed to fetch|NetworkError|status/i.test(String(e.error?.message ?? ""))) setFailed(true);
    });
    const popup = new Popup({ closeButton: false, offset: 10, className: "explore-popup" });
    map.on("click", "dest-clusters", async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const src = map.getSource("dest") as GeoJSONSource | undefined;
      if (!f || !src) return;
      const zoom = await src.getClusterExpansionZoom(f.properties?.cluster_id as number);
      map.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom });
    });
    map.on("click", "dest", (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>${esc(String(p.name))}</strong><span>${esc(String(p.detail))}</span><button class="link" type="button">Open</button>`,
        )
        .addTo(map);
      popup.getElement()?.querySelector("button")?.addEventListener("click", () => handlers.current.onOpen(String(p.id)));
    });
    for (const layer of ["dest", "dest-clusters"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("mousemove", "dest", (e: MapLayerMouseEvent) => handlers.current.onHover(String(e.features?.[0]?.properties?.id ?? "") || null));
    map.on("mouseleave", "dest", () => handlers.current.onHover(null));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Created once; theme changes go through setStyle below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styleDark = useRef(dark);
  useEffect(() => {
    if (!mapRef.current || styleDark.current === dark) return;
    styleDark.current = dark;
    mapRef.current.setStyle(onlineStyle(dark));
  }, [dark]);

  // Layers go back in after every style load (setStyle drops them).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleTick === 0 || map.getSource("dest")) return;
    const accent = dark ? "#3fd0a8" : "#0e7c66";
    map.addSource("dest", { type: "geojson", data, cluster: true, clusterRadius: 36, clusterMaxZoom: 6 });
    map.addSource("home", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "dest-clusters",
      type: "circle",
      source: "dest",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": accent,
        "circle-opacity": 0.85,
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 30, 24],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "dest-count",
      type: "symbol",
      source: "dest",
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Regular"] },
      paint: { "text-color": dark ? "#052219" : "#ffffff" },
    });
    map.addLayer({
      id: "dest",
      type: "circle",
      source: "dest",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["case", ["get", "ready"], "#22c55e", accent],
        "circle-radius": 6,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      },
    });
    map.addLayer({
      id: "dest-hover",
      type: "circle",
      source: "dest",
      filter: ["==", ["get", "id"], ""],
      paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": accent, "circle-stroke-width": 3 },
    });
    map.addLayer({
      id: "home",
      type: "circle",
      source: "home",
      paint: { "circle-radius": 7, "circle-color": "#f59e0b", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleTick]);

  useEffect(() => {
    (mapRef.current?.getSource("dest") as GeoJSONSource | undefined)?.setData(data);
  }, [data, styleTick]);

  useEffect(() => {
    (mapRef.current?.getSource("home") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: home ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [home.lon, home.lat] } }] : [],
    });
  }, [home, styleTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("dest-hover")) map.setFilter("dest-hover", ["==", ["get", "id"], hoveredId ?? ""]);
  }, [hoveredId, styleTick]);

  // Frame the results whenever the filtered set changes.
  const key = items.map((i) => i.id).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || items.length === 0) return;
    const b = new LngLatBounds();
    for (const i of items) b.extend([i.lon, i.lat]);
    map.fitBounds(b, { padding: 48, maxZoom: 7, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="explore-map">
      <div ref={container} className="explore-map__canvas" />
      <div className="explore-map__legend small" aria-hidden>
        <span>
          <i className="dot dot--ready" /> Offline ready
        </span>
        <span>
          <i className="dot dot--accent" /> Not yet
        </span>
        {home && (
          <span>
            <i className="dot dot--home" /> {home.name}
          </span>
        )}
      </div>
      {failed && <p className="explore-map__note small">The map needs a connection; the list works offline.</p>}
    </div>
  );
}
