/**
 * Live vector map. Offline: the city's local PMTiles pack (served by the shell
 * with byte ranges) styled with Protomaps' basemap and bundled fonts/sprites.
 * Online fallback: OpenFreeMap. Shows catalog places, the selected day's items
 * in order, and the route between them.
 */
import { layers, namedFlavor } from "@protomaps/basemaps";
import { allDays, CATEGORY_INFO, type BBox } from "@itinera/core";
import {
  addProtocol,
  Map as MlMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Let Vite build MapLibre's worker as a worker (in dev and in the bundle) instead of serving it as a page module.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { useEffect, useMemo, useRef, useState } from "react";
import { itemLabel, useStore } from "../state/store";

let protocolRegistered = false;
function registerPmtiles() {
  if (protocolRegistered) return;
  setWorkerUrl(maplibreWorkerUrl);
  addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function offlineStyle(url: string, dark: boolean): StyleSpecification {
  const flavor = dark ? "dark" : "light";
  const origin = window.location.origin;
  return {
    version: 8,
    glyphs: `${origin}/basemaps-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/basemaps-assets/sprites/v4/${flavor}`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${url}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers("protomaps", namedFlavor(flavor), { lang: "en" }),
  } as StyleSpecification;
}

const onlineStyle = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`;

/** Category → colour group for place dots. */
const GROUP_COLOURS: Record<string, string> = {
  culture: "#7c5cff",
  historical: "#c2410c",
  nature: "#15803d",
  romantic: "#db2777",
  other: "#475569",
};

function placeColour(category: keyof typeof CATEGORY_INFO): string {
  const t = CATEGORY_INFO[category].themes;
  if (category === "park" || category === "garden" || category === "zoo") return GROUP_COLOURS.nature!;
  if (t.includes("historical")) return GROUP_COLOURS.historical!;
  if (t.includes("culture")) return GROUP_COLOURS.culture!;
  if (t.includes("romantic")) return GROUP_COLOURS.romantic!;
  return GROUP_COLOURS.other!;
}

/** Space covered by floating panels, so fitting and centring keep content visible. */
export interface MapInset {
  left: number;
  bottom: number;
  right?: number;
}

export function MapPane({ inset }: { inset: MapInset }) {
  const { places, cities, tilePacks, tree, selectedDayId, selectedPlaceId, selectPlace, wishlist } = useStore();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const popup = useRef<Popup | null>(null);
  const [styleTick, setStyleTick] = useState(0);
  const city = tree ? cities.find((c) => c.id === tree.legs[0]?.leg.cityId) : cities[0];
  const pack = tilePacks.find((p) => city && p.region === city.name.toLowerCase()) ?? tilePacks[0];
  const [mode, setMode] = useState<"offline" | "online">(pack ? "offline" : "online");
  const dark = useMemo(prefersDark, []);
  const currentStyleKey = `${mode === "offline" && pack ? pack.url : "online"}|${dark}`;
  const styleKey = useRef<string | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    registerPmtiles();
    const bbox: BBox | undefined = city?.bbox;
    styleKey.current = currentStyleKey;
    const map = new MlMap({
      container: container.current,
      style: mode === "offline" && pack ? offlineStyle(pack.url, dark) : onlineStyle(dark),
      center: [0, 20],
      zoom: 1.5,
      maxPitch: 70,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl(), "bottom-right");
    // Padding first, so the city fits in the part of the map the panels don't cover.
    map.setPadding({ top: 0, left: inset.left, right: inset.right ?? 0, bottom: inset.bottom });
    if (bbox) map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 24, animate: false });
    map.on("style.load", () => setStyleTick((t) => t + 1));
    map.on("click", "places", (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") selectPlace(id);
    });
    map.on("mouseenter", "places", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "places", () => (map.getCanvas().style.cursor = ""));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; style changes go through setStyle below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the visible centre clear of the floating panels as they open and resize.
  useEffect(() => {
    const map = mapRef.current;
    const padding = { top: 0, left: inset.left, right: inset.right ?? 0, bottom: inset.bottom };
    const p = map?.getPadding();
    if (!map || !p || (p.left === padding.left && p.right === padding.right && p.bottom === padding.bottom)) return;
    map.easeTo({ padding, duration: 300 });
  }, [inset.left, inset.right, inset.bottom]);

  // Fit the trip's city when it changes (opening a trip elsewhere).
  const cityKey = city?.id;
  const fitted = useRef(cityKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !city || fitted.current === cityKey) return;
    fitted.current = cityKey;
    const [w, s, e, n] = city.bbox;
    map.fitBounds([w, s, e, n], { padding: 24, duration: 800 });
  }, [cityKey, city]);

  // Switch basemap source when the choice changes (not on the initial render).
  useEffect(() => {
    if (!mapRef.current || styleKey.current === currentStyleKey) return;
    styleKey.current = currentStyleKey;
    mapRef.current.setStyle(mode === "offline" && pack ? offlineStyle(pack.url, dark) : onlineStyle(dark));
  }, [currentStyleKey, mode, pack, dark]);

  const placesGeoJson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: [...places.values()].map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: { id: p.id, name: p.name, colour: placeColour(p.category), saved: wishlist.has(p.id) },
      })),
    }),
    [places, wishlist],
  );

  // The selected day's primary items, in order.
  const dayStops = useMemo(() => {
    if (!tree) return [];
    const day = allDays(tree).find((d) => d.day.id === selectedDayId) ?? allDays(tree)[0];
    if (!day) return [];
    return day.slots
      .flatMap((s) => s.items.filter((i) => i.isPrimary))
      .flatMap((i) => {
        const p = i.placeId ? places.get(i.placeId) : undefined;
        return p ? [{ item: i, place: p }] : [];
      });
  }, [tree, selectedDayId, places]);

  // (Re)install overlay layers whenever a style finishes loading.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleTick === 0) return;
    if (!map.getSource("places")) {
      map.addSource("places", { type: "geojson", data: placesGeoJson });
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: { "line-color": "#2563eb", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "places",
        type: "circle",
        source: "places",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7],
          "circle-color": ["get", "colour"],
          "circle-stroke-color": ["case", ["get", "saved"], "#facc15", "#ffffff"],
          "circle-stroke-width": ["case", ["get", "saved"], 2.5, 1.2],
        },
      });
      map.addLayer({
        id: "places-selected",
        type: "circle",
        source: "places",
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 11, "circle-color": "rgba(37,99,235,0.15)", "circle-stroke-color": "#2563eb", "circle-stroke-width": 2.5 },
      });
    }
  }, [styleTick, placesGeoJson]);

  useEffect(() => {
    (mapRef.current?.getSource("places") as GeoJSONSource | undefined)?.setData(placesGeoJson);
  }, [placesGeoJson, styleTick]);

  // Selected place: highlight, popup, and pan if it's off screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("places-selected")) return;
    map.setFilter("places-selected", ["==", ["get", "id"], selectedPlaceId ?? ""]);
    popup.current?.remove();
    const p = selectedPlaceId ? places.get(selectedPlaceId) : undefined;
    if (!p) return;
    popup.current = new Popup({ closeButton: false, offset: 12 }).setLngLat([p.lon, p.lat]).setText(p.name).addTo(map);
    if (!map.getBounds().contains([p.lon, p.lat])) map.easeTo({ center: [p.lon, p.lat] });
  }, [selectedPlaceId, places, styleTick]);

  // Day route and numbered stops.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features:
        dayStops.length > 1
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: dayStops.map((s) => [s.place.lon, s.place.lat]) } }]
          : [],
    });
    for (const m of markers.current) m.remove();
    markers.current = dayStops.map((s, i) => {
      const el = document.createElement("button");
      el.className = "stop-marker";
      el.textContent = String(i + 1);
      el.title = itemLabel(s.item, places);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectPlace(s.place.id);
      });
      return new Marker({ element: el }).setLngLat([s.place.lon, s.place.lat]).addTo(map);
    });
  }, [dayStops, places, selectPlace, styleTick]);

  return (
    <div className="map">
      <div ref={container} className="map__canvas" />
      <div className="map__controls" style={{ left: inset.left + 12, bottom: inset.bottom + 12 }}>
        <select
          className="pill-select"
          value={mode}
          onChange={(e) => setMode(e.target.value as "offline" | "online")}
          aria-label="Basemap"
          title={pack ? undefined : "No offline pack installed: run the tiles job (see README)."}
        >
          <option value="offline" disabled={!pack}>
            Offline map{pack ? ` · ${pack.region}` : " · none installed"}
          </option>
          <option value="online">Online map · OpenFreeMap</option>
        </select>
      </div>
    </div>
  );
}
