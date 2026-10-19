import { describe, expect, it } from "vitest";
import { fetchedLabel, freshness, newCacheEntry, planRefresh } from "../src/cache.js";
import { computeClimateNormals, monthClimate, summarizeWeather } from "../src/climate.js";
import { dateRange } from "../src/dates.js";
import { ulid, ulidTime } from "../src/ids.js";
import { canTransition, suggestedState, transition } from "../src/lifecycle.js";
import { allocateNights, orderCities, planTransfers } from "../src/multicity.js";
import {
  computePriceBands,
  estimateFlightFare,
  flightSearchUrl,
  formatPriceRange,
  hotelSearchUrl,
  priceRangeFor,
} from "../src/prices.js";
import type { City, PriceObservation, Trip } from "../src/schemas.js";
import { buildLanding, DEFAULT_LANDING_CONFIG, rankDestinations, reachability, seasonFit } from "../src/scoring.js";

describe("ULIDs", () => {
  it("are 26 chars, time-sortable and decodable", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(ulidTime(a)).toBe(1_700_000_000_000);
  });
});

describe("climate normals", () => {
  // Synthetic 3-year history: highs follow a sine wave, rain every 4th day.
  const time = dateRange("2021-01-01", "2023-12-31");
  const doy = (i: number) => (i % 365) + 1;
  const history = {
    time,
    tmax: time.map((_, i) => 20 + 10 * Math.sin(((doy(i) - 100) / 365) * 2 * Math.PI)),
    tmin: time.map((_, i) => 10 + 8 * Math.sin(((doy(i) - 100) / 365) * 2 * Math.PI)),
    precip: time.map((_, i) => (i % 4 === 0 ? 5 : 0)),
  };
  const normals = computeClimateNormals("c", history);

  it("covers the whole year with ordered percentiles", () => {
    expect(normals).toHaveLength(366);
    for (const n of normals) {
      expect(n.tmaxP10).toBeLessThanOrEqual(n.tmaxP50);
      expect(n.tmaxP50).toBeLessThanOrEqual(n.tmaxP90);
    }
  });

  it("summarizes a leg's dates and a month", () => {
    const july = monthClimate(normals, 7)!;
    const jan = monthClimate(normals, 1)!;
    expect(july.highC).toBeGreaterThan(jan.highC);
    expect(july.days).toBe(31);
    expect(july.rainDays).toBeCloseTo(31 / 4, 0);
    const leg = summarizeWeather(normals, "2026-07-10", "2026-07-12")!;
    expect(leg.days).toBe(3);
    expect(leg.precipMm).toBeCloseTo(3 * 1.25, 0);
  });
});

describe("price bands", () => {
  const obs = (month: number, price: number, i: number): PriceObservation => ({
    id: `o${month}-${i}`,
    kind: "stay",
    key: "lisbon",
    travelDate: `2026-${String(month).padStart(2, "0")}-10`,
    price,
    currency: "INR",
    source: "logged",
    observedAt: `2025-${String(month).padStart(2, "0")}-01T00:00:00Z`,
  });
  const julyObs = Array.from({ length: 10 }, (_, i) => obs(7, 6000 + i * 200, i));
  const marchObs = Array.from({ length: 3 }, (_, i) => obs(3, 4000 + i * 100, i));
  const bands = computePriceBands([...julyObs, ...marchObs]);

  it("uses a month band when the month has enough observations", () => {
    const r = priceRangeFor(bands, "stay", "lisbon", 7)!;
    expect(r.basis).toBe("month");
    expect(r.n).toBe(10);
    expect(r.low).toBeCloseTo(6180);
    expect(r.high).toBeCloseTo(7620);
  });

  it("falls back to the annual band × seasonal multiplier", () => {
    const r = priceRangeFor(bands, "stay", "lisbon", 3)!;
    expect(r.basis).toBe("annual-seasonal");
    expect(r.n).toBe(13);
    expect(priceRangeFor(bands, "stay", "porto", 3)).toBeNull();
  });

  it("always shows provenance", () => {
    const r = priceRangeFor(bands, "stay", "lisbon", 7)!;
    expect(formatPriceRange(r)).toBe("₹6,180–7,620 · 10 observations · Jul 2025");
    expect(formatPriceRange(estimateFlightFare(8000, 7), "en-US")).toMatch(/estimate/);
  });

  it("builds prefilled deep links", () => {
    expect(flightSearchUrl("Mumbai", "Lisbon", "2026-11-01")).toContain("Flights%20from%20Mumbai%20to%20Lisbon");
    expect(hotelSearchUrl("Lisbon", "2026-11-01", "2026-11-04")).toContain("checkin=2026-11-01");
  });
});

describe("destination scoring", () => {
  const city = (id: string, lat: number, lon: number, themeTags: City["themeTags"]): City => ({
    id,
    countryId: "x",
    name: id,
    lat,
    lon,
    bbox: [lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1],
    themeTags,
    osmRelationId: null,
    wikidata: null,
    source: "test",
    fetchedAt: "2026-01-01T00:00:00Z",
  });
  const home = city("mumbai", 19.07, 72.88, []);
  const lisbon = city("lisbon", 38.72, -9.14, ["historical", "romantic"]);
  const goa = city("goa", 15.5, 73.83, ["nature", "romantic"]);

  it("scores with explainable factors in (0, 1]", () => {
    expect(seasonFit({ days: 30, lowC: 15, highC: 22, coldC: 10, warmC: 28, rainDays: 0, precipMm: 0 })).toBe(1);
    expect(reachability(60, true)).toBe(1);
    expect(reachability(24 * 60, false)).toBeLessThan(0.3);
    const ranked = rankDestinations([home, lisbon, goa], "romantic", "2026-10-19", {
      home,
      normalsByCity: new Map(),
      routes: [],
    });
    expect(ranked.map((r) => r.cityId)).toEqual(["goa", "lisbon"]); // closer wins with equal theme fit
    for (const f of Object.values(ranked[0]!.factors)) expect(f).toBeGreaterThan(0);
  });

  it("builds config-driven landing rows", () => {
    const rows = buildLanding(DEFAULT_LANDING_CONFIG, [home, lisbon, goa], "2026-10-19", {
      home,
      normalsByCity: new Map(),
      routes: [],
    });
    expect(rows.map((r) => r.row.id)).toEqual(["romantic", "solo", "adventure", "nature", "historical", "culture"]);
    expect(rows.find((r) => r.row.id === "historical")!.destinations[0]!.cityId).toBe("lisbon");
  });
});

describe("multi-city", () => {
  const lisbon = { id: "lisbon", lat: 38.72, lon: -9.14 };
  const porto = { id: "porto", lat: 41.15, lon: -8.61 };
  const coimbra = { id: "coimbra", lat: 40.21, lon: -8.43 };
  const faro = { id: "faro", lat: 37.02, lon: -7.93 };

  it("orders cities without zig-zagging", () => {
    // Open path from Lisbon: south to Faro first, then north via Coimbra to Porto.
    const open = orderCities(lisbon, [porto, faro, coimbra], { returnToOrigin: false });
    expect(open.order.map((c) => c.id)).toEqual(["faro", "coimbra", "porto"]);
    // A round trip never bounces Faro ↔ Porto: Coimbra and Porto stay adjacent.
    const ids = orderCities(lisbon, [porto, faro, coimbra]).order.map((c) => c.id);
    expect(Math.abs(ids.indexOf("coimbra") - ids.indexOf("porto"))).toBe(1);
  });

  it("allocates nights with minimums and proportional extras", () => {
    const { nights, warning } = allocateNights(
      [
        { cityId: "lisbon", savedPlaces: 20 },
        { cityId: "coimbra", savedPlaces: 2, isStopover: true },
        { cityId: "porto", savedPlaces: 12 },
      ],
      9,
    );
    expect(warning).toBeNull();
    expect(nights.get("coimbra")).toBe(1);
    expect([...nights.values()].reduce((a, b) => a + b, 0)).toBe(9);
    expect(nights.get("lisbon")!).toBeGreaterThan(nights.get("porto")!);
    expect(allocateNights([{ cityId: "a", savedPlaces: 1 }, { cityId: "b", savedPlaces: 1 }], 3).warning).toMatch(/at least 4/);
  });

  it("estimates transfers, preferring known routes", () => {
    const t = planTransfers([lisbon, porto], [{ fromCityId: "lisbon", toCityId: "porto", mode: "rail", typicalMinutes: 175, direct: true }]);
    expect(t[0]).toMatchObject({ mode: "rail", minutes: 175, estimated: false });
    expect(planTransfers([lisbon, faro], [])[0]).toMatchObject({ mode: "rail", estimated: true });
  });
});

describe("trip lifecycle", () => {
  const trip: Trip = {
    id: "t",
    name: "Lisbon",
    originCityId: null,
    state: "wishlist",
    startDate: null,
    endDate: null,
    createdAt: "2026-10-19T00:00:00Z",
  };
  const ctx = { legCount: 1, today: "2026-10-19" };

  it("moves forward through guarded states", () => {
    const idea = transition(trip, "idea", ctx);
    expect(canTransition(idea, "planning", ctx)).toEqual({ ok: false, reason: "Set the trip dates first." });
    const dated = { ...idea, startDate: "2026-10-19", endDate: "2026-10-22" };
    const ready = transition(transition(dated, "planning", ctx), "ready", ctx);
    expect(canTransition(ready, "done", ctx).ok).toBe(false);
    expect(suggestedState(ready, "2026-10-20")).toBe("on_trip");
    expect(canTransition(trip, "idea", { ...ctx, legCount: 0 }).ok).toBe(false);
  });
});

describe("cache policy", () => {
  const now = new Date("2026-10-19T00:00:00Z");
  it("marks entries stale past their TTL and plans the most overdue first", () => {
    const hours = { ...newCacheEntry("hours", "lisbon", new Date("2026-10-01T00:00:00Z")) };
    const places = { ...newCacheEntry("places", "lisbon", new Date("2026-10-01T00:00:00Z")) };
    const geocode = newCacheEntry("geocode", "lisbon", new Date("2020-01-01T00:00:00Z"));
    expect(freshness(hours, now).stale).toBe(true);
    expect(freshness(places, now).stale).toBe(false);
    expect(freshness(geocode, now).stale).toBe(false);
    expect(planRefresh([places, hours, geocode], now).map((e) => e.key)).toEqual(["hours:lisbon"]);
    expect(fetchedLabel(hours, now)).toBe("Fetched 1 Oct 2026 · stale");
  });
});
