import { describe, expect, it } from "vitest";
import { dedupeByName, isGenericName, namesMatch } from "../src/ingest/matching.js";
import { buildPlacesQuery } from "../src/ingest/overpass.js";
import {
  DEFAULT_SELECT,
  listingCategory,
  listingIsPlace,
  MAX_REGION_KM,
  MIN_REGION_KM,
  rankCandidate,
  searchRegion,
  selectRanked,
  type RankInput,
} from "../src/ingest/selection.js";
import type { Listing } from "../src/ingest/wikivoyage.js";

describe("name matching across sources", () => {
  it.each([
    ["Attukad waterfall", "Atukkad Waterfalls"],
    ["Abbi Falls", "Abbey Falls"],
    ["Raja Seat", "Raja's Seat"],
    ["Dubare Elephant Camp", "Dubbare Elephant camp"],
    ["Eravikulam National Park", "Eravikulam (Rajamalai) National Park"],
    ["Kundala Reservoir", "Kundala Lake"],
    ["Kaveri Nisargadhama", "Nisargadhama"],
    ["São Jorge Castle", "Castle of São Jorge"],
    ["Thattekad Bird Sanctuary", "Thattekkad Bird Santuary"],
    ["Lakkam Waterfalls", "Lakkam Water Falls"],
  ])("%s ≈ %s", (a, b) => expect(namesMatch(a, b)).toBe(true));

  it.each([
    ["Mattupetty Dam", "Mattupetty Indo-Swiss Farm"],
    ["Lisbon Cathedral", "Belém Tower"],
    ["Top Station", "Echo Point"],
  ])("%s ≠ %s", (a, b) => expect(namesMatch(a, b)).toBe(false));

  it("spots generic names", () => {
    for (const n of ["Photo Point", "View Point", "Check Dam", "Falls 10m", "Milestone"]) expect(isGenericName(n)).toBe(true);
    for (const n of ["Echo Point", "Top Station", "Raja Seat", "Anamudi"]) expect(isGenericName(n)).toBe(false);
  });

  it("keeps one of each name within 2 km, the first (best) one", () => {
    const kept = dedupeByName([
      { name: "Photo Point", lat: 10.1, lon: 77.06, rank: 4 },
      { name: "Photo Point", lat: 10.105, lon: 77.062, rank: 1 },
      { name: "Photo Point", lat: 10.3, lon: 77.2, rank: 1 }, // ~25 km away: a different one
      { name: "Raja's Seat", lat: 12.42, lon: 75.74, rank: 3 },
      { name: "Raja Seat", lat: 12.421, lon: 75.741, rank: 1 },
    ]);
    expect(kept.map((k) => [k.name, k.rank])).toEqual([
      ["Photo Point", 4],
      ["Photo Point", 1],
      ["Raja's Seat", 3],
    ]);
    // A park's centre and a node at its gate, 9 km apart, are one place when the caller allows it.
    const park = [
      { name: "Eravikulam National Park", lat: 10.2, lon: 77.08, category: "nature_reserve" },
      { name: "Eravikulam National Park", lat: 10.12, lon: 77.06, category: "attraction" },
    ];
    expect(dedupeByName(park)).toHaveLength(2);
    expect(dedupeByName(park, (a, b) => (a.category === "nature_reserve" || b.category === "nature_reserve" ? 15 : 5))).toHaveLength(1);
  });
});

const listing = (name: string, lat: number | null, lon: number | null, kind: "see" | "do" = "see"): Listing => ({
  name,
  wikidata: null,
  content: "Something worth seeing, described at length.",
  page: "Munnar",
  kind,
  lat,
  lon,
});

describe("search region", () => {
  const munnar = { lat: 10.0889, lon: 77.0595, bbox: [77.01, 10.04, 77.11, 10.14] as [number, number, number, number], osmRelationId: null };

  it("searches a large city's boundary", () => {
    const lisbon = { lat: 38.72, lon: -9.14, bbox: [-9.23, 38.69, -9.09, 38.8] as [number, number, number, number], osmRelationId: 5400890 };
    const r = searchRegion(lisbon, []);
    expect(r.mode).toBe("city");
    expect(r.scope).toEqual({ relationId: 5400890 });
  });

  it("sizes a town's region by how far its guide's listings reach, within limits", () => {
    expect(searchRegion(munnar, []).radiusKm).toBe(MIN_REGION_KM);
    // Chinnar Wildlife Sanctuary is ~31 km from Munnar in a straight line; the region reaches 2 km past it.
    const r = searchRegion(munnar, [listing("Chinnar Wildlife Sanctuary", 10.33, 77.2), listing("No coords", null, null)]);
    expect(r.mode).toBe("region");
    expect(r.radiusKm).toBeGreaterThan(32);
    expect(r.radiusKm).toBeLessThan(34);
    expect(buildPlacesQuery(r.scope)).not.toContain("around:");
    expect("bbox" in r.scope && r.scope.bbox[3] - r.scope.bbox[1]).toBeCloseTo((2 * r.radiusKm) / 111.32, 3);
    // A listing far outside the region (another city's sight) doesn't stretch it.
    expect(searchRegion(munnar, [listing("Far away", 13, 80)]).radiusKm).toBeLessThanOrEqual(MAX_REGION_KM);
    expect(searchRegion(munnar, [listing("Far away", 13, 80)]).radiusKm).toBe(MIN_REGION_KM);
  });

  it("keeps guide activities out unless their name says what place they are", () => {
    expect(listingIsPlace(listing("Wild elephant spotting", 0, 0, "do"))).toBe(false);
    expect(listingIsPlace(listing("Kathakali and Kalarippayattu performances", 0, 0, "do"))).toBe(false);
    expect(listingIsPlace(listing("Wild elephant spotting", 0, 0, "see"))).toBe(false);
    expect(listingIsPlace(listing("Kathakali and Kalarippayattu performances", 0, 0, "see"))).toBe(false);
    expect(listingIsPlace(listing("Waterfall rappelling at Chelavara Falls", 0, 0, "do"))).toBe(true);
    expect(listingIsPlace(listing("Chithirapuram", 0, 0, "see"))).toBe(true);
  });

  it("categorizes guide-only sights by name", () => {
    expect(listingCategory(listing("Lakkam Water Falls", 0, 0))).toBe("waterfall");
    expect(listingCategory(listing("Chinnar Wildlife Sanctuary", 0, 0))).toBe("nature_reserve");
    expect(listingCategory(listing("Kundala Lake", 0, 0))).toBe("lake");
    expect(listingCategory(listing("Omkareshwara Temple", 0, 0))).toBe("religious");
    expect(listingCategory(listing("Pothamedu View Point", 0, 0))).toBe("viewpoint");
    expect(listingCategory(listing("Dubbare Elephant camp", 0, 0, "do"))).toBe("attraction");
  });
});

describe("ranking and selection", () => {
  const base: RankInput = {
    name: "Somewhere",
    category: "attraction",
    sitelinks: 0,
    hasImage: false,
    hasHours: false,
    listed: false,
    hasWikidata: false,
    distanceShare: 0,
  };

  it("puts a guide listing above Wikipedia coverage alone, and generic names last", () => {
    const listed = rankCandidate({ ...base, listed: true });
    const covered = rankCandidate({ ...base, sitelinks: 3, hasWikidata: true });
    const plain = rankCandidate(base);
    const generic = rankCandidate({ ...base, name: "Photo Point", category: "viewpoint" });
    expect(listed).toBeGreaterThan(covered);
    expect(covered).toBeGreaterThan(plain);
    expect(plain).toBeGreaterThan(generic);
    // Listed, a generic name is fine: Munnar's "Photo Point" is a real stop.
    expect(rankCandidate({ ...base, name: "Photo Point", category: "viewpoint", listed: true })).toBeGreaterThan(plain);
    // Farther out in a region ranks a little lower.
    expect(rankCandidate({ ...base, distanceShare: 1 })).toBeLessThan(plain);
  });

  it("keeps every notable place and tops sparse places up to a minimum", () => {
    const sorted = (ranks: number[]) => ranks.map((rank) => ({ rank }));
    // Dense (Lisbon-like): only notable ones, capped.
    const dense = selectRanked(sorted([...Array(200).fill(3), ...Array(100).fill(1)]));
    expect(dense).toHaveLength(DEFAULT_SELECT.max);
    // Sparse (Coorg-like): 5 notable, topped up from the rest above the floor.
    const sparse = selectRanked(sorted([4, 4, 3, 3, 2, ...Array(40).fill(1), ...Array(10).fill(0.5)]));
    expect(sparse).toHaveLength(DEFAULT_SELECT.minPlaces);
    expect(sparse.every((p) => p.rank >= DEFAULT_SELECT.floor)).toBe(true);
  });
});
