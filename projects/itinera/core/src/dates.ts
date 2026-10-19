/**
 * Calendar helpers on ISO dates ("YYYY-MM-DD"). Trip dates are local calendar
 * days with no time zone, so everything here works in UTC to avoid DST drift.
 */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(date: IsoDate): Date {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Not an ISO date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== date) throw new Error(`Invalid date: ${date}`);
  return d;
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(start: IsoDate, end: IsoDate): number {
  return Math.round((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / 86_400_000);
}

/** Weekday index in OSM order: 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: IsoDate): number {
  return (parseIsoDate(date).getUTCDay() + 6) % 7;
}

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function weekdayName(date: IsoDate): string {
  return WEEKDAY_NAMES[weekdayIndex(date)]!;
}

/** 1-based month. */
export function monthOf(date: IsoDate): number {
  return parseIsoDate(date).getUTCMonth() + 1;
}

/**
 * Day of year on a fixed 366-day calendar (Feb 29 = 60, Mar 1 = 61 in every
 * year), so climate normals line up across leap and non-leap years.
 */
export function dayOfYear366(date: IsoDate): number {
  const d = parseIsoDate(date);
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const leapStarts = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  return leapStarts[month]! + day;
}

/** "HH:MM" from minutes after midnight (wraps past 24h). */
export function formatMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Months from `today` (inclusive) for `count` months, as 1-based numbers with years. */
export function monthWindow(today: IsoDate, count: number): Array<{ year: number; month: number }> {
  const d = parseIsoDate(today);
  const out: Array<{ year: number; month: number }> = [];
  for (let i = 0; i < count; i++) {
    const m = d.getUTCMonth() + i;
    out.push({ year: d.getUTCFullYear() + Math.floor(m / 12), month: (m % 12) + 1 });
  }
  return out;
}
