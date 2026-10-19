import { describe, expect, it } from "vitest";
import {
  addItem,
  allItems,
  createSingleLegTrip,
  diffItems,
  findItem,
  moveItem,
  removeItem,
  shiftDates,
  swapAlternate,
} from "../src/itinerary.js";

const base = () =>
  createSingleLegTrip({ name: "Lisbon", cityId: "lisbon", startDate: "2026-10-18", endDate: "2026-10-20" });

describe("itinerary tree", () => {
  it("creates one leg with a day per date and three slots per day", () => {
    const t = base();
    expect(t.legs).toHaveLength(1);
    expect(t.legs[0]!.leg.nights).toBe(2);
    expect(t.legs[0]!.days.map((d) => d.day.date)).toEqual(["2026-10-18", "2026-10-19", "2026-10-20"]);
    expect(t.legs[0]!.days[0]!.slots.map((s) => s.slot.part)).toEqual(["morning", "afternoon", "evening"]);
  });

  it("adds, reorders within a slot and moves across days", () => {
    let t = base();
    const morning1 = t.legs[0]!.days[0]!.slots[0]!.slot.id;
    const morning2 = t.legs[0]!.days[1]!.slots[0]!.slot.id;
    const a = addItem(t, morning1, { placeId: "a" });
    const b = addItem(a.tree, morning1, { placeId: "b" });
    const c = addItem(b.tree, morning1, { placeId: "c" });
    t = c.tree;
    t = moveItem(t, c.item.id, morning1, 0);
    expect(t.legs[0]!.days[0]!.slots[0]!.items.map((i) => i.placeId)).toEqual(["c", "a", "b"]);
    expect(t.legs[0]!.days[0]!.slots[0]!.items.map((i) => i.order)).toEqual([0, 1, 2]);

    t = moveItem(t, a.item.id, morning2, 0);
    expect(t.legs[0]!.days[0]!.slots[0]!.items.map((i) => i.placeId)).toEqual(["c", "b"]);
    const moved = findItem(t, a.item.id)!;
    expect(moved.item.slotId).toBe(morning2);
    expect(moved.item.order).toBe(0);
  });

  it("swaps an alternate in for a primary in one action", () => {
    let t = base();
    const slot = t.legs[0]!.days[0]!.slots[1]!.slot.id;
    const p = addItem(t, slot, { placeId: "primary" });
    const alt = addItem(p.tree, slot, { placeId: "alt", isPrimary: false });
    t = swapAlternate(alt.tree, alt.item.id, p.item.id);
    const items = t.legs[0]!.days[0]!.slots[1]!.items;
    expect(items.map((i) => [i.placeId, i.isPrimary])).toEqual([
      ["alt", true],
      ["primary", false],
    ]);
  });

  it("diffs changed rows for persistence", () => {
    const t0 = base();
    const slot = t0.legs[0]!.days[0]!.slots[0]!.slot.id;
    const a = addItem(t0, slot, { placeId: "a" });
    const b = addItem(a.tree, slot, { placeId: "b" });
    const moved = moveItem(b.tree, b.item.id, slot, 0);
    const d = diffItems(b.tree, moved);
    expect(d.upserts.map((i) => i.placeId).sort()).toEqual(["a", "b"]);
    expect(d.deletes).toEqual([]);
    expect(diffItems(moved, removeItem(moved, a.item.id)).deletes).toEqual([a.item.id]);
  });

  it("shifts all dates when the start date changes", () => {
    const t = shiftDates(base(), "2026-11-01");
    expect(t.trip.startDate).toBe("2026-11-01");
    expect(t.trip.endDate).toBe("2026-11-03");
    expect(allItems(t)).toHaveLength(0);
  });
});
