/**
 * Checks against real ingested Lisbon data (core/test/fixtures/lisbon.json,
 * refreshed with `npm run ingest -- fixtures Lisbon`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { monthClimate, summarizeWeather } from "../src/climate.js";
import { checkTrip } from "../src/constraints.js";
import { hoursOnRaw, parseOpeningHours } from "../src/hours.js";
import { addItem, createSingleLegTrip } from "../src/itinerary.js";
import { CitySchema, ClimateNormalSchema, PlaceSchema } from "../src/schemas.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/lisbon.json", import.meta.url), "utf8")) as {
  city: unknown;
  places: unknown[];
  normals: unknown[];
};
const city = CitySchema.parse(raw.city);
const places = raw.places.map((p) => PlaceSchema.parse(p));
const normals = raw.normals.map((n) => ClimateNormalSchema.parse(n));
const byName = (name: string) => {
  const p = places.find((x) => x.name === name);
  if (!p) throw new Error(`fixture has no ${name}`);
  return p;
};

describe("real Lisbon data", () => {
  it("validates against the domain schemas", () => {
    expect(city.name).toBe("Lisbon");
    expect(places.length).toBeGreaterThan(20);
    expect(normals).toHaveLength(366);
  });

  it("understands every mapped opening_hours string without guessing", () => {
    const partial = places.filter((p) => p.hoursRaw && parseOpeningHours(p.hoursRaw).partial).map((p) => p.hoursRaw);
    expect(partial).toEqual([]);
  });

  it("knows the big Belém sights close on Mondays", () => {
    expect(hoursOnRaw(byName("Jerónimos Monastery").hoursRaw, "2026-10-26").status).toBe("closed");
    expect(hoursOnRaw(byName("Tower of Belém").hoursRaw, "2026-10-26").status).toBe("closed");
    expect(hoursOnRaw(byName("São Jorge Castle").hoursRaw, "2026-10-26").status).toBe("open");
  });

  it("flags the Monday visit in a 3-day plan (P1.1 done-when)", () => {
    let t = createSingleLegTrip({ name: "Lisbon", cityId: city.id, startDate: "2026-10-24", endDate: "2026-10-26" });
    const [sat, , mon] = t.legs[0]!.days;
    t = addItem(t, sat!.slots[0]!.slot.id, { placeId: byName("Jerónimos Monastery").id }).tree;
    t = addItem(t, mon!.slots[0]!.slot.id, { placeId: byName("Tower of Belém").id }).tree;
    const result = checkTrip(t, new Map(places.map((p) => [p.id, p])));
    expect(result.conflicts.map((c) => c.message)).toEqual(["Tower of Belém is closed on Mondays."]);
  });

  it("has plausible typical weather", () => {
    const aug = monthClimate(normals, 8)!;
    const jan = monthClimate(normals, 1)!;
    expect(aug.highC).toBeGreaterThan(25);
    expect(jan.highC).toBeLessThan(17);
    expect(jan.rainDays).toBeGreaterThan(aug.rainDays);
    expect(summarizeWeather(normals, "2026-10-24", "2026-10-26")!.days).toBe(3);
  });
});
