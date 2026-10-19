import { allDays, type IsoDate } from "@itinera/core";
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
