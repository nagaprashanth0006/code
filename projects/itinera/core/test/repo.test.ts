import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { SqlExecutor, SqlValue } from "../src/db/executor.js";
import { migrate, SCHEMA_VERSION } from "../src/db/migrations.js";
import { Repo } from "../src/db/repo.js";
import { addItem, addLeg, createSingleLegTrip, diffItems, moveItem, removeLeg, setLegNights } from "../src/itinerary.js";
import { transferEstimator } from "../src/multicity.js";
import type { City, Place } from "../src/schemas.js";

function memoryDb(): SqlExecutor {
  const db = new DatabaseSync(":memory:");
  return {
    async execute(sql: string, params: readonly SqlValue[] = []) {
      if (params.length === 0) {
        db.exec(sql);
        return { rowsAffected: 0 };
      }
      return { rowsAffected: Number(db.prepare(sql).run(...params).changes) };
    },
    async select<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
  };
}

const city: City = {
  id: "c1",
  countryId: "pt",
  name: "Lisbon",
  lat: 38.72,
  lon: -9.14,
  bbox: [-9.23, 38.69, -9.09, 38.8],
  themeTags: ["historical"],
  osmRelationId: 5400890,
  wikidata: "Q597",
  source: "test",
  fetchedAt: "2026-10-19T00:00:00Z",
};

const place = (osmId: string, id: string): Place => ({
  id,
  cityId: "c1",
  name: `Place ${osmId}`,
  category: "museum",
  lat: 38.7,
  lon: -9.2,
  hoursRaw: "Tu-Su 10:00-18:00",
  description: "A museum.",
  descriptionAttribution: { text: "Wikidata", url: null, license: "CC0", licenseUrl: null },
  themeTags: ["culture"],
  photoPath: null,
  photoAttribution: null,
  sources: [{ label: "OpenStreetMap", url: "https://www.openstreetmap.org/node/1" }],
  osmId,
  wikidata: null,
  rank: 3,
  source: "osm",
  fetchedAt: "2026-10-19T00:00:00Z",
});

describe("repository", () => {
  it("migrates idempotently", async () => {
    const db = memoryDb();
    expect(await migrate(db)).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(await migrate(db)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
  });

  it("round-trips catalog rows and keeps place ids stable on re-fetch", async () => {
    const db = memoryDb();
    await migrate(db);
    const repo = new Repo(db);
    await repo.upsertCountry({ id: "pt", name: "Portugal", isoCode: "PT", currency: "EUR" });
    await repo.upsertCity(city);
    await repo.upsertPlaces([place("node/1", "p1"), place("node/2", "p2")]);
    await repo.upsertPlaces([{ ...place("node/1", "NEW"), name: "Renamed" }]);
    const places = await repo.placesByCity("c1");
    expect(places).toHaveLength(2);
    expect(places.find((p) => p.osmId === "node/1")).toMatchObject({ id: "p1", name: "Renamed" });
    expect(await repo.getCity("c1")).toEqual(city);
  });

  it("prunes places a re-fetch dropped, keeping those a trip or the wishlist uses", async () => {
    const db = memoryDb();
    await migrate(db);
    const repo = new Repo(db);
    await repo.upsertCountry({ id: "pt", name: "Portugal", isoCode: "PT", currency: "EUR" });
    await repo.upsertCity(city);
    await repo.upsertPlaces(["p1", "p2", "p3", "p4"].map((id, i) => place(`node/${i + 1}`, id)));
    await repo.addToWishlist({ id: "w1", placeId: "p2", savedAt: "2026-10-21T00:00:00Z", note: null });
    const tree = createSingleLegTrip({ name: "T", cityId: "c1", startDate: "2026-10-18", endDate: "2026-10-18" });
    await repo.saveTripTree(addItem(tree, tree.legs[0]!.days[0]!.slots[0]!.slot.id, { placeId: "p3" }).tree);

    expect(await repo.prunePlaces("c1", ["p1"])).toBe(1);
    expect((await repo.placesByCity("c1")).map((p) => p.id).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("saves and reloads a trip tree, then persists an edit diff", async () => {
    const db = memoryDb();
    await migrate(db);
    const repo = new Repo(db);
    let tree = createSingleLegTrip({ name: "Lisbon", cityId: "c1", startDate: "2026-10-18", endDate: "2026-10-20" });
    const slot = tree.legs[0]!.days[0]!.slots[0]!.slot.id;
    const a = addItem(tree, slot, { placeId: "p1" });
    const b = addItem(a.tree, slot, { placeId: "p2" });
    tree = b.tree;
    await repo.saveTripTree(tree);
    expect(await repo.loadTripTree(tree.trip.id)).toEqual(tree);
    expect(await repo.tripCities()).toEqual(new Map([[tree.trip.id, ["c1"]]]));

    const moved = moveItem(tree, b.item.id, tree.legs[0]!.days[2]!.slots[2]!.slot.id, 0);
    const diff = diffItems(tree, moved);
    await repo.upsertItems(diff.upserts);
    await repo.deleteItems(diff.deletes);
    expect(await repo.loadTripTree(tree.trip.id)).toEqual(moved);

    await repo.deleteTrip(tree.trip.id);
    expect(await repo.listTrips()).toEqual([]);
  });

  it("replaces a trip's structure after leg edits, deleting rows that went away", async () => {
    const db = memoryDb();
    await migrate(db);
    const repo = new Repo(db);
    const estimate = transferEstimator([
      { id: "c1", lat: 38.72, lon: -9.14 },
      { id: "c2", lat: 41.15, lon: -8.61 },
      { id: "c3", lat: 40.21, lon: -8.43 },
    ]);
    let tree = createSingleLegTrip({ name: "Portugal", cityId: "c1", startDate: "2026-11-02", endDate: "2026-11-04" });
    await repo.saveTripTree(tree);
    tree = addLeg(tree, { cityId: "c3", nights: 1, isStopover: true }, estimate).tree;
    tree = addLeg(tree, { cityId: "c2", nights: 2 }, estimate).tree;
    tree = addItem(tree, tree.legs[2]!.days[1]!.slots[0]!.slot.id, { placeId: "p1" }).tree;
    tree = addItem(tree, tree.legs[1]!.days[0]!.slots[1]!.slot.id, { placeId: "p2" }).tree;
    await repo.replaceTripTree(tree);
    expect(await repo.loadTripTree(tree.trip.id)).toEqual(tree);
    expect(await repo.tripCities()).toEqual(new Map([[tree.trip.id, ["c1", "c3", "c2"]]]));

    tree = removeLeg(tree, tree.legs[1]!.leg.id, estimate).tree;
    tree = setLegNights(tree, new Map([[tree.legs[1]!.leg.id, 1]]), estimate).tree;
    await repo.replaceTripTree(tree);
    expect(await repo.loadTripTree(tree.trip.id)).toEqual(tree);
    const count = async (table: string) => Number((await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n);
    expect(await count("leg")).toBe(2);
    expect(await count("day")).toBe(4);
    expect(await count("slot")).toBe(12);
    expect(await count("item")).toBe(1);
    expect(await count("transfer")).toBe(1);
  });
});
