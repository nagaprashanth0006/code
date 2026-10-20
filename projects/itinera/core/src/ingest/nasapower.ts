/**
 * Daily history from NASA POWER (MERRA-2 reanalysis, ~50 km grid), for the
 * destination index's approximate monthly weather. One request covers 20
 * years at a point; Open-Meteo's archive weighs such a request as hundreds of
 * calls, too many for a hundred destinations on the free tier. Fetched cities
 * still get Open-Meteo's finer daily normals.
 *
 * The grid averages terrain, so a hill station reads as warm as the plains
 * around it (Ooty: grid cell at ~785 m, town at ~2,230 m). Temperatures are
 * moved to the place's real elevation with the standard lapse rate.
 */
import { z } from "zod";
import type { DailyHistory } from "../climate.js";
import { query, type HttpFetch } from "./http.js";

const Series = z.record(z.string(), z.number());

const PowerResponse = z.object({
  /** [lon, lat, grid-cell elevation in metres] */
  geometry: z.object({ coordinates: z.array(z.number()) }).optional(),
  properties: z.object({
    parameter: z.object({ T2M_MAX: Series, T2M_MIN: Series, PRECTOTCORR: Series }),
  }),
  header: z.object({ fill_value: z.number() }).optional(),
});

export const POWER_ATTRIBUTION = "NASA Langley Research Center POWER Project";

/** Standard atmosphere: temperature falls about 6.5 °C per kilometre of height. */
export const LAPSE_RATE_C_PER_M = 0.0065;

export interface PowerHistory extends DailyHistory {
  /** Elevation of the grid cell the series describes, when POWER reports it. */
  gridElevationM: number | null;
}

/** Shifts daily temperatures from one elevation to another; precipitation is left alone. */
export function lapseCorrect(h: DailyHistory, fromElevationM: number, toElevationM: number): DailyHistory {
  const delta = (fromElevationM - toElevationM) * LAPSE_RATE_C_PER_M;
  const shift = (v: number | null) => (v === null ? null : Math.round((v + delta) * 100) / 100);
  return { ...h, tmin: h.tmin.map(shift), tmax: h.tmax.map(shift) };
}

/** Turns POWER's `{ "YYYYMMDD": value }` series into the shape climate normals take. */
export function parsePowerDaily(json: unknown): PowerHistory {
  const data = PowerResponse.parse(json);
  const fill = data.header?.fill_value ?? -999;
  const { T2M_MAX, T2M_MIN, PRECTOTCORR } = data.properties.parameter;
  const keys = Object.keys(T2M_MAX).sort();
  const value = (v: number | undefined) => (v === undefined || v === fill ? null : v);
  return {
    gridElevationM: data.geometry?.coordinates[2] ?? null,
    time: keys.map((k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`),
    tmax: keys.map((k) => value(T2M_MAX[k])),
    tmin: keys.map((k) => value(T2M_MIN[k])),
    precip: keys.map((k) => value(PRECTOTCORR[k])),
  };
}

export async function fetchPowerDailyHistory(
  fetch: HttpFetch,
  lat: number,
  lon: number,
  window: { start: string; end: string },
): Promise<PowerHistory> {
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${query({
    parameters: "T2M_MAX,T2M_MIN,PRECTOTCORR",
    community: "RE",
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    start: window.start.replaceAll("-", ""),
    end: window.end.replaceAll("-", ""),
    format: "JSON",
  })}`;
  return parsePowerDaily(await (await fetch(url)).json());
}
