/**
 * Trip lifecycle: wishlist → idea → planning → ready → on trip → done.
 * One trip object moves through states; each step forward has a guard, and a
 * trip can step back one state (except out of "done").
 */
import { addDays, type IsoDate } from "./dates.js";
import type { Trip, TripState } from "./schemas.js";

export const TRIP_STATE_LABELS: Record<TripState, string> = {
  wishlist: "Wishlist",
  idea: "Idea",
  planning: "Planning",
  ready: "Ready",
  on_trip: "On trip",
  done: "Done",
};

const ALLOWED: Record<TripState, readonly TripState[]> = {
  wishlist: ["idea"],
  idea: ["wishlist", "planning"],
  planning: ["idea", "ready"],
  ready: ["planning", "on_trip"],
  on_trip: ["ready", "done"],
  done: [],
};

export interface LifecycleContext {
  legCount: number;
  today: IsoDate;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canTransition(trip: Trip, to: TripState, ctx: LifecycleContext): TransitionCheck {
  if (!ALLOWED[trip.state].includes(to)) {
    return { ok: false, reason: `A trip can't go from ${TRIP_STATE_LABELS[trip.state]} to ${TRIP_STATE_LABELS[to]}.` };
  }
  switch (to) {
    case "idea":
      if (ctx.legCount < 1) return { ok: false, reason: "Pick at least one city first." };
      break;
    case "planning":
    case "ready":
      if (!trip.startDate || !trip.endDate) return { ok: false, reason: "Set the trip dates first." };
      break;
    case "on_trip":
      if (!trip.startDate || !trip.endDate) return { ok: false, reason: "Set the trip dates first." };
      if (ctx.today < addDays(trip.startDate, -1) || ctx.today > trip.endDate) {
        return { ok: false, reason: "A trip can only start around its dates." };
      }
      break;
    case "done":
      if (!trip.startDate || ctx.today < trip.startDate) return { ok: false, reason: "The trip hasn't started yet." };
      break;
    default:
      break;
  }
  return { ok: true };
}

export function transition(trip: Trip, to: TripState, ctx: LifecycleContext): Trip {
  const check = canTransition(trip, to, ctx);
  if (!check.ok) throw new Error(check.reason);
  return { ...trip, state: to };
}

/** The state the calendar suggests (ready → on trip on day one, on trip → done after the last day). */
export function suggestedState(trip: Trip, today: IsoDate): TripState {
  if (trip.state === "ready" && trip.startDate && trip.endDate && today >= trip.startDate && today <= trip.endDate) {
    return "on_trip";
  }
  if (trip.state === "on_trip" && trip.endDate && today > trip.endDate) return "done";
  return trip.state;
}
