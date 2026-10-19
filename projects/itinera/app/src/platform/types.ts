import type { FileStore, HttpFetch, SqlExecutor } from "@itinera/core";

export interface LocalTilePack {
  region: string;
  /** URL the PMTiles reader fetches with byte ranges. */
  url: string;
  sizeBytes: number;
}

/**
 * Everything the UI needs from the host. The Tauri shell is the product; the
 * browser harness exists so the UI can be developed and tested without it.
 */
export interface Platform {
  kind: "tauri" | "browser";
  db: SqlExecutor;
  /** Polite fetch for ingestion (rate limits, retries, identification). */
  fetch: HttpFetch;
  files: FileStore | null;
  /** Turns a stored photo path (relative to the app data dir, or a URL) into an <img> src. */
  photoUrl(path: string | null): string | null;
  tilePacks(): Promise<LocalTilePack[]>;
  openExternal(url: string): void;
}

export const USER_AGENT = "Itinera/0.1 (personal offline trip planner; https://github.com/nagaprashanth0006/code)";
