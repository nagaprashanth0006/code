import { describe, expect, it } from "vitest";
import { describeDayHours, hoursOn, hoursOnRaw, parseOpeningHours } from "../src/hours.js";

// 2026-10-19 is a Monday.
const MON = "2026-10-19";
const TUE = "2026-10-20";
const SAT = "2026-10-24";
const SUN = "2026-10-25";

const at = (raw: string, date: string) => describeDayHours(hoursOnRaw(raw, date));

describe("opening hours subset", () => {
  it("handles 24/7", () => {
    expect(at("24/7", MON)).toBe("24 h");
  });

  it("reads weekday ranges and closes unlisted days", () => {
    const raw = "Tu-Su 10:00-18:00";
    expect(at(raw, MON)).toBe("closed");
    expect(at(raw, TUE)).toBe("10:00–18:00");
    expect(at(raw, SUN)).toBe("10:00–18:00");
  });

  it("reads split times and weekday lists", () => {
    expect(at("Mo,We,Fr 09:00-12:30,14:00-17:30", MON)).toBe("09:00–12:30, 14:00–17:30");
    expect(at("Mo,We,Fr 09:00-12:30,14:00-17:30", TUE)).toBe("closed");
  });

  it("lets later rules override earlier ones for the days they match", () => {
    const raw = "Mo-Su 10:00-18:00; Mo off";
    expect(at(raw, MON)).toBe("closed");
    expect(at(raw, SAT)).toBe("10:00–18:00");
  });

  it("handles seasonal month ranges, including ones that wrap the year", () => {
    const raw = "Oct-Apr Tu-Su 10:00-17:30; May-Sep Tu-Su 10:00-18:30";
    expect(at(raw, TUE)).toBe("10:00–17:30");
    expect(at(raw, "2026-06-16")).toBe("10:00–18:30");
    expect(at(raw, MON)).toBe("closed");
  });

  it("handles month-day ranges and fixed closures", () => {
    const raw = "Mo-Su 09:00-19:00; Dec 25 off; Jan 01 off";
    expect(at(raw, "2026-12-25")).toBe("closed");
    expect(at(raw, "2026-12-26")).toBe("09:00–19:00");
    expect(at("Apr 01-Sep 30 Mo-Su 09:00-20:00; Oct 01-Mar 31 Mo-Su 09:00-18:00", "2026-04-01")).toBe("09:00–20:00");
    expect(at("Apr 01-Sep 30 Mo-Su 09:00-20:00; Oct 01-Mar 31 Mo-Su 09:00-18:00", MON)).toBe("09:00–18:00");
  });

  it("ignores holiday-only rules on ordinary days", () => {
    expect(at("Tu-Su 10:00-18:00; PH off", TUE)).toBe("10:00–18:00");
    expect(at("Su,PH 10:00-13:00", SUN)).toBe("10:00–13:00");
  });

  it("handles overnight and open-ended times", () => {
    const h = hoursOnRaw("Fr-Sa 22:00-04:00", "2026-10-23");
    expect(h).toEqual({ status: "open", intervals: [[1320, 1680]], approximate: false });
    expect(at("Mo-Su 18:00+", MON)).toBe("18:00–00:00");
  });

  it("approximates sunrise/sunset", () => {
    expect(at("sunrise-sunset", MON)).toBe("≈ 07:00–19:00");
  });

  it("subtracts times marked off", () => {
    expect(at("Mo-Fr 09:00-18:00; Mo-Fr 13:00-14:00 off", MON)).toBe("09:00–13:00, 14:00–18:00");
  });

  it("merges additional rules joined by a comma", () => {
    expect(at("Mo-Fr 09:00-12:00, We 14:00-18:00", "2026-10-21")).toBe("09:00–12:00, 14:00–18:00");
  });

  it("strips comments", () => {
    expect(at('Tu-Su 10:00-18:00 "last entry 17:30"', TUE)).toBe("10:00–18:00");
  });

  it("reports unknown instead of closed when a rule was unsupported", () => {
    const parsed = parseOpeningHours("Mo[1] 10:00-12:00");
    expect(parsed.ok).toBe(false);
    expect(hoursOn(parsed, MON).status).toBe("unknown");
    const partial = parseOpeningHours("Tu-Su 10:00-18:00; week 01-10 Mo 10:00-12:00");
    expect(partial.partial).toBe(true);
    expect(hoursOn(partial, TUE).status).toBe("open");
    expect(hoursOn(partial, MON).status).toBe("unknown");
  });

  // Strings exactly as mapped in OSM for Lisbon sights (fetched 2026-10-19).
  it("reads real Lisbon opening hours", () => {
    const belem = "Oct-Apr: Tu-Su 10:00-17:30; May-Sep: Tu-Su 10:00-18:30";
    expect(at(belem, MON)).toBe("closed");
    expect(at(belem, TUE)).toBe("10:00–17:30");
    expect(at(belem, "2026-07-14")).toBe("10:00–18:30");

    const jeronimos = "Oct-Apr 10:00-17:30; May-Sep 10:00-18:30; Mo off; Jan 1 off; May 1 off; Dec 25 off";
    expect(at(jeronimos, MON)).toBe("closed");
    expect(at(jeronimos, TUE)).toBe("10:00–17:30");
    expect(at(jeronimos, "2026-12-25")).toBe("closed");

    const coaches = "Tu-Su 10:00-18:00; Jan 01,May 01,Dec 25; easter off";
    expect(parseOpeningHours(coaches).partial).toBe(false);
    expect(at(coaches, MON)).toBe("closed");

    expect(at("09:00-20:00; Oct 01-Mar 31: 09:00-17:00", MON)).toBe("09:00–17:00");
    expect(at("Su-Mo, We-Fr 10:00-18:00; Sa 10:00-21:00", TUE)).toBe("closed");
    expect(at("Su-Mo, We-Fr 10:00-18:00; Sa 10:00-21:00", SUN)).toBe("10:00–18:00");
    expect(at("Mo-Su 12:00-20:00; Tu off; Jan 01,May 01,Dec 25", TUE)).toBe("closed");
    expect(at("Tu 14:00-18:00; We-Su 10:00-18:00; Jan 01,May 01,Jun 13,Dec 25 off;easter off", TUE)).toBe("14:00–18:00");
    expect(at("Mo-Fr 13:00-17:30; Sa 10:00-17:30; Jan 01,May 01,Dec 24-25 off; easter off", "2026-12-24")).toBe("closed");
    expect(at("10:00-12:30; 13:30-17:30", MON)).toBe("13:30–17:30"); // later rule overrides: as the spec says
    expect(at("closed", MON)).toBe("closed");
  });

  it("treats missing hours as unknown", () => {
    expect(hoursOnRaw(null, MON).status).toBe("unknown");
    expect(hoursOnRaw("  ", MON).status).toBe("unknown");
  });
});
