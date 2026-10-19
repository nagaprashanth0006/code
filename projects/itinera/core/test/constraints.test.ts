import { describe, expect, it } from "vitest";
import { checkDay, checkTrip } from "../src/constraints.js";
import { addItem, createSingleLegTrip, type TripTree } from "../src/itinerary.js";
import type { Item, SlotPart } from "../src/schemas.js";
import { placeMap } from "./helpers.js";

let n = 0;
function item(placeId: string, extra: Partial<Item> = {}): Item {
  return {
    id: `i${n++}`,
    slotId: "s",
    placeId,
    customName: null,
    order: n,
    isPrimary: true,
    durationMin: null,
    estCost: null,
    notes: null,
    ...extra,
  };
}

const day = (date: string, slots: Partial<Record<SlotPart, Item[]>>) =>
  checkDay({
    dayId: "d",
    date,
    places: placeMap(),
    slots: (["morning", "afternoon", "evening"] as const).map((part) => ({ part, items: slots[part] ?? [] })),
  });

describe("constraint checker", () => {
  it("flags a place that is closed on Mondays", () => {
    const r = day("2026-10-19", { morning: [item("jeronimos")] });
    expect(r.conflicts).toEqual([
      expect.objectContaining({ kind: "closed-day", severity: "error", message: "Jerónimos Monastery is closed on Mondays." }),
    ]);
    expect(day("2026-10-20", { morning: [item("jeronimos")] }).conflicts).toEqual([]);
  });

  it("schedules visits in order with travel and waits for opening time", () => {
    const r = day("2026-10-20", { morning: [item("jeronimos"), item("belem")] });
    const [first, second] = r.schedule;
    expect(first!.start).toBe(9 * 60 + 30); // waits for 09:30 opening
    expect(first!.waitMinutes).toBe(30);
    expect(first!.end).toBe(9 * 60 + 30 + 45);
    expect(second!.travelMode).toBe("walk");
    expect(second!.start).toBe(first!.end + second!.travelMinutes);
  });

  it("flags a visit planned outside opening hours", () => {
    const r = day("2026-10-20", { evening: [item("jeronimos")] });
    expect(r.conflicts.map((c) => c.kind)).toEqual(["closed-at-time"]);
  });

  it("flags long travel between consecutive items", () => {
    const r = day("2026-10-20", { morning: [item("belem"), item("castle")] });
    // Belém → castle is ~7.5 km: transit, about 45 min.
    expect(r.conflicts.map((c) => c.kind)).toContain("travel-time");
  });

  it("flags a day that runs too long", () => {
    const long = (id: string) => item(id, { durationMin: 240 });
    const r = day("2026-10-20", { morning: [long("castle")], afternoon: [long("se")], evening: [long("miradouro")] });
    expect(r.conflicts.map((c) => c.kind)).toContain("day-overfull");
  });

  it("does not flag places without hours data", () => {
    expect(day("2026-10-19", { morning: [item("miradouro")] }).conflicts).toEqual([]);
  });

  it("notes alternates closed that day without blocking", () => {
    const r = day("2026-10-19", { morning: [item("castle"), item("jeronimos", { isPrimary: false })] });
    expect(r.conflicts).toEqual([expect.objectContaining({ kind: "alternate-closed", severity: "info" })]);
    expect(r.schedule).toHaveLength(1);
  });

  it("treats a transfer as consuming the start of its day", () => {
    const r = checkDay({
      dayId: "d",
      date: "2026-10-20",
      places: placeMap(),
      transfer: { minutes: 9 * 60, label: "Train to Porto" },
      slots: [
        { part: "afternoon", items: [item("castle", { durationMin: 180 })] },
        { part: "evening", items: [item("se", { durationMin: 120 })] },
      ],
    });
    expect(r.conflicts.map((c) => c.kind)).toContain("transfer-overfull");
  });

  it("checks a whole trip (the P1.1 done-when: 3 days, reorder, Monday warning)", () => {
    let t: TripTree = createSingleLegTrip({
      name: "Lisbon",
      cityId: "lisbon",
      startDate: "2026-10-18",
      endDate: "2026-10-20",
    });
    const [sun, mon] = t.legs[0]!.days;
    t = addItem(t, sun!.slots[0]!.slot.id, { placeId: "castle" }).tree;
    t = addItem(t, mon!.slots[0]!.slot.id, { placeId: "jeronimos" }).tree;
    const result = checkTrip(t, placeMap());
    expect(result.conflicts).toEqual([expect.objectContaining({ kind: "closed-day", dayId: mon!.day.id })]);
  });
});
