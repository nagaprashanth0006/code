import { describe, expect, it } from "vitest";
import type { WeatherSummary } from "../src/climate.js";
import { destinationIndex } from "../src/destinations.js";
import { regionOf, REGIONS } from "../src/regions.js";
import { rankForDates, type ScoringContext } from "../src/scoring.js";

describe("Regions", () => {
  it("places every indexed destination in a named region", () => {
    const unplaced = destinationIndex().filter((d) => regionOf(d.countryCode) === "other");
    expect(unplaced.map((d) => `${d.name} (${d.countryCode})`)).toEqual([]);
  });

  it("lists each country once", () => {
    const all = REGIONS.flatMap((r) => r.countries.split(" "));
    expect(all.length).toBe(new Set(all).size);
  });
});

describe("Ranking for chosen dates", () => {
  const w = (highC: number, rainDays: number, days = 30): WeatherSummary => ({
    days,
    lowC: highC - 8,
    highC,
    coldC: highC - 12,
    warmC: highC + 4,
    rainDays,
    precipMm: rainDays * 8,
  });
  // Two equally distant places: dry in January for one, monsoon-wet for the other.
  const months = (jan: WeatherSummary, jul: WeatherSummary) => Array.from({ length: 12 }, (_, i) => (i === 0 ? jan : i === 6 ? jul : null));
  const ctx: ScoringContext = {
    home: { id: "home", lat: 0, lon: 0 },
    normalsByCity: new Map(),
    monthlyClimate: new Map([
      ["dry-jan", months(w(24, 1, 31), w(33, 20, 31))],
      ["wet-jan", months(w(24, 20, 31), w(24, 1, 31))],
    ]),
    routes: [],
  };
  const places = [
    { id: "dry-jan", lat: 1, lon: 0, themeTags: [] },
    { id: "wet-jan", lat: -1, lon: 0, themeTags: [] },
  ];

  it("ranks by the weather on those dates, not the best month", () => {
    expect(rankForDates(places, null, "2027-01-10", "2027-01-14", ctx).map((r) => r.destinationId)).toEqual(["dry-jan", "wet-jan"]);
    expect(rankForDates(places, null, "2027-07-10", "2027-07-14", ctx).map((r) => r.destinationId)).toEqual(["wet-jan", "dry-jan"]);
  });

  it("reports the typical weather for the dates", () => {
    const [best] = rankForDates(places, null, "2027-01-10", "2027-01-14", ctx);
    expect(best!.weather?.days).toBe(5);
    expect(best!.weather?.rainDays).toBeCloseTo((1 / 31) * 5, 1);
    expect(best!.month).toBe(1);
  });
});
