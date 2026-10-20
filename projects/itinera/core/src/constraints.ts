/**
 * Deterministic constraint checker. Given a day's slots and items, it lays out
 * a timeline (visits in order, with estimated travel between them) and flags:
 * places closed that day or at the planned time, long travel between items,
 * slots and days that run over, and transfer days that are overfull.
 *
 * It runs on every edit and on every LLM draft before display, so it must stay
 * pure, fast and explainable: each conflict carries a human-readable message.
 */
import { CATEGORY_INFO } from "./categories.js";
import { formatDuration, formatMinutes, weekdayName, type IsoDate } from "./dates.js";
import { estimateInCityTravel, type LatLon } from "./geo.js";
import { describeDayHours, hoursOnRaw, type Interval } from "./hours.js";
import { allDays, type TripTree } from "./itinerary.js";
import type { Item, PlaceCategory, SlotPart, Transfer, TransportMode } from "./schemas.js";

export type Severity = "error" | "warning" | "info";

export type ConflictKind =
  | "closed-day"
  | "closed-at-time"
  | "hours-unknown"
  | "travel-time"
  | "slot-overrun"
  | "day-overfull"
  | "transfer-overfull"
  | "alternate-closed";

export interface Conflict {
  kind: ConflictKind;
  severity: Severity;
  message: string;
  dayId: string;
  itemId?: string;
}

/** The fields of a place the checker needs. */
export interface CheckPlace extends LatLon {
  id: string;
  name: string;
  category: PlaceCategory;
  hoursRaw: string | null;
}

export interface ScheduleEntry {
  itemId: string;
  slotPart: SlotPart;
  start: number;
  end: number;
  travelMinutes: number;
  travelMode: TransportMode | null;
  /** Minutes spent waiting for the place to open. */
  waitMinutes: number;
}

export interface CheckOptions {
  dayStart: number;
  dayEnd: number;
  slotWindows: Record<SlotPart, Interval>;
  /** Travel between consecutive items above this is flagged. */
  maxTravelMinutes: number;
  /** A slot may run this many minutes past its window before it is flagged. */
  slotGraceMinutes: number;
}

export const DEFAULT_CHECK_OPTIONS: CheckOptions = {
  dayStart: 9 * 60,
  dayEnd: 22 * 60,
  slotWindows: {
    morning: [9 * 60, 12 * 60 + 30],
    afternoon: [13 * 60 + 30, 18 * 60],
    evening: [18 * 60 + 30, 22 * 60],
  },
  maxTravelMinutes: 40,
  slotGraceMinutes: 20,
};

export interface DayCheckInput {
  dayId: string;
  date: IsoDate;
  slots: ReadonlyArray<{ part: SlotPart; items: readonly Item[] }>;
  places: ReadonlyMap<string, CheckPlace>;
  /** A transfer that consumes the start of this day. */
  transfer?: { minutes: number; label: string } | null;
  options?: Partial<CheckOptions>;
}

export interface DayCheckResult {
  schedule: ScheduleEntry[];
  /** When the day's transfer runs (it starts the day), if it has one. */
  transfer: { start: number; end: number } | null;
  conflicts: Conflict[];
  /** Time the last planned activity ends. */
  endsAt: number;
}

export function itemName(item: Item, places: ReadonlyMap<string, CheckPlace>): string {
  return (item.placeId ? places.get(item.placeId)?.name : null) ?? item.customName ?? "Untitled";
}

export function itemDuration(item: Item, place: CheckPlace | undefined): number {
  return item.durationMin ?? (place ? CATEGORY_INFO[place.category].visitMinutes : 60);
}

export function checkDay(input: DayCheckInput): DayCheckResult {
  const opts: CheckOptions = { ...DEFAULT_CHECK_OPTIONS, ...input.options };
  const { dayId, date, places } = input;
  const conflicts: Conflict[] = [];
  const schedule: ScheduleEntry[] = [];
  let cursor = opts.dayStart;
  let prev: CheckPlace | undefined;

  const transferWindow =
    input.transfer && input.transfer.minutes > 0 ? { start: cursor, end: cursor + input.transfer.minutes } : null;
  if (transferWindow) cursor = transferWindow.end;

  for (const slot of input.slots) {
    const [windowStart, windowEnd] = opts.slotWindows[slot.part];
    const ordered = [...slot.items].sort((a, b) => a.order - b.order);
    for (const item of ordered.filter((i) => i.isPrimary)) {
      const place = item.placeId ? places.get(item.placeId) : undefined;
      const name = itemName(item, places);
      const duration = itemDuration(item, place);

      let travelMinutes = 0;
      let travelMode: TransportMode | null = null;
      if (prev && place) {
        const t = estimateInCityTravel(prev, place);
        travelMinutes = t.minutes;
        travelMode = t.mode;
        if (t.minutes > opts.maxTravelMinutes) {
          conflicts.push({
            kind: "travel-time",
            severity: "warning",
            dayId,
            itemId: item.id,
            message: `${name} is about ${formatDuration(t.minutes)} from ${prev.name} (${t.km.toFixed(1)} km).`,
          });
        }
      }

      let start = Math.max(cursor + travelMinutes, windowStart);
      let wait = 0;
      if (place) {
        const hours = hoursOnRaw(place.hoursRaw, date);
        if (hours.status === "closed") {
          conflicts.push({
            kind: "closed-day",
            severity: "error",
            dayId,
            itemId: item.id,
            message: `${name} is closed on ${weekdayName(date)}s.`,
          });
        } else if (hours.status === "open") {
          const fits = hours.intervals.find(([s, e]) => start >= s && start + duration <= e);
          if (!fits) {
            const later = hours.intervals.find(([s, e]) => s > start && s + duration <= e);
            if (later && later[0] + duration <= windowEnd + opts.slotGraceMinutes) {
              wait = later[0] - start;
              start = later[0];
            } else {
              conflicts.push({
                kind: "closed-at-time",
                severity: "warning",
                dayId,
                itemId: item.id,
                message: `${name} is open ${describeDayHours(hours)} on ${weekdayName(date)}; planned ${formatMinutes(start)}–${formatMinutes(start + duration)}.`,
              });
            }
          }
        } else if (place.hoursRaw) {
          conflicts.push({ kind: "hours-unknown", severity: "info", dayId, itemId: item.id, message: hours.reason });
        }
      }

      const end = start + duration;
      if (end > windowEnd + opts.slotGraceMinutes) {
        conflicts.push({
          kind: "slot-overrun",
          severity: "warning",
          dayId,
          itemId: item.id,
          message: `${name} runs to ${formatMinutes(end)}, past the ${slot.part} (ends ${formatMinutes(windowEnd)}).`,
        });
      }
      schedule.push({ itemId: item.id, slotPart: slot.part, start, end, travelMinutes, travelMode, waitMinutes: wait });
      cursor = end;
      if (place) prev = place;
    }

    for (const alt of ordered.filter((i) => !i.isPrimary)) {
      const place = alt.placeId ? places.get(alt.placeId) : undefined;
      if (place && hoursOnRaw(place.hoursRaw, date).status === "closed") {
        conflicts.push({
          kind: "alternate-closed",
          severity: "info",
          dayId,
          itemId: alt.id,
          message: `Alternate ${place.name} is closed on ${weekdayName(date)}s.`,
        });
      }
    }
  }

  if (cursor > opts.dayEnd) {
    const transfer = input.transfer && input.transfer.minutes > 0 ? input.transfer : null;
    conflicts.push(
      transfer && schedule.length === 0
        ? {
            kind: "transfer-overfull",
            severity: "warning",
            dayId,
            message: `${transfer.label} takes ${formatDuration(transfer.minutes)} and arrives around ${formatMinutes(cursor)}; nothing else fits this day.`,
          }
        : transfer
        ? {
            kind: "transfer-overfull",
            severity: "error",
            dayId,
            message: `${transfer.label} takes ${formatDuration(transfer.minutes)}; with the planned visits the day runs to ${formatMinutes(cursor)}.`,
          }
        : {
            kind: "day-overfull",
            severity: "error",
            dayId,
            message: `The day runs to ${formatMinutes(cursor)}, past ${formatMinutes(opts.dayEnd)}. Move something to another day.`,
          },
    );
  }

  return { schedule, transfer: transferWindow, conflicts, endsAt: cursor };
}

export interface TripCheckResult {
  byDay: Map<string, DayCheckResult>;
  conflicts: Conflict[];
}

export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  walk: "Walk",
  transit: "Transit",
  road: "Road",
  rail: "Train",
  bus: "Bus",
  ferry: "Ferry",
  flight: "Flight",
};

/** "Train from Lisbon to Porto", or "Train" when the city names aren't known. */
export function transferLabel(tree: TripTree, transfer: Transfer, cityName?: (cityId: string) => string | undefined): string {
  const mode = TRANSPORT_LABELS[transfer.mode];
  const from = tree.legs.find((l) => l.leg.id === transfer.fromLegId)?.leg.cityId;
  const to = tree.legs.find((l) => l.leg.id === transfer.toLegId)?.leg.cityId;
  const a = from && cityName?.(from);
  const b = to && cityName?.(to);
  return a && b ? `${mode} from ${a} to ${b}` : mode;
}

/**
 * Checks every day of a trip. Transfers consume the start of the day they
 * arrive on (the first day of the leg they go to).
 */
export function checkTrip(
  tree: TripTree,
  places: ReadonlyMap<string, CheckPlace>,
  options?: Partial<CheckOptions>,
  cityName?: (cityId: string) => string | undefined,
): TripCheckResult {
  const transferByDay = new Map<string, { minutes: number; label: string }>();
  for (const t of tree.transfers) {
    if (t.departDayId) transferByDay.set(t.departDayId, { minutes: t.estMinutes, label: transferLabel(tree, t, cityName) });
  }
  const byDay = new Map<string, DayCheckResult>();
  const conflicts: Conflict[] = [];
  for (const d of allDays(tree)) {
    const result = checkDay({
      dayId: d.day.id,
      date: d.day.date,
      slots: d.slots.map((s) => ({ part: s.slot.part, items: s.items })),
      places,
      transfer: transferByDay.get(d.day.id) ?? null,
      ...(options ? { options } : {}),
    });
    byDay.set(d.day.id, result);
    conflicts.push(...result.conflicts);
  }
  return { byDay, conflicts };
}
