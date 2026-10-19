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
