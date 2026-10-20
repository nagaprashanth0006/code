/** Ground elevation from Open-Meteo's elevation API (Copernicus 90 m DEM). */
import { z } from "zod";
import { query, type HttpFetch } from "./http.js";

const ElevationResponse = z.object({ elevation: z.array(z.number()) });

export async function fetchElevation(fetch: HttpFetch, lat: number, lon: number): Promise<number | null> {
  const url = `https://api.open-meteo.com/v1/elevation?${query({ latitude: lat.toFixed(4), longitude: lon.toFixed(4) })}`;
  const value = ElevationResponse.parse(await (await fetch(url)).json()).elevation[0];
  return value === undefined || Number.isNaN(value) ? null : value;
}
