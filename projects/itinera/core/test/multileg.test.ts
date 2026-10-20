import { describe, expect, it } from "vitest";
import { checkTrip, transferLabel } from "../src/constraints.js";
import {
  addItem,
  addLeg,
  allDays,
  allItems,
  createSingleLegTrip,
  createTrip,
  findItem,
  layoutLegs,
  legDayCounts,
  legOfDay,
  moveLeg,
  removeLeg,
  reorderLegs,
  setLegNights,
  setLegStopover,
  totalNights,
  transferOnDay,
  updateTransfer,
  type TripTree,
} from "../src/itinerary.js";
import { allocateTripNights, suggestLegOrder, transferEstimator } from "../src/multicity.js";
import { placeMap } from "./helpers.js";

const CITIES = [
  { id: "lisbon", lat: 38.72, lon: -9.14 },
  { id: "porto", lat: 41.15, lon: -8.61 },
  { id: "coimbra", lat: 40.21, lon: -8.43 },
  { id: "faro", lat: 37.02, lon: -7.93 },
];
const positions = new Map(CITIES.map((c) => [c.id, c]));
const estimate = transferEstimator(CITIES, [
  { fromCityId: "lisbon", toCityId: "porto", mode: "rail", typicalMinutes: 175, direct: true },
]);
const names: Record<string, string> = { lisbon: "Lisbon", porto: "Porto", coimbra: "Coimbra", faro: "Faro" };

const threeCities = () =>
  createTrip(
    {
      name: "Portugal",
      startDate: "2026-11-02",
      legs: [
        { cityId: "lisbon", nights: 3 },
        { cityId: "coimbra", nights: 1, isStopover: true },
        { cityId: "porto", nights: 2 },
      ],
    },
    estimate,
  );

const dates = (t: TripTree) => t.legs.map((l) => l.days.map((d) => d.day.date));
const cityOrder = (t: TripTree) => t.legs.map((l) => l.leg.cityId);

describe("multi-leg trips", () => {
  it("lays legs out back to back; the last leg owns the departure day", () => {
    const t = threeCities();
    expect(legDayCounts(t.legs.map((l) => l.leg))).toEqual([3, 1, 3]);
    expect(dates(t)).toEqual([
      ["2026-11-02", "2026-11-03", "2026-11-04"],
      ["2026-11-05"],
      ["2026-11-06", "2026-11-07", "2026-11-08"],
    ]);
    expect(t.trip.startDate).toBe("2026-11-02");
    expect(t.trip.endDate).toBe("2026-11-08");
    expect(totalNights(t)).toBe(6);
    expect(allDays(t).map((d) => d.day.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(t.legs.map((l) => l.leg.order)).toEqual([0, 1, 2]);
  });

  it("matches the single-leg layout for one city", () => {
    const one = createTrip({ name: "L", startDate: "2026-10-18", legs: [{ cityId: "lisbon", nights: 2 }] }, estimate);
    const legacy = createSingleLegTrip({ name: "L", cityId: "lisbon", startDate: "2026-10-18", endDate: "2026-10-20" });
    expect(dates(one)).toEqual(dates(legacy));
    expect(one.transfers).toEqual([]);
  });

  it("puts each transfer on the first day of the leg it arrives at", () => {
    const t = threeCities();
    expect(t.transfers).toHaveLength(2);
    const [a, b] = t.transfers;
    expect(a).toMatchObject({ fromLegId: t.legs[0]!.leg.id, toLegId: t.legs[1]!.leg.id, departDayId: t.legs[1]!.days[0]!.day.id });
    expect(b).toMatchObject({ fromLegId: t.legs[1]!.leg.id, toLegId: t.legs[2]!.leg.id, departDayId: t.legs[2]!.days[0]!.day.id });
    expect(a!.estMinutes).toBeGreaterThan(0);
    expect(transferOnDay(t, t.legs[2]!.days[0]!.day.id)?.id).toBe(b!.id);
    expect(transferOnDay(t, t.legs[0]!.days[0]!.day.id)).toBeUndefined();
    expect(legOfDay(t, t.legs[1]!.days[0]!.day.id)?.leg.cityId).toBe("coimbra");
  });

  it("uses a known route for a transfer, and keeps edits to it across re-layouts", () => {
    let t = createTrip(
      { name: "LP", startDate: "2026-11-02", legs: [{ cityId: "lisbon", nights: 2 }, { cityId: "porto", nights: 2 }] },
      estimate,
    );
    expect(t.transfers[0]).toMatchObject({ mode: "rail", estMinutes: 175 });
    t = updateTransfer(t, t.transfers[0]!.id, { mode: "bus", estMinutes: 210 });
    t = setLegNights(t, new Map([[t.legs[0]!.leg.id, 3]]), estimate).tree;
    expect(t.transfers[0]).toMatchObject({ mode: "bus", estMinutes: 210, departDayId: t.legs[1]!.days[0]!.day.id });
    expect(() => updateTransfer(t, t.transfers[0]!.id, { estMinutes: -5 })).toThrow();
  });

  it("grows a leg without touching planned items, shifting later legs", () => {
    let t = threeCities();
    const lisbonDay2 = t.legs[0]!.days[1]!;
    t = addItem(t, lisbonDay2.slots[0]!.slot.id, { placeId: "castle" }).tree;
    const portoDay1 = t.legs[2]!.days[0]!;
    t = addItem(t, portoDay1.slots[1]!.slot.id, { placeId: "se" }).tree;
    const before = allItems(t).map((i) => i.id).sort();

    const r = setLegNights(t, new Map([[t.legs[0]!.leg.id, 4]]), estimate);
    expect(r.moved).toBe(0);
    expect(r.tree.trip.endDate).toBe("2026-11-09");
    expect(dates(r.tree)[0]).toHaveLength(4);
    expect(r.tree.legs[0]!.days[1]!.day.id).toBe(lisbonDay2.day.id);
    // Porto's first day keeps its id and item, one day later.
    expect(r.tree.legs[2]!.days[0]!.day).toMatchObject({ id: portoDay1.day.id, date: "2026-11-07" });
    expect(allItems(r.tree).map((i) => i.id).sort()).toEqual(before);
  });

  it("shrinks a leg by moving items from removed days to its last remaining day", () => {
    let t = threeCities();
    const lastLisbon = t.legs[0]!.days[2]!;
    const a = addItem(t, lastLisbon.slots[2]!.slot.id, { placeId: "miradouro" });
    t = addItem(a.tree, t.legs[0]!.days[1]!.slots[2]!.slot.id, { placeId: "castle" }).tree;

    const r = setLegNights(t, new Map([[t.legs[0]!.leg.id, 2]]), estimate);
    expect(r.moved).toBe(1);
    expect(dates(r.tree)[0]).toEqual(["2026-11-02", "2026-11-03"]);
    const moved = findItem(r.tree, a.item.id)!;
    // Same part of the day (evening), now on Lisbon's day 2, after what was there.
    expect(moved.slot.slot.id).toBe(r.tree.legs[0]!.days[1]!.slots[2]!.slot.id);
    expect(moved.slot.items.map((i) => i.placeId)).toEqual(["castle", "miradouro"]);
    expect(moved.slot.items.map((i) => i.order)).toEqual([0, 1]);
    expect(allItems(r.tree)).toHaveLength(2);
    expect(r.tree.trip.endDate).toBe("2026-11-07");
  });

  it("keeps at least one night per leg once a trip has several", () => {
    const t = threeCities();
    const r = setLegNights(t, new Map([[t.legs[1]!.leg.id, 0]]), estimate);
    expect(r.tree.legs[1]!.leg.nights).toBe(1);
    const dayTrip = createTrip({ name: "D", startDate: "2026-11-02", legs: [{ cityId: "lisbon", nights: 0 }] }, estimate);
    expect(dates(dayTrip)).toEqual([["2026-11-02"]]);
    const grown = addLeg(dayTrip, { cityId: "porto", nights: 2 }, estimate).tree;
    expect(grown.legs.map((l) => l.leg.nights)).toEqual([1, 2]);
  });

  it("adds, moves and removes legs, rebuilding transfers", () => {
    let t = threeCities();
    t = addLeg(t, { cityId: "faro", nights: 2 }, estimate, 0).tree;
    expect(cityOrder(t)).toEqual(["faro", "lisbon", "coimbra", "porto"]);
    expect(t.transfers).toHaveLength(3);
    expect(t.trip.endDate).toBe("2026-11-10");

    t = moveLeg(t, t.legs[0]!.leg.id, 3, estimate).tree;
    expect(cityOrder(t)).toEqual(["lisbon", "coimbra", "porto", "faro"]);
    expect(t.transfers.map((x) => [x.fromLegId, x.toLegId])).toEqual([
      [t.legs[0]!.leg.id, t.legs[1]!.leg.id],
      [t.legs[1]!.leg.id, t.legs[2]!.leg.id],
      [t.legs[2]!.leg.id, t.legs[3]!.leg.id],
    ]);

    t = removeLeg(t, t.legs[1]!.leg.id, estimate).tree;
    expect(cityOrder(t)).toEqual(["lisbon", "porto", "faro"]);
    expect(t.transfers).toHaveLength(2);
    expect(t.transfers[0]).toMatchObject({ mode: "rail", estMinutes: 175 });
    expect(() => removeLeg(createSingleLegTrip({ name: "x", cityId: "lisbon", startDate: "2026-11-02", endDate: "2026-11-03" }), "x", estimate)).toThrow();
    expect(() => reorderLegs(t, [t.legs[0]!.leg.id], estimate)).toThrow();
  });

  it("moves the departure day with the last leg when legs are reordered", () => {
    let t = threeCities();
    const portoLast = t.legs[2]!.days[2]!;
    t = addItem(t, portoLast.slots[0]!.slot.id, { placeId: "se" }).tree;
    const r = reorderLegs(t, [t.legs[2]!.leg.id, t.legs[1]!.leg.id, t.legs[0]!.leg.id], estimate);
    // Porto is first now and owns 2 days; its third day's item moves to its second day.
    expect(cityOrder(r.tree)).toEqual(["porto", "coimbra", "lisbon"]);
    expect(dates(r.tree).map((d) => d.length)).toEqual([2, 1, 4]);
    expect(r.moved).toBe(1);
    expect(allItems(r.tree)).toHaveLength(1);
    expect(r.tree.trip.endDate).toBe("2026-11-08");
  });

  it("re-dates the whole trip from a new start", () => {
    const t = layoutLegs(threeCities(), estimate, "2026-12-01").tree;
    expect(t.trip.startDate).toBe("2026-12-01");
    expect(t.trip.endDate).toBe("2026-12-07");
    expect(dates(t)[1]).toEqual(["2026-12-04"]);
  });

  it("suggests a leg order that doesn't zig-zag", () => {
    const zigzag = createTrip(
      {
        name: "Z",
        startDate: "2026-11-02",
        legs: [{ cityId: "porto", nights: 2 }, { cityId: "faro", nights: 2 }, { cityId: "coimbra", nights: 2 }],
      },
      estimate,
    );
    const order = suggestLegOrder(zigzag, positions, positions.get("lisbon")!);
    const cities = order.map((id) => zigzag.legs.find((l) => l.leg.id === id)!.leg.cityId);
    expect(Math.abs(cities.indexOf("coimbra") - cities.indexOf("porto"))).toBe(1);
    // An open path without an origin runs end to end: Faro and Porto at the ends.
    const open = suggestLegOrder(zigzag, positions, null).map((id) => zigzag.legs.find((l) => l.leg.id === id)!.leg.cityId);
    expect([open[0], open[2]].sort()).toEqual(["faro", "porto"]);
    // Legs with unknown positions stay at the end.
    expect(suggestLegOrder(zigzag, new Map([["porto", positions.get("porto")!]]), null)).toHaveLength(3);
  });

  it("allocates a trip's nights per leg, even when a city repeats", () => {
    let t = threeCities();
    t = setLegStopover(t, t.legs[1]!.leg.id, true);
    t = addLeg(t, { cityId: "lisbon", nights: 2 }, estimate).tree;
    const saved: Record<string, number> = { lisbon: 20, coimbra: 2, porto: 12 };
    const { nights, warning } = allocateTripNights(t, 10, (legId, cityId) => (legId === t.legs[3]!.leg.id ? 0 : saved[cityId]!));
    expect(warning).toBeNull();
    expect(nights.size).toBe(4);
    expect(nights.get(t.legs[1]!.leg.id)).toBe(1);
    expect(nights.get(t.legs[3]!.leg.id)).toBe(2);
    expect([...nights.values()].reduce((a, b) => a + b, 0)).toBe(10);
    expect(nights.get(t.legs[0]!.leg.id)!).toBeGreaterThan(nights.get(t.legs[2]!.leg.id)!);
    expect(allocateTripNights(t, 5, () => 1).warning).toMatch(/at least 7/);
  });

  it("checks transfer days: the transfer takes the start of the day", () => {
    let t = createTrip(
      { name: "LP", startDate: "2026-11-02", legs: [{ cityId: "lisbon", nights: 2 }, { cityId: "porto", nights: 2 }] },
      estimate,
    );
    const arrival = t.legs[1]!.days[0]!;
    t = addItem(t, arrival.slots[0]!.slot.id, { placeId: "castle", durationMin: 120 }).tree;
    const name = (id: string) => names[id];
    expect(transferLabel(t, t.transfers[0]!, name)).toBe("Train from Lisbon to Porto");
    const r = checkTrip(t, placeMap(), undefined, name).byDay.get(arrival.day.id)!;
    expect(r.transfer).toEqual({ start: 9 * 60, end: 9 * 60 + 175 });
    // The morning visit can only start once the train is in.
    expect(r.schedule[0]!.start).toBeGreaterThanOrEqual(9 * 60 + 175);
    expect(r.conflicts.map((c) => c.kind)).toContain("slot-overrun");

    // A very long transfer with nothing else planned is a warning, not an error.
    const flight = updateTransfer(t, t.transfers[0]!.id, { mode: "flight", estMinutes: 14 * 60 });
    const empty = { ...flight, legs: flight.legs.map((l) => ({ ...l, days: l.days.map((d) => ({ ...d, slots: d.slots.map((s) => ({ ...s, items: [] })) })) })) };
    const c = checkTrip(empty, placeMap(), undefined, name).byDay.get(arrival.day.id)!.conflicts;
    expect(c).toEqual([expect.objectContaining({ kind: "transfer-overfull", severity: "warning" })]);
    expect(c[0]!.message).toMatch(/^Flight from Lisbon to Porto takes 14 h/);
  });
});
