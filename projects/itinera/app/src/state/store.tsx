/**
 * App state: the catalog, the active trip tree and selection. Edits go through
 * the core's pure tree operations; the rows that changed are persisted, and the
 * constraint checker re-runs on every change.
 */
import {
  addItem,
  addLeg as addLegOp,
  allocateTripNights,
  checkTrip,
  createSingleLegTrip,
  destinationIndex,
  diffItems,
  geocodeCity,
  HOME_CITY_SETTING,
  homeCityFrom,
  ingestCity,
  LANDING_CONFIG_SETTING,
  landingConfigFrom,
  layoutLegs,
  legOfDay,
  MIN_NIGHTS,
  migrate,
  moveItem,
  moveLeg as moveLegOp,
  removeItem,
  removeLeg as removeLegOp,
  reorderLegs,
  Repo,
  setLegNights,
  setLegStopover,
  suggestLegOrder,
  swapAlternate,
  transferEstimator,
  ulid,
  updateItem,
  updateTransfer,
  type CacheEntry,
  type CheckPlace,
  type City,
  type ClimateNormal,
  type Country,
  type Destination,
  type HomeCity,
  type IngestProgress,
  type Item,
  type LandingConfig,
  type LayoutResult,
  type LegTree,
  type Place,
  type Transfer,
  type Trip,
  type TripCheckResult,
  type TripTree,
} from "@itinera/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPlatform, type LocalTilePack, type Platform } from "../platform";

export type Status = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

export interface Store {
  status: Status;
  platform: Platform | null;
  /** The curated destination index bundled with the app. */
  destinations: Destination[];
  countries: Country[];
  cities: City[];
  places: Map<string, Place>;
  normals: Map<string, ClimateNormal[]>;
  cacheEntries: CacheEntry[];
  tilePacks: LocalTilePack[];
  wishlist: Set<string>;
  trips: Trip[];
  /** City ids of each trip's legs, in order. */
  tripCities: Map<string, string[]>;
  tree: TripTree | null;
  check: TripCheckResult | null;
  selectedPlaceId: string | null;
  selectedDayId: string | null;
  /** The leg of the selected day (the first leg when none is selected). */
  selectedLeg: LegTree | null;
  targetSlotId: string | null;
  lastError: string | null;
  /** Asked once; ranks landing destinations by travel time from here. */
  home: HomeCity | null;
  landingConfig: LandingConfig;
  /** A city being added from the hub while the rest of the app stays usable. */
  adding: { city: string; progress: IngestProgress } | null;

  /** Fetches a city's places, photos and weather; resolves to the city, or null on failure. */
  addCity(name: string): Promise<City | null>;
  setHome(name: string): Promise<void>;
  createTrip(input: { name: string; cityId: string; startDate: string; endDate: string }): Promise<void>;
  openTrip(id: string): Promise<void>;
  /** Adds a city as the last stop of a trip (opening that trip). */
  addLeg(tripId: string, cityId: string): Promise<void>;
  removeLeg(legId: string): Promise<void>;
  moveLeg(legId: string, toIndex: number): Promise<void>;
  /** Reorders legs to avoid zig-zagging; resolves to false when the order was already best. */
  suggestOrder(): Promise<boolean>;
  setNights(nights: ReadonlyMap<string, number>): Promise<void>;
  setStopover(legId: string, isStopover: boolean): Promise<void>;
  /** Nights per leg for a trip of `total` nights, from saved and planned places. */
  proposeNights(total: number): { nights: Map<string, number>; warning: string | null } | null;
  setTransfer(transferId: string, patch: Partial<Pick<Transfer, "mode" | "estMinutes">>): Promise<void>;
  setStartDate(date: string): Promise<void>;
  selectLeg(legId: string): void;
  cityName(cityId: string): string;
  deleteTrip(id: string): Promise<void>;
  addPlace(placeId: string, slotId?: string, asAlternate?: boolean): Promise<void>;
  move(itemId: string, toSlotId: string, toIndex: number): Promise<void>;
  remove(itemId: string): Promise<void>;
  swap(alternateId: string, primaryId: string): Promise<void>;
  setDuration(itemId: string, minutes: number | null): Promise<void>;
  toggleWishlist(placeId: string): Promise<void>;
  selectPlace(id: string | null): void;
  selectDay(id: string | null): void;
  setTargetSlot(id: string | null): void;
  /** Shows a message in the toast. */
  notify(message: string): void;
  dismissError(): void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/**
 * Opens the platform and migrates once per page load. React's StrictMode runs
 * effects twice in development, and two interleaved migrations on a pooled
 * connection would both try to create the schema.
 */
let platformReady: Promise<Platform> | null = null;
function initPlatform(): Promise<Platform> {
  platformReady ??= createPlatform().then(async (p) => {
    await migrate(p.db);
    return p;
  });
  return platformReady;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [platform, setPlatform] = useState<Platform | null>(null);
  const repoRef = useRef<Repo | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [places, setPlaces] = useState<Map<string, Place>>(new Map());
  const [normals, setNormals] = useState<Map<string, ClimateNormal[]>>(new Map());
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [tilePacks, setTilePacks] = useState<LocalTilePack[]>([]);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripCities, setTripCities] = useState<Map<string, string[]>>(new Map());
  const [tree, setTree] = useState<TripTree | null>(null);
  const treeRef = useRef<TripTree | null>(null);
  const [selectedPlaceId, selectPlace] = useState<string | null>(null);
  const [selectedDayId, selectDay] = useState<string | null>(null);
  const [targetSlotId, setTargetSlot] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [home, setHomeState] = useState<HomeCity | null>(null);
  const [landingConfig, setLandingConfig] = useState<LandingConfig>(() => landingConfigFrom(null));
  const [adding, setAdding] = useState<Store["adding"]>(null);

  const repo = () => {
    if (!repoRef.current) throw new Error("Database not ready");
    return repoRef.current;
  };

  const showTree = useCallback((t: TripTree | null) => {
    treeRef.current = t;
    setTree(t);
  }, []);

  const loadCatalog = useCallback(async () => {
    const r = repo();
    const [cs, cts, wl, ts, tc, ce, homeRaw, landingRaw] = await Promise.all([
      r.listCountries(),
      r.listCities(),
      r.listWishlist(),
      r.listTrips(),
      r.tripCities(),
      r.listCacheEntries(),
      r.getSetting(HOME_CITY_SETTING),
      r.getSetting(LANDING_CONFIG_SETTING),
    ]);
    const placeMap = new Map<string, Place>();
    const normalMap = new Map<string, ClimateNormal[]>();
    for (const c of cts) {
      for (const p of await r.placesByCity(c.id)) placeMap.set(p.id, p);
      normalMap.set(c.id, await r.climateNormals(c.id));
    }
    setCountries(cs);
    setCities(cts);
    setPlaces(placeMap);
    setNormals(normalMap);
    setWishlist(new Set(wl.map((w) => w.placeId)));
    setTrips(ts);
    setTripCities(tc);
    setCacheEntries(ce);
    setHomeState(homeCityFrom(homeRaw));
    setLandingConfig(landingConfigFrom(landingRaw));
    return { cities: cts, trips: ts };
  }, []);

  const openTrip = useCallback(
    async (id: string) => {
      const t = await repo().loadTripTree(id);
      showTree(t);
      const firstDay = t?.legs[0]?.days[0];
      selectDay(firstDay?.day.id ?? null);
      setTargetSlot(firstDay?.slots[0]?.slot.id ?? null);
      await repo().setSetting("lastTripId", id);
    },
    [showTree],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await initPlatform();
        if (cancelled) return;
        repoRef.current = new Repo(p.db);
        setPlatform(p);
        setTilePacks(await p.tilePacks().catch(() => []));
        // The hub works from the bundled destination index, so no city has to be fetched first.
        const { trips: ts } = await loadCatalog();
        const last = await repo().getSetting("lastTripId");
        const tripId = ts.find((t) => t.id === last)?.id ?? ts[0]?.id;
        if (tripId) await openTrip(tripId);
        setStatus({ kind: "ready" });
      } catch (e) {
        console.error(e);
        setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCatalog, openTrip]);

  /** Applies a pure tree edit, persists the changed rows, and rolls back on failure. */
  const edit = useCallback(
    async (fn: (t: TripTree) => TripTree) => {
      const before = treeRef.current;
      if (!before) return;
      let after: TripTree;
      try {
        after = fn(before);
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
        return;
      }
      showTree(after);
      try {
        const { upserts, deletes } = diffItems(before, after);
        await repo().upsertItems(upserts);
        await repo().deleteItems(deletes);
      } catch (e) {
        showTree(before);
        setLastError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [showTree],
  );

  const checkPlaces = useMemo(() => {
    const m = new Map<string, CheckPlace>();
    for (const p of places.values()) m.set(p.id, p);
    return m;
  }, [places]);

  const cityNames = useMemo(() => new Map(cities.map((c) => [c.id, c.name])), [cities]);
  const cityName = useCallback((id: string) => cityNames.get(id) ?? "Unknown city", [cityNames]);
  const estimate = useMemo(() => transferEstimator(cities.map((c) => ({ id: c.id, lat: c.lat, lon: c.lon }))), [cities]);

  const check = useMemo(
    () => (tree ? checkTrip(tree, checkPlaces, undefined, (id) => cityNames.get(id)) : null),
    [tree, checkPlaces, cityNames],
  );

  const selectedLeg = useMemo(
    () => (tree ? (selectedDayId ? legOfDay(tree, selectedDayId) : undefined) ?? tree.legs[0] ?? null : null),
    [tree, selectedDayId],
  );

  const refreshTrips = useCallback(async () => {
    setTrips(await repo().listTrips());
    setTripCities(await repo().tripCities());
  }, []);

  const selectLeg = useCallback((legId: string) => {
    const leg = treeRef.current?.legs.find((l) => l.leg.id === legId);
    const day = leg?.days[0];
    if (!day) return;
    selectDay(day.day.id);
    setTargetSlot(day.slots[0]?.slot.id ?? null);
  }, []);

  const movedNote = (moved: number) =>
    moved > 0 ? `${moved} planned place${moved === 1 ? "" : "s"} moved to the last remaining day of ${moved === 1 ? "its" : "their"} stop.` : null;

  /**
   * Applies a structural edit (legs, nights, transfers, dates): the whole trip
   * is saved, days that went away are deleted, and the selection stays valid.
   */
  const restructure = useCallback(
    async (fn: (t: TripTree) => LayoutResult | TripTree) => {
      const before = treeRef.current;
      if (!before) return;
      let after: TripTree;
      let moved = 0;
      try {
        const r = fn(before);
        if ("moved" in r) {
          after = r.tree;
          moved = r.moved;
        } else after = r;
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
        return;
      }
      showTree(after);
      const days = after.legs.flatMap((l) => l.days);
      if (!days.some((d) => d.day.id === selectedDayId)) {
        selectDay(days[0]?.day.id ?? null);
        setTargetSlot(days[0]?.slots[0]?.slot.id ?? null);
      } else if (targetSlotId && !days.some((d) => d.slots.some((s) => s.slot.id === targetSlotId))) {
        setTargetSlot(days.find((d) => d.day.id === selectedDayId)?.slots[0]?.slot.id ?? null);
      }
      try {
        await repo().replaceTripTree(after);
        await refreshTrips();
        const note = movedNote(moved);
        if (note) setLastError(note);
      } catch (e) {
        showTree(before);
        setLastError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [showTree, refreshTrips, selectedDayId, targetSlotId],
  );

  const store: Store = {
    status,
    platform,
    destinations: destinationIndex(),
    countries,
    cities,
    places,
    normals,
    cacheEntries,
    tilePacks,
    wishlist,
    trips,
    tripCities,
    tree,
    check,
    selectedPlaceId,
    selectedDayId,
    selectedLeg,
    targetSlotId,
    lastError,
    home,
    landingConfig,
    adding,

    async addCity(name) {
      if (!platform || adding) return null;
      setAdding({ city: name, progress: { step: "Starting" } });
      try {
        const result = await ingestCity(
          {
            fetch: platform.fetch,
            repo: repo(),
            files: platform.files,
            onProgress: (progress) => setAdding({ city: name, progress }),
            onWarning: (message) => console.warn(message),
          },
          name,
        );
        await loadCatalog();
        return result.city;
      } catch (e) {
        console.error(e);
        setLastError(`Fetching ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      } finally {
        setAdding(null);
      }
    },

    async setHome(name) {
      const wanted = name.trim().toLowerCase();
      if (!wanted) return;
      try {
        // A fetched city or an indexed destination needs no lookup, so this also works offline.
        const known = cities.find((c) => c.name.toLowerCase() === wanted);
        const country = known && countries.find((c) => c.id === known.countryId);
        const indexed = destinationIndex().find((d) => d.name.toLowerCase() === wanted);
        let next: HomeCity;
        if (known && country) {
          next = { name: known.name, countryCode: country.isoCode, lat: known.lat, lon: known.lon };
        } else if (indexed) {
          next = { name: indexed.name, countryCode: indexed.countryCode, lat: indexed.lat, lon: indexed.lon };
        } else {
          if (!platform) return;
          const geo = await geocodeCity(platform.fetch, name.trim());
          next = { name: geo.name, countryCode: geo.countryCode, lat: geo.lat, lon: geo.lon };
        }
        await repo().setSetting(HOME_CITY_SETTING, JSON.stringify(next));
        setHomeState(next);
      } catch (e) {
        setLastError(`Couldn't find ${name.trim()}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    async createTrip(input) {
      const t = createSingleLegTrip(input);
      await repo().saveTripTree(t);
      await refreshTrips();
      await openTrip(t.trip.id);
    },

    openTrip,

    async addLeg(tripId, cityId) {
      try {
        const base = treeRef.current?.trip.id === tripId ? treeRef.current : await repo().loadTripTree(tripId);
        if (!base) throw new Error("That trip no longer exists");
        const { tree: after } = addLegOp(base, { cityId, nights: MIN_NIGHTS }, estimate);
        await repo().replaceTripTree(after);
        await refreshTrips();
        await openTrip(tripId);
        const added = after.legs[after.legs.length - 1]!;
        selectDay(added.days[0]?.day.id ?? null);
        setTargetSlot(added.days[0]?.slots[0]?.slot.id ?? null);
      } catch (e) {
        setLastError(`Couldn't add the stop: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    removeLeg: (legId) => restructure((t) => removeLegOp(t, legId, estimate)),
    moveLeg: (legId, toIndex) => restructure((t) => moveLegOp(t, legId, toIndex, estimate)),

    async suggestOrder() {
      const t = treeRef.current;
      if (!t || t.legs.length < 2) return false;
      const positions = new Map(cities.map((c) => [c.id, { lat: c.lat, lon: c.lon }]));
      const order = suggestLegOrder(t, positions, home ? { lat: home.lat, lon: home.lon } : null);
      if (order.every((id, i) => t.legs[i]?.leg.id === id)) return false;
      await restructure((x) => reorderLegs(x, order, estimate));
      return true;
    },

    setNights: (nights) => restructure((t) => setLegNights(t, nights, estimate)),
    setStopover: (legId, isStopover) => restructure((t) => setLegStopover(t, legId, isStopover)),

    proposeNights(total) {
      const t = tree;
      if (!t) return null;
      return allocateTripNights(t, total, (legId, cityId) => {
        const ids = new Set<string>();
        for (const id of wishlist) if (places.get(id)?.cityId === cityId) ids.add(id);
        const leg = t.legs.find((l) => l.leg.id === legId);
        for (const d of leg?.days ?? []) for (const s of d.slots) for (const i of s.items) if (i.placeId) ids.add(i.placeId);
        return ids.size;
      });
    },

    setTransfer: (transferId, patch) => restructure((t) => updateTransfer(t, transferId, patch)),
    setStartDate: (date) => restructure((t) => layoutLegs(t, estimate, date)),
    selectLeg,
    cityName,

    async deleteTrip(id) {
      await repo().deleteTrip(id);
      const ts = await repo().listTrips();
      setTrips(ts);
      if (treeRef.current?.trip.id === id) {
        if (ts[0]) await openTrip(ts[0].id);
        else showTree(null);
      }
    },

    async addPlace(placeId, slotId, asAlternate = false) {
      const target = slotId ?? targetSlotId;
      if (!target) {
        setLastError("Pick a slot in the plan first.");
        return;
      }
      await edit((t) => addItem(t, target, { placeId, isPrimary: !asAlternate }).tree);
    },

    move: (itemId, toSlotId, toIndex) => edit((t) => moveItem(t, itemId, toSlotId, toIndex)),
    remove: (itemId) => edit((t) => removeItem(t, itemId)),
    swap: (alternateId, primaryId) => edit((t) => swapAlternate(t, alternateId, primaryId)),
    setDuration: (itemId, minutes) => edit((t) => updateItem(t, itemId, { durationMin: minutes })),

    async toggleWishlist(placeId) {
      if (wishlist.has(placeId)) await repo().removeFromWishlist(placeId);
      else await repo().addToWishlist({ id: ulid(), placeId, savedAt: new Date().toISOString(), note: null });
      setWishlist(new Set((await repo().listWishlist()).map((w) => w.placeId)));
    },

    selectPlace,
    selectDay,
    // Picking a slot also selects its day, so the map follows to that day's stop.
    setTargetSlot(id) {
      setTargetSlot(id);
      const day = id ? treeRef.current?.legs.flatMap((l) => l.days).find((d) => d.slots.some((s) => s.slot.id === id)) : undefined;
      if (day) selectDay(day.day.id);
    },
    notify: setLastError,
    dismissError: () => setLastError(null),
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function itemLabel(item: Item, places: Map<string, Place>): string {
  return (item.placeId ? places.get(item.placeId)?.name : null) ?? item.customName ?? "Untitled";
}
