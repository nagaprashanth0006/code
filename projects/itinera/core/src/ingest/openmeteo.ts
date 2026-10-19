/** Daily history from the Open-Meteo historical archive, for climate normals. */
import { z } from "zod";
import type { DailyHistory } from "../climate.js";
import { query, type HttpFetch } from "./http.js";

const ArchiveResponse = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_min: z.array(z.number().nullable()),
    temperature_2m_max: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
  }),
});

/** Twenty full calendar years ending the year before `today`. */
export function historyWindow(today: Date, years = 20): { start: string; end: string } {
  const lastYear = today.getUTCFullYear() - 1;
  return { start: `${lastYear - years + 1}-01-01`, end: `${lastYear}-12-31` };
}

export async function fetchDailyHistory(
  fetch: HttpFetch,
  lat: number,
  lon: number,
  window: { start: string; end: string },
): Promise<DailyHistory> {
  const url = `https://archive-api.open-meteo.com/v1/archive?${query({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: window.start,
    end_date: window.end,
    daily: "temperature_2m_min,temperature_2m_max,precipitation_sum",
    timezone: "auto",
  })}`;
  const { daily } = ArchiveResponse.parse(await (await fetch(url)).json());
  return {
    time: daily.time,
    tmin: daily.temperature_2m_min,
    tmax: daily.temperature_2m_max,
    precip: daily.precipitation_sum,
  };
}
