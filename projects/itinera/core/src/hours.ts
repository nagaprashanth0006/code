/**
 * A deliberate subset of the OSM opening_hours syntax
 * (https://wiki.openstreetmap.org/wiki/Key:opening_hours/specification).
 *
 * Supported: `24/7`; month and month-day selectors (`Oct-Mar`, `Apr 01-Sep 30`,
 * `Dec 25`); weekday selectors with ranges and lists (`Tu-Su`, `Mo,We`);
 * time ranges including overnight and open-ended (`22:00-02:00`, `10:00+`);
 * sunrise/sunset as fixed approximations; `off`/`closed`/`open`/`unknown`;
 * comments; `;` and `||` rule separators; `,` additional rules.
 *
 * Unsupported selectors (years, week numbers, nth weekday, variable event
 * offsets, easter) make that one rule skipped and the result `partial`, so the
 * checker reports "unknown" instead of guessing "closed".
 */
import { monthOf, parseIsoDate, weekdayIndex, type IsoDate } from "./dates.js";

export type Interval = readonly [start: number, end: number];

export type DayHours =
  | { status: "open"; intervals: Interval[]; approximate: boolean }
  | { status: "closed" }
  | { status: "unknown"; reason: string };

interface MonthDay {
  month: number;
  day: number;
}

interface DateRange {
  from: MonthDay;
  to: MonthDay;
}

type Modifier = "open" | "closed" | "unknown";

export interface Rule {
  dates: DateRange[] | null;
  /** Weekday indexes 0 (Mo) … 6 (Su); null = every day. */
  weekdays: number[] | null;
  /** True if the weekday selector only named holidays (PH/SH), which we cannot evaluate. */
  holidayOnly: boolean;
  times: Interval[] | null;
  modifier: Modifier;
  approximate: boolean;
  /** Joined to the previous rule with ",": adds to it instead of overriding it. */
  additional: boolean;
}

export interface OpeningHours {
  raw: string;
  rules: Rule[];
  /** Some rules were skipped as unsupported. */
  partial: boolean;
  /** At least one rule parsed. */
  ok: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];
const HOLIDAYS = ["ph", "sh"];
const EVENTS: Record<string, number> = { dawn: 6 * 60 + 30, sunrise: 7 * 60, sunset: 19 * 60, dusk: 19 * 60 + 30 };
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const TOKEN = /"[^"]*"|\d{1,2}:\d{2}\+?|[A-Za-z]+|\d+|\[[^\]]*\]|\|\||\S/g;

class Unsupported extends Error {}

function tokenize(rule: string): string[] {
  return (rule.match(TOKEN) ?? []).filter((t) => !t.startsWith('"'));
}

const isMonth = (t: string | undefined) => t !== undefined && MONTHS.includes(t.toLowerCase());
const isWeekday = (t: string | undefined) =>
  t !== undefined && (WEEKDAYS.includes(t.toLowerCase()) || HOLIDAYS.includes(t.toLowerCase()));
const isTime = (t: string | undefined) => t !== undefined && /^\d{1,2}:\d{2}\+?$/.test(t);
const isEvent = (t: string | undefined) => t !== undefined && t.toLowerCase() in EVENTS;
const isDayNumber = (t: string | undefined) => t !== undefined && /^\d{1,2}$/.test(t);

class RuleParser {
  pos = 0;
  constructor(private readonly tokens: string[]) {}

  peek(offset = 0): string | undefined {
    return this.tokens[this.pos + offset];
  }

  next(): string {
    const t = this.tokens[this.pos++];
    if (t === undefined) throw new Unsupported("unexpected end");
    return t;
  }

  done(): boolean {
    return this.pos >= this.tokens.length;
  }

  parseDates(): DateRange[] | null {
    if (!isMonth(this.peek())) {
      if (/^\d{4}$/.test(this.peek() ?? "")) throw new Unsupported("year selector");
      return null;
    }
    const ranges: DateRange[] = [];
    do {
      if (ranges.length > 0) this.next(); // ","
      const fromMonth = MONTHS.indexOf(this.next().toLowerCase()) + 1;
      const fromDay = isDayNumber(this.peek()) ? Number(this.next()) : null;
      let to: MonthDay;
      if (this.peek() === "-" && (isMonth(this.peek(1)) || isDayNumber(this.peek(1)))) {
        this.next();
        const toMonth = isMonth(this.peek()) ? MONTHS.indexOf(this.next().toLowerCase()) + 1 : fromMonth;
        const toDay = isDayNumber(this.peek()) ? Number(this.next()) : MONTH_LENGTHS[toMonth - 1]!;
        to = { month: toMonth, day: toDay };
      } else {
        to = { month: fromMonth, day: fromDay ?? MONTH_LENGTHS[fromMonth - 1]! };
      }
      ranges.push({ from: { month: fromMonth, day: fromDay ?? 1 }, to });
    } while (this.peek() === "," && isMonth(this.peek(1)));
    return ranges;
  }

  parseWeekdays(): { weekdays: number[] | null; holidayOnly: boolean } {
    if (!isWeekday(this.peek())) return { weekdays: null, holidayOnly: false };
    const days = new Set<number>();
    let sawHoliday = false;
    let first = true;
    while (first || (this.peek() === "," && isWeekday(this.peek(1)))) {
      if (!first) this.next();
      first = false;
      const t = this.next().toLowerCase();
      if (HOLIDAYS.includes(t)) {
        sawHoliday = true;
        continue;
      }
      const from = WEEKDAYS.indexOf(t);
      let to = from;
      if (this.peek() === "-" && WEEKDAYS.includes((this.peek(1) ?? "").toLowerCase())) {
        this.next();
        to = WEEKDAYS.indexOf(this.next().toLowerCase());
      }
      if (this.peek()?.startsWith("[")) throw new Unsupported("nth weekday");
      for (let d = from; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === to) break;
      }
    }
    return { weekdays: [...days].sort(), holidayOnly: sawHoliday && days.size === 0 };
  }

  parseTimePoint(): { minutes: number; approximate: boolean; openEnded: boolean } {
    const t = this.next();
    if (isEvent(t)) return { minutes: EVENTS[t.toLowerCase()]!, approximate: true, openEnded: false };
    if (t === "(") throw new Unsupported("event offset");
    const m = /^(\d{1,2}):(\d{2})(\+?)$/.exec(t);
    if (!m) throw new Unsupported(`time "${t}"`);
    return { minutes: Number(m[1]) * 60 + Number(m[2]), approximate: false, openEnded: m[3] === "+" };
  }

  parseTimes(): { times: Interval[] | null; approximate: boolean } {
    if (!isTime(this.peek()) && !isEvent(this.peek())) return { times: null, approximate: false };
    const times: Interval[] = [];
    let approximate = false;
    let first = true;
    while (first || (this.peek() === "," && (isTime(this.peek(1)) || isEvent(this.peek(1))))) {
      if (!first) this.next();
      first = false;
      const start = this.parseTimePoint();
      approximate ||= start.approximate;
      if (start.openEnded) {
        times.push([start.minutes, 24 * 60]);
        continue;
      }
      if (this.next() !== "-") throw new Unsupported("time range");
      const end = this.parseTimePoint();
      approximate ||= end.approximate;
      let endMin = end.minutes;
      if (endMin <= start.minutes) endMin += 24 * 60; // overnight
      times.push([start.minutes, endMin]);
    }
    return { times, approximate };
  }

  parseModifier(): Modifier | null {
    const t = this.peek()?.toLowerCase();
    if (t === "off" || t === "closed") {
      this.next();
      return "closed";
    }
    if (t === "open" || t === "unknown") {
      this.next();
      return t;
    }
    return null;
  }

  /** Parses one rule; returns true if a "," additional rule follows. */
  parseRule(additional: boolean, out: Rule[]): boolean {
    if (this.peek() === "24" && this.peek(1) === "/" && this.peek(2) === "7") {
      this.pos += 3;
      out.push({
        dates: null,
        weekdays: null,
        holidayOnly: false,
        times: [[0, 24 * 60]],
        modifier: this.parseModifier() ?? "open",
        approximate: false,
        additional,
      });
    } else if (this.peek()?.toLowerCase() === "easter") {
      // A single moveable feast, like a public holiday: never matches an ordinary day.
      this.pos = this.tokens.length;
      out.push({ dates: null, weekdays: null, holidayOnly: true, times: null, modifier: "closed", approximate: false, additional });
      return false;
    } else {
      const dates = this.parseDates();
      if (dates && this.peek() === ":") this.next(); // "Oct-Apr: Tu-Su …"
      const { weekdays, holidayOnly } = this.parseWeekdays();
      if (weekdays && this.peek() === ":") this.next();
      const { times, approximate } = this.parseTimes();
      const modifier = this.parseModifier() ?? "open";
      if (!dates && !weekdays && !holidayOnly && !times && modifier === "open") {
        throw new Unsupported(`selector "${this.peek()}"`);
      }
      out.push({ dates, weekdays, holidayOnly, times, modifier, approximate, additional });
    }
    if (this.done()) return false;
    if (this.peek() === ",") {
      this.next();
      return true;
    }
    throw new Unsupported(`trailing "${this.peek()}"`);
  }
}

const cache = new Map<string, OpeningHours>();

export function parseOpeningHours(raw: string): OpeningHours {
  const cached = cache.get(raw);
  if (cached) return cached;
  const rules: Rule[] = [];
  let partial = false;
  for (const part of raw.split(/;|\|\|/)) {
    const text = part.trim();
    if (!text) continue;
    const parser = new RuleParser(tokenize(text));
    const parsed: Rule[] = [];
    try {
      let additional = false;
      while (!parser.done()) additional = parser.parseRule(additional, parsed);
      rules.push(...parsed);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      partial = true;
    }
  }
  const result: OpeningHours = { raw, rules, partial, ok: rules.length > 0 };
  if (cache.size > 5000) cache.clear();
  cache.set(raw, result);
  return result;
}

function ordinal(md: MonthDay): number {
  return md.month * 100 + md.day;
}

function matchesDate(rule: Rule, date: IsoDate): boolean {
  if (rule.holidayOnly) return false;
  if (rule.weekdays && !rule.weekdays.includes(weekdayIndex(date))) return false;
  if (rule.dates) {
    const x = monthOf(date) * 100 + parseIsoDate(date).getUTCDate();
    const inAny = rule.dates.some(({ from, to }) => {
      const a = ordinal(from);
      const b = ordinal(to);
      return a <= b ? x >= a && x <= b : x >= a || x <= b;
    });
    if (!inAny) return false;
  }
  return true;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function subtractIntervals(from: Interval[], remove: Interval[]): Interval[] {
  let result: Interval[] = from;
  for (const [rs, re] of remove) {
    const next: Interval[] = [];
    for (const [s, e] of result) {
      if (re <= s || rs >= e) next.push([s, e]);
      else {
        if (rs > s) next.push([s, rs]);
        if (re < e) next.push([re, e]);
      }
    }
    result = next;
  }
  return result;
}

/** Opening hours on a given date. */
export function hoursOn(hours: OpeningHours, date: IsoDate): DayHours {
  if (!hours.ok) return { status: "unknown", reason: `Couldn't read opening hours "${hours.raw}"` };
  let result: DayHours | null = null;
  for (const rule of hours.rules) {
    if (!matchesDate(rule, date)) continue;
    const times = rule.times ?? [[0, 24 * 60] as Interval];
    const current = result as DayHours | null;
    if (rule.modifier === "unknown") {
      result = { status: "unknown", reason: "Opening hours marked unknown" };
    } else if (rule.modifier === "closed") {
      if (rule.times && current?.status === "open") {
        const left = subtractIntervals(current.intervals, rule.times);
        result = left.length ? { status: "open", intervals: left, approximate: current.approximate } : { status: "closed" };
      } else {
        result = { status: "closed" };
      }
    } else if (rule.additional && current?.status === "open") {
      result = {
        status: "open",
        intervals: mergeIntervals([...current.intervals, ...times]),
        approximate: current.approximate || rule.approximate,
      };
    } else {
      result = { status: "open", intervals: mergeIntervals(times), approximate: rule.approximate };
    }
  }
  if (result) return result;
  return hours.partial
    ? { status: "unknown", reason: `Opening hours only partly understood: "${hours.raw}"` }
    : { status: "closed" };
}

export function hoursOnRaw(raw: string | null, date: IsoDate): DayHours {
  if (raw === null || raw.trim() === "") return { status: "unknown", reason: "No opening hours on record" };
  return hoursOn(parseOpeningHours(raw), date);
}

export function formatIntervals(intervals: readonly Interval[]): string {
  const fmt = (m: number) => {
    const mm = m % (24 * 60);
    return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
  };
  return intervals.map(([s, e]) => (s === 0 && e === 24 * 60 ? "24 h" : `${fmt(s)}–${fmt(e)}`)).join(", ");
}

export function describeDayHours(h: DayHours): string {
  switch (h.status) {
    case "open":
      return (h.approximate ? "≈ " : "") + formatIntervals(h.intervals);
    case "closed":
      return "closed";
    case "unknown":
      return "hours unknown";
  }
}
