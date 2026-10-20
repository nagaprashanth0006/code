import { describe, expect, it } from "vitest";
import type { WeatherSummary } from "../src/climate.js";
import {
  destinationIndex,
  isSamePlace,
  landingCandidates,
  monthlyClimateById,
  summarizeMonthly,
  type Destination,
} from "../src/destinations.js";
import type { HttpFetch } from "../src/ingest/http.js";
import { lapseCorrect, parsePowerDaily } from "../src/ingest/nasapower.js";
import { geocodeCity } from "../src/ingest/nominatim.js";
import { buildPlacesQuery } from "../src/ingest/overpass.js";
import { commonsFileFromUrl, shortSummary } from "../src/ingest/wikipedia.js";
import type { City, Country } from "../src/schemas.js";
import { buildLanding, climateFor, DEFAULT_LANDING_CONFIG, homeAnchor } from "../src/scoring.js";

const month = (lowC: number, highC: number, rainDays: number, days = 30): WeatherSummary => ({
  days,
  lowC,
  highC,
  coldC: lowC - 3,
  warmC: highC + 3,
  rainDays,
  precipMm: rainDays * 5,
});

const dest = (id: string, lat: number, lon: number, over: Partial<Destination> = {}): Destination => ({
  id,
  name: id,
  countryCode: "IN",
  lat,
  lon,
  elevationM: null,
  themeTags: ["nature"],
  ingestQuery: id,
  summary: null,
  wikipediaUrl: null,
  photo: null,
  months: Array.from({ length: 12 }, () => month(20, 30, 3)),
  climateSource: "test",
  ...over,
});

const city = (id: string, name: string, lat: number, lon: number, themeTags: City["themeTags"] = []): City => ({
  id,
  countryId: "c-in",
  name,
  lat,
  lon,
  bbox: [lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1],
  themeTags,
  osmRelationId: null,
  wikidata: null,
  source: "test",
  fetchedAt: "2026-01-01T00:00:00Z",
});

const countries: Country[] = [{ id: "c-in", name: "India", isoCode: "IN", currency: "INR" }];

describe("destination index", () => {
  it("bundles a valid index with photos and twelve months of weather", () => {
    const index = destinationIndex();
    expect(index.length).toBeGreaterThan(0);
    for (const d of index) {
      expect(d.months).toHaveLength(12);
      if (d.photo) expect(d.photo.path).toMatch(/^destinations\/[a-z0-9-]+\.(jpg|png|webp)$/);
    }
    expect(new Set(index.map((d) => d.id)).size).toBe(index.length);
  });

  it("matches a fetched city by distance or by the ingest query's name", () => {
    const goa = dest("goa", 15.5, 73.83, { ingestQuery: "Panaji" });
    const andaman = dest("andaman-islands", 12.5, 92.9, { ingestQuery: "Port Blair" });
    expect(isSamePlace(goa, city("x", "Panaji", 15.49, 73.83))).toBe(true);
    expect(isSamePlace(andaman, city("y", "Port Blair", 11.62, 92.73))).toBe(true); // ~100 km apart
    expect(isSamePlace(andaman, city("z", "Chennai", 13.08, 80.27))).toBe(false);
  });

  it("merges fetched cities into candidates and keeps unmatched ones", () => {
    const goa = dest("goa", 15.5, 73.83, { themeTags: ["romantic", "nature"], ingestQuery: "Panaji" });
    const hampi = dest("hampi", 15.33, 76.46);
    const fetched = [city("c1", "Panaji", 15.49, 73.83, ["culture", "romantic"]), city("c2", "Belagavi", 15.85, 74.5)];
    const candidates = landingCandidates([goa, hampi], fetched, countries);
    expect(candidates.map((c) => [c.id, c.cityId])).toEqual([
      ["goa", "c1"],
      ["hampi", null],
      ["c2", "c2"],
    ]);
    expect(candidates[0]!.themeTags).toEqual(["romantic", "nature", "culture"]); // curated first, then derived
    expect(candidates[2]!.countryCode).toBe("IN");
    expect([...monthlyClimateById(candidates).keys()]).toEqual(["goa", "hampi"]);
  });

  it("summarizes date ranges from monthly figures, day by day", () => {
    const months = Array.from({ length: 12 }, (_, i) => month(10 + i, 20 + i, 3, i === 1 ? 28 : 31));
    // Jan 30 – Feb 2: two January days (10–20, 3 rain/31 d) and two February days (11–21, 3 rain/28 d).
    const w = summarizeMonthly(months, "2026-01-30", "2026-02-02")!;
    expect(w.days).toBe(4);
    expect(w.lowC).toBe(10.5);
    expect(w.highC).toBe(20.5);
    expect(w.rainDays).toBeCloseTo((2 * 3) / 31 + (2 * 3) / 28, 1);
    expect(summarizeMonthly(Array(12).fill(null), "2026-01-01", "2026-01-03")).toBeNull();
  });

  it("scores with daily normals when present, else the monthly index", () => {
    const ctx = {
      home: { id: "home", lat: 12.97, lon: 77.59 },
      normalsByCity: new Map(),
      monthlyClimate: new Map([["goa", Array.from({ length: 12 }, (_, i) => month(i, i + 10, 1))]]),
      routes: [],
    };
    expect(climateFor(ctx, "goa", 3)?.lowC).toBe(2);
    expect(climateFor(ctx, "nowhere", 3)).toBeNull();
  });

  it("doesn't recommend home, even when home is only in the index", () => {
    const candidates = landingCandidates([dest("goa", 15.5, 73.83), dest("hampi", 15.33, 76.46)], [], countries);
    const home = homeAnchor({ name: "Goa", countryCode: "IN", lat: 15.49, lon: 73.82 }, candidates);
    expect(home.id).toBe("goa");
    const rows = buildLanding(DEFAULT_LANDING_CONFIG, candidates, "2026-10-20", {
      home,
      normalsByCity: new Map(),
      monthlyClimate: monthlyClimateById(candidates),
      routes: [],
    });
    expect(rows.find((r) => r.row.id === "season")!.destinations.map((d) => d.destinationId)).toEqual(["hampi"]);
  });

  it("ranks candidates into landing rows", () => {
    const goa = dest("goa", 15.5, 73.83, { themeTags: ["romantic", "nature"] });
    const leh = dest("leh", 34.15, 77.58, {
      themeTags: ["adventure"],
      months: Array.from({ length: 12 }, () => month(-10, 2, 1)), // cold all year
    });
    const candidates = landingCandidates([goa, leh], [], countries);
    const rows = buildLanding(DEFAULT_LANDING_CONFIG, candidates, "2026-10-20", {
      home: { id: "home", lat: 12.97, lon: 77.59 },
      normalsByCity: new Map(),
      monthlyClimate: monthlyClimateById(candidates),
      routes: [],
    });
    const ids = (id: string) => rows.find((r) => r.row.id === id)!.destinations.map((d) => d.destinationId);
    expect(ids("season")).toEqual(["goa", "leh"]);
    expect(ids("adventure")).toEqual(["leh"]);
    expect(ids("romantic")).toEqual(["goa"]);
  });
});

describe("source parsing", () => {
  it("reads NASA POWER daily series, mapping the fill value to null", () => {
    const h = parsePowerDaily({
      header: { fill_value: -999 },
      properties: {
        parameter: {
          T2M_MAX: { "20240102": 21, "20240101": 20 },
          T2M_MIN: { "20240101": 10, "20240102": -999 },
          PRECTOTCORR: { "20240101": 0, "20240102": 4.2 },
        },
      },
    });
    expect(h).toEqual({
      gridElevationM: null,
      time: ["2024-01-01", "2024-01-02"],
      tmax: [20, 21],
      tmin: [10, null],
      precip: [0, 4.2],
    });
    expect(parsePowerDaily({ geometry: { coordinates: [76.7, 11.41, 784.64] }, properties: { parameter: { T2M_MAX: {}, T2M_MIN: {}, PRECTOTCORR: {} } } }).gridElevationM).toBe(784.64);
  });

  it("moves grid temperatures to the place's elevation", () => {
    // Ooty: grid cell ~785 m, town ~2,231 m → about 9.4 °C cooler.
    const h = lapseCorrect({ time: ["2024-12-01"], tmax: [27], tmin: [17], precip: [3] }, 785, 2231);
    expect(h.tmax[0]).toBeCloseTo(17.6, 1);
    expect(h.tmin[0]).toBeCloseTo(7.6, 1);
    expect(h.precip).toEqual([3]);
    expect(lapseCorrect({ time: ["x"], tmax: [null], tmin: [5], precip: [0] }, 0, 1000).tmax).toEqual([null]);
  });

  it("reads Commons file names from Wikipedia image URLs", () => {
    expect(commonsFileFromUrl("https://upload.wikimedia.org/wikipedia/commons/7/7e/Hoi_An_%28I%29.jpg")).toBe("Hoi An (I).jpg");
    expect(commonsFileFromUrl("https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Hoi_An.jpg/320px-Hoi_An.jpg")).toBe("Hoi An.jpg");
    expect(commonsFileFromUrl("https://upload.wikimedia.org/wikipedia/en/1/1a/Local.jpg")).toBeNull();
  });

  it("shortens Wikipedia extracts to whole sentences", () => {
    const text = "One. Two is longer. " + "Three ".repeat(80) + "end.";
    expect(shortSummary(text, 30)).toBe("One. Two is longer.");
    expect(shortSummary("No full stop")).toBe("No full stop");
  });

  it("geocodes places mapped only as a point, with a box around them", async () => {
    const node = {
      osm_type: "node",
      osm_id: 42,
      lat: "10.0870",
      lon: "77.0601",
      name: "Munnar",
      display_name: "Munnar, Idukki, Kerala, India",
      boundingbox: ["10.0470", "10.1270", "77.0201", "77.1001"],
      address: { country: "India", country_code: "in" },
    };
    const calls: string[] = [];
    const fetch: HttpFetch = async (url) => {
      calls.push(url);
      const body = url.includes("featureType=settlement") ? [node] : [];
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const geo = await geocodeCity(fetch, "Munnar");
    expect(calls).toHaveLength(2); // city first, then any settlement
    expect(geo.osmRelationId).toBeNull();
    expect(geo.countryCode).toBe("IN");
    const [w, s, e, n] = geo.bbox;
    expect(n - s).toBeCloseTo(0.1, 3);
    expect(e - w).toBeCloseTo(0.1, 3);
  });

  it("queries Overpass by boundary area or by box", () => {
    expect(buildPlacesQuery({ relationId: 5400890 })).toContain("area(id:3605400890)->.city;");
    const q = buildPlacesQuery({ bbox: [77.02, 10.04, 77.1, 10.13] });
    expect(q).not.toContain("area(");
    expect(q).toContain('["tourism"~"^(museum|gallery|attraction|viewpoint|zoo|aquarium|theme_park)$"]["name"](10.04,77.02,10.13,77.1);');
  });
});
