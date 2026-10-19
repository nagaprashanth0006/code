/**
 * App state: the catalog, the active trip tree and selection. Edits go through
 * the core's pure tree operations; the rows that changed are persisted, and the
 * constraint checker re-runs on every change.
 */
import {
  addItem,
  checkTrip,
  createSingleLegTrip,
  diffItems,
  ingestCity,
  migrate,
  moveItem,
  removeItem,
  Repo,
  swapAlternate,
  ulid,
  updateItem,
  type CacheEntry,
  type CheckPlace,
  type City,
  type ClimateNormal,
  type Country,
  type IngestProgress,
  type Item,
  type Place,
  type Trip,
  type TripCheckResult,
  type TripTree,
} from "@itinera/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPlatform, type LocalTilePack, type Platform } from "../platform";

export type Status =
  | { kind: "loading" }
  | { kind: "needs-data" }
  | { kind: "ingesting"; progress: IngestProgress }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export interface Store {
  status: Status;
  platform: Platform | null;
  countries: Country[];
  cities: City[];
  places: Map<string, Place>;
  normals: Map<string, ClimateNormal[]>;
  cacheEntries: CacheEntry[];
  tilePacks: LocalTilePack[];
  wishlist: Set<string>;
  trips: Trip[];
  tree: TripTree | null;
  check: TripCheckResult | null;
  selectedPlaceId: string | null;
  selectedDayId: string | null;
  targetSlotId: string | null;
  lastError: string | null;

  ingest(city: string): Promise<void>;
  createTrip(input: { name: string; cityId: string; startDate: string; endDate: string }): Promise<void>;
  openTrip(id: string): Promise<void>;
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
  dismissError(): void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

export const DEFAULT_CITY = "Lisbon";

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
  const [tree, setTree] = useState<TripTree | null>(null);
  const treeRef = useRef<TripTree | null>(null);
  const [selectedPlaceId, selectPlace] = useState<string | null>(null);
  const [selectedDayId, selectDay] = useState<string | null>(null);
  const [targetSlotId, setTargetSlot] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

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
    const [cs, cts, wl, ts, ce] = await Promise.all([
      r.listCountries(),
      r.listCities(),
      r.listWishlist(),
      r.listTrips(),
      r.listCacheEntries(),
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
    setCacheEntries(ce);
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
        const { cities: cts, trips: ts } = await loadCatalog();
        if (cts.length === 0) {
          setStatus({ kind: "needs-data" });
          return;
        }
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

  const check = useMemo(() => (tree ? checkTrip(tree, checkPlaces) : null), [tree, checkPlaces]);

  const store: Store = {
    status,
    platform,
    countries,
    cities,
    places,
    normals,
    cacheEntries,
    tilePacks,
    wishlist,
    trips,
    tree,
    check,
    selectedPlaceId,
    selectedDayId,
    targetSlotId,
    lastError,

    async ingest(city) {
      if (!platform) return;
      setStatus({ kind: "ingesting", progress: { step: "Starting" } });
      try {
        await ingestCity(
          {
            fetch: platform.fetch,
            repo: repo(),
            files: platform.files,
            onProgress: (progress) => setStatus({ kind: "ingesting", progress }),
            onWarning: (message) => console.warn(message),
          },
          city,
        );
        await loadCatalog();
        setStatus({ kind: "ready" });
      } catch (e) {
        console.error(e);
        setStatus({ kind: "error", message: `Fetching ${city} failed: ${e instanceof Error ? e.message : String(e)}` });
      }
    },

    async createTrip(input) {
      const t = createSingleLegTrip(input);
      await repo().saveTripTree(t);
      setTrips(await repo().listTrips());
      await openTrip(t.trip.id);
    },

    openTrip,

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
    setTargetSlot,
    dismissError: () => setLastError(null),
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function itemLabel(item: Item, places: Map<string, Place>): string {
  return (item.placeId ? places.get(item.placeId)?.name : null) ?? item.customName ?? "Untitled";
}
