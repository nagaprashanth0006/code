import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { SqlExecutor, SqlValue } from "../src/db/executor.js";
import { migrate, SCHEMA_VERSION } from "../src/db/migrations.js";
import { Repo } from "../src/db/repo.js";
import { addItem, createSingleLegTrip, diffItems, moveItem } from "../src/itinerary.js";
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

    const moved = moveItem(tree, b.item.id, tree.legs[0]!.days[2]!.slots[2]!.slot.id, 0);
    const diff = diffItems(tree, moved);
    await repo.upsertItems(diff.upserts);
    await repo.deleteItems(diff.deletes);
    expect(await repo.loadTripTree(tree.trip.id)).toEqual(moved);

    await repo.deleteTrip(tree.trip.id);
    expect(await repo.listTrips()).toEqual([]);
  });
});
