/**
 * The itinerary tree (Trip → Legs → Days → Slots → Items) and pure edit
 * operations on it. Every operation returns a new tree; the UI keeps the tree
 * in state and the repository persists the rows that changed (see `diffItems`).
 */
import { addDays, dateRange, daysBetween, type IsoDate } from "./dates.js";
import { ulid } from "./ids.js";
import {
  SLOT_PARTS,
  type Day,
  type Item,
  type Leg,
  type Slot,
  type Transfer,
  type TransportMode,
  type Trip,
  type TripState,
} from "./schemas.js";

export interface SlotTree {
  slot: Slot;
  /** Sorted by `order`; primaries and alternates share one order sequence. */
  items: Item[];
}

export interface DayTree {
  day: Day;
  slots: SlotTree[];
}

export interface LegTree {
  leg: Leg;
  days: DayTree[];
}

export interface TripTree {
  trip: Trip;
  legs: LegTree[];
  transfers: Transfer[];
}

export interface NewTripInput {
  name: string;
  cityId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  originCityId?: string | null;
  state?: TripState;
  now?: Date;
}

function buildDays(legId: string, dates: IsoDate[], startIndex: number): DayTree[] {
  return dates.map((date, i) => {
    const day: Day = { id: ulid(), legId, date, index: startIndex + i };
    return {
      day,
      slots: SLOT_PARTS.map((part, order) => ({ slot: { id: ulid(), dayId: day.id, part, order }, items: [] })),
    };
  });
}

/** A trip with one leg covering every date from start to end (inclusive). */
export function createSingleLegTrip(input: NewTripInput): TripTree {
  if (input.endDate < input.startDate) throw new Error("End date is before start date");
  const now = input.now ?? new Date();
  const trip: Trip = {
    id: ulid(now.getTime()),
    name: input.name,
    originCityId: input.originCityId ?? null,
    state: input.state ?? "planning",
    startDate: input.startDate,
    endDate: input.endDate,
    createdAt: now.toISOString(),
  };
  const leg: Leg = {
    id: ulid(),
    tripId: trip.id,
    cityId: input.cityId,
    order: 0,
    nights: Math.max(daysBetween(input.startDate, input.endDate), 0),
    isStopover: false,
  };
  return { trip, legs: [{ leg, days: buildDays(leg.id, dateRange(input.startDate, input.endDate), 0) }], transfers: [] };
}

// ------------------------------------------------------------------ lookup

export function allSlots(tree: TripTree): SlotTree[] {
  return tree.legs.flatMap((l) => l.days.flatMap((d) => d.slots));
}

export function allDays(tree: TripTree): DayTree[] {
  return tree.legs.flatMap((l) => l.days);
}

export function allItems(tree: TripTree): Item[] {
  return allSlots(tree).flatMap((s) => s.items);
}

export function findSlot(tree: TripTree, slotId: string): SlotTree | undefined {
  return allSlots(tree).find((s) => s.slot.id === slotId);
}

export function findItem(tree: TripTree, itemId: string): { item: Item; slot: SlotTree } | undefined {
  for (const slot of allSlots(tree)) {
    const item = slot.items.find((i) => i.id === itemId);
    if (item) return { item, slot };
  }
  return undefined;
}

export function dayOfSlot(tree: TripTree, slotId: string): DayTree | undefined {
  return allDays(tree).find((d) => d.slots.some((s) => s.slot.id === slotId));
}

// ------------------------------------------------------------------- edits

/** Rebuilds the tree with the given slots' items replaced (orders renumbered). */
function withSlotItems(tree: TripTree, changes: Map<string, Item[]>): TripTree {
  return {
    ...tree,
    legs: tree.legs.map((l) => ({
      ...l,
      days: l.days.map((d) => ({
        ...d,
        slots: d.slots.map((s) => {
          const items = changes.get(s.slot.id);
          if (!items) return s;
          return { ...s, items: items.map((it, order) => ({ ...it, slotId: s.slot.id, order })) };
        }),
      })),
    })),
  };
}

export interface NewItemInput {
  placeId?: string | null;
  customName?: string | null;
  isPrimary?: boolean;
  durationMin?: number | null;
  estCost?: number | null;
  notes?: string | null;
}

export function addItem(tree: TripTree, slotId: string, input: NewItemInput): { tree: TripTree; item: Item } {
  const slot = findSlot(tree, slotId);
  if (!slot) throw new Error(`No slot ${slotId}`);
  if (!input.placeId && !input.customName) throw new Error("An item needs a place or a custom name");
  const item: Item = {
    id: ulid(),
    slotId,
    placeId: input.placeId ?? null,
    customName: input.customName ?? null,
    order: slot.items.length,
    isPrimary: input.isPrimary ?? true,
    durationMin: input.durationMin ?? null,
    estCost: input.estCost ?? null,
    notes: input.notes ?? null,
  };
  const next = withSlotItems(tree, new Map([[slotId, [...slot.items, item]]]));
  return { tree: next, item: findItem(next, item.id)!.item };
}

/**
 * Moves an item to `toIndex` within `toSlotId` (index counted over that slot's
 * items after removal). Works within a slot, across slots and across days.
 */
export function moveItem(tree: TripTree, itemId: string, toSlotId: string, toIndex: number): TripTree {
  const found = findItem(tree, itemId);
  const target = findSlot(tree, toSlotId);
  if (!found || !target) throw new Error("Unknown item or slot");
  const changes = new Map<string, Item[]>();
  const sourceItems = found.slot.items.filter((i) => i.id !== itemId);
  changes.set(found.slot.slot.id, sourceItems);
  const targetItems = found.slot.slot.id === toSlotId ? sourceItems : [...target.items];
  const index = Math.max(0, Math.min(toIndex, targetItems.length));
  changes.set(toSlotId, [...targetItems.slice(0, index), found.item, ...targetItems.slice(index)]);
  return withSlotItems(tree, changes);
}

export function removeItem(tree: TripTree, itemId: string): TripTree {
  const found = findItem(tree, itemId);
  if (!found) return tree;
  return withSlotItems(tree, new Map([[found.slot.slot.id, found.slot.items.filter((i) => i.id !== itemId)]]));
}

export function updateItem(
  tree: TripTree,
  itemId: string,
  patch: Partial<Pick<Item, "durationMin" | "estCost" | "notes" | "customName">>,
): TripTree {
  const found = findItem(tree, itemId);
  if (!found) throw new Error(`No item ${itemId}`);
  const items = found.slot.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i));
  return withSlotItems(tree, new Map([[found.slot.slot.id, items]]));
}

export function setPrimary(tree: TripTree, itemId: string, isPrimary: boolean): TripTree {
  const found = findItem(tree, itemId);
  if (!found) throw new Error(`No item ${itemId}`);
  const items = found.slot.items.map((i) => (i.id === itemId ? { ...i, isPrimary } : i));
  return withSlotItems(tree, new Map([[found.slot.slot.id, items]]));
}

/**
 * Swaps an alternate in for a primary in one action: the alternate takes the
 * primary's position and becomes primary; the primary becomes an alternate.
 */
export function swapAlternate(tree: TripTree, alternateId: string, primaryId: string): TripTree {
  const alt = findItem(tree, alternateId);
  const pri = findItem(tree, primaryId);
  if (!alt || !pri) throw new Error("Unknown item");
  if (alt.slot.slot.id !== pri.slot.slot.id) throw new Error("Alternate and primary must share a slot");
  if (alt.item.isPrimary || !pri.item.isPrimary) throw new Error("Expected an alternate and a primary");
  const items = alt.slot.items.map((i) => {
    if (i.id === alternateId) return { ...pri.item, isPrimary: false };
    if (i.id === primaryId) return { ...alt.item, isPrimary: true };
    return i;
  });
  return withSlotItems(tree, new Map([[alt.slot.slot.id, items]]));
}

/** Rows to write and delete to bring `before` to `after`. */
export function diffItems(before: TripTree, after: TripTree): { upserts: Item[]; deletes: string[] } {
  const old = new Map(allItems(before).map((i) => [i.id, i]));
  const upserts: Item[] = [];
  const seen = new Set<string>();
  for (const item of allItems(after)) {
    seen.add(item.id);
    const prev = old.get(item.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) upserts.push(item);
  }
  const deletes = [...old.keys()].filter((id) => !seen.has(id));
  return { upserts, deletes };
}

/** Re-dates every day of a single-leg trip from a new start date. */
export function shiftDates(tree: TripTree, startDate: IsoDate): TripTree {
  let index = 0;
  const legs = tree.legs.map((l) => ({
    ...l,
    days: l.days.map((d) => ({ ...d, day: { ...d.day, date: addDays(startDate, index++) } })),
  }));
  const endDate = addDays(startDate, Math.max(index - 1, 0));
  return { ...tree, trip: { ...tree.trip, startDate, endDate }, legs };
}

// -------------------------------------------------------------------- legs
//
// Legs are laid out back to back from the trip's start date. A leg with n
// nights owns n days: the day you arrive (which begins with the transfer from
// the previous leg) and the full days after it. The last leg also owns the
// departure day, so a trip of N nights has N + 1 days, as a single-leg trip
// always had. Every structural edit below re-runs `layoutLegs`, which keeps
// existing days (and their items) by position within each leg.

/** Mode and duration of travel between two legs' cities. */
export type TransferEstimator = (fromCityId: string, toCityId: string) => { mode: TransportMode; minutes: number };

export interface LegInput {
  cityId: string;
  nights: number;
  isStopover?: boolean;
}

export interface LayoutResult {
  tree: TripTree;
  /** Items moved to an earlier day because the day they were on went away. */
  moved: number;
}

/** Days each leg gets, in order (see the layout note above). */
export function legDayCounts(legs: ReadonlyArray<Pick<Leg, "nights">>): number[] {
  return legs.map((l, i) => (i === legs.length - 1 ? l.nights + 1 : l.nights));
}

/** Smallest allowed nights: a one-leg trip may be a day trip; otherwise every leg needs a night. */
export function minLegNights(legCount: number): number {
  return legCount > 1 ? 1 : 0;
}

export function totalNights(tree: TripTree): number {
  return tree.legs.reduce((a, l) => a + l.leg.nights, 0);
}

export function findLeg(tree: TripTree, legId: string): LegTree | undefined {
  return tree.legs.find((l) => l.leg.id === legId);
}

export function legOfDay(tree: TripTree, dayId: string): LegTree | undefined {
  return tree.legs.find((l) => l.days.some((d) => d.day.id === dayId));
}

/** The transfer that starts this day (arriving at the day's leg), if any. */
export function transferOnDay(tree: TripTree, dayId: string): Transfer | undefined {
  return tree.transfers.find((t) => t.departDayId === dayId);
}

/**
 * Re-dates and re-sizes every leg's days from `startDate` (default: the
 * trip's), and rebuilds transfers between consecutive legs. Days a leg keeps
 * keep their ids, slots and items; when a leg shrinks, the items on its
 * removed days move to the same part of the day on its last remaining day.
 * A transfer between the same two legs keeps its mode and duration (which
 * may have been edited); new pairs are estimated.
 */
export function layoutLegs(tree: TripTree, estimate: TransferEstimator, startDate?: IsoDate): LayoutResult {
  const start = startDate ?? tree.trip.startDate;
  if (!start) throw new Error("The trip needs a start date");
  const counts = legDayCounts(tree.legs.map((l) => l.leg));
  let index = 0;
  let moved = 0;
  const legs: LegTree[] = tree.legs.map((l, i) => {
    const count = counts[i]!;
    const leg: Leg = { ...l.leg, order: i };
    const kept = l.days.slice(0, count).map((d) => {
      const at = index++;
      return { ...d, day: { ...d.day, date: addDays(start, at), index: at } };
    });
    const missing = count - kept.length;
    const added = missing > 0 ? buildDays(leg.id, dateRange(addDays(start, index), addDays(start, index + missing - 1)), index) : [];
    index += Math.max(missing, 0);
    let days = [...kept, ...added];
    const dropped = l.days.slice(count);
    const last = days[days.length - 1];
    if (last) {
      const spill = new Map<string, Item[]>();
      for (const d of dropped) for (const s of d.slots) spill.set(s.slot.part, [...(spill.get(s.slot.part) ?? []), ...s.items]);
      moved = [...spill.values()].reduce((a, items) => a + items.length, moved);
      if (spill.size > 0) {
        const merged: DayTree = {
          ...last,
          slots: last.slots.map((s) => {
            const extra = spill.get(s.slot.part);
            if (!extra?.length) return s;
            return { ...s, items: [...s.items, ...extra].map((it, order) => ({ ...it, slotId: s.slot.id, order })) };
          }),
        };
        days = [...days.slice(0, -1), merged];
      }
    }
    return { leg, days };
  });

  const transfers: Transfer[] = [];
  for (let i = 0; i + 1 < legs.length; i++) {
    const from = legs[i]!.leg;
    const to = legs[i + 1]!;
    const prev = tree.transfers.find((t) => t.fromLegId === from.id && t.toLegId === to.leg.id);
    const est = prev ? null : estimate(from.cityId, to.leg.cityId);
    transfers.push({
      id: prev?.id ?? ulid(),
      tripId: tree.trip.id,
      fromLegId: from.id,
      toLegId: to.leg.id,
      mode: prev?.mode ?? est!.mode,
      estMinutes: prev?.estMinutes ?? est!.minutes,
      departDayId: to.days[0]?.day.id ?? null,
    });
  }

  const endDate = addDays(start, Math.max(index - 1, 0));
  return { tree: { trip: { ...tree.trip, startDate: start, endDate }, legs, transfers }, moved };
}

export interface NewMultiLegTripInput {
  name: string;
  startDate: IsoDate;
  legs: readonly LegInput[];
  originCityId?: string | null;
  state?: TripState;
  now?: Date;
}

/** A trip with legs in the given order, laid out from the start date. */
export function createTrip(input: NewMultiLegTripInput, estimate: TransferEstimator): TripTree {
  if (input.legs.length === 0) throw new Error("A trip needs at least one city");
  const now = input.now ?? new Date();
  const trip: Trip = {
    id: ulid(now.getTime()),
    name: input.name,
    originCityId: input.originCityId ?? null,
    state: input.state ?? "planning",
    startDate: input.startDate,
    endDate: input.startDate,
    createdAt: now.toISOString(),
  };
  const min = minLegNights(input.legs.length);
  const legs: LegTree[] = input.legs.map((l, order) => ({
    leg: {
      id: ulid(),
      tripId: trip.id,
      cityId: l.cityId,
      order,
      nights: Math.max(Math.round(l.nights), min),
      isStopover: l.isStopover ?? false,
    },
    days: [],
  }));
  return layoutLegs({ trip, legs, transfers: [] }, estimate).tree;
}

/** Adds a leg at `index` (default: the end) and lays the trip out again. */
export function addLeg(tree: TripTree, input: LegInput, estimate: TransferEstimator, index = tree.legs.length): LayoutResult {
  const at = Math.max(0, Math.min(index, tree.legs.length));
  const leg: LegTree = {
    leg: {
      id: ulid(),
      tripId: tree.trip.id,
      cityId: input.cityId,
      order: at,
      nights: Math.max(Math.round(input.nights), minLegNights(tree.legs.length + 1)),
      isStopover: input.isStopover ?? false,
    },
    days: [],
  };
  // A day trip (no nights) that gains a second city needs a night there.
  const legs = [...tree.legs.slice(0, at), leg, ...tree.legs.slice(at)].map((l) => ({
    ...l,
    leg: { ...l.leg, nights: Math.max(l.leg.nights, minLegNights(tree.legs.length + 1)) },
  }));
  return layoutLegs({ ...tree, legs }, estimate);
}

/** Removes a leg with its days and items. The last leg can't be removed. */
export function removeLeg(tree: TripTree, legId: string, estimate: TransferEstimator): LayoutResult {
  if (tree.legs.length <= 1) throw new Error("A trip needs at least one city");
  if (!findLeg(tree, legId)) throw new Error(`No leg ${legId}`);
  return layoutLegs({ ...tree, legs: tree.legs.filter((l) => l.leg.id !== legId) }, estimate);
}

/** Puts legs in the given order (every leg id exactly once). */
export function reorderLegs(tree: TripTree, legIds: readonly string[], estimate: TransferEstimator): LayoutResult {
  const byId = new Map(tree.legs.map((l) => [l.leg.id, l]));
  if (legIds.length !== tree.legs.length || new Set(legIds).size !== legIds.length || !legIds.every((id) => byId.has(id))) {
    throw new Error("The new order must list every leg once");
  }
  return layoutLegs({ ...tree, legs: legIds.map((id) => byId.get(id)!) }, estimate);
}

export function moveLeg(tree: TripTree, legId: string, toIndex: number, estimate: TransferEstimator): LayoutResult {
  const ids = tree.legs.map((l) => l.leg.id).filter((id) => id !== legId);
  if (ids.length === tree.legs.length) throw new Error(`No leg ${legId}`);
  const at = Math.max(0, Math.min(toIndex, ids.length));
  return reorderLegs(tree, [...ids.slice(0, at), legId, ...ids.slice(at)], estimate);
}

/** Sets nights for some legs (by leg id); the trip's end date follows. */
export function setLegNights(
  tree: TripTree,
  nights: ReadonlyMap<string, number>,
  estimate: TransferEstimator,
): LayoutResult {
  const min = minLegNights(tree.legs.length);
  const legs = tree.legs.map((l) => {
    const n = nights.get(l.leg.id);
    return n === undefined ? l : { ...l, leg: { ...l.leg, nights: Math.max(Math.round(n), min) } };
  });
  return layoutLegs({ ...tree, legs }, estimate);
}

export function setLegStopover(tree: TripTree, legId: string, isStopover: boolean): TripTree {
  if (!findLeg(tree, legId)) throw new Error(`No leg ${legId}`);
  return { ...tree, legs: tree.legs.map((l) => (l.leg.id === legId ? { ...l, leg: { ...l.leg, isStopover } } : l)) };
}

/** Edits a transfer's mode or duration (an estimate the user knows better). */
export function updateTransfer(
  tree: TripTree,
  transferId: string,
  patch: Partial<Pick<Transfer, "mode" | "estMinutes">>,
): TripTree {
  if (!tree.transfers.some((t) => t.id === transferId)) throw new Error(`No transfer ${transferId}`);
  if (patch.estMinutes !== undefined && !(patch.estMinutes >= 0)) throw new Error("Duration can't be negative");
  return { ...tree, transfers: tree.transfers.map((t) => (t.id === transferId ? { ...t, ...patch } : t)) };
}
