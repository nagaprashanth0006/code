import { allDays, type IsoDate } from "@itinera/core";
import { useEffect, useRef } from "react";
import { useStore } from "../state/store";

/** Date of the selected day in the plan (used to show that day's opening hours). */
export function useSelectedDate(): IsoDate | null {
  const { tree, selectedDayId } = useStore();
  if (!tree) return null;
  const day = allDays(tree).find((d) => d.day.id === selectedDayId) ?? allDays(tree)[0];
  return day?.day.date ?? null;
}

/** "Mon 19 Oct" */
export function shortDate(date: IsoDate): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Closes a popover menu on a click outside it or Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}
