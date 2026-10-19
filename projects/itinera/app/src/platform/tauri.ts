/**
 * Tauri 2 host: SQLite via tauri-plugin-sql, ingestion HTTP via
 * tauri-plugin-http (no CORS limits, real User-Agent), thumbnails written with
 * tauri-plugin-fs and served by the asset protocol, PMTiles packs served by the
 * shell's `tiles://` protocol handler with byte ranges.
 */
import { politeFetch, type HttpFetch, type SqlValue } from "@itinera/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BaseDirectory, mkdir, readDir, stat, writeFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import Database from "@tauri-apps/plugin-sql";
import { USER_AGENT, type Platform } from "./types";

export async function createTauriPlatform(): Promise<Platform> {
  const sql = await Database.load("sqlite:itinera.db");
  const dataDir = await appDataDir();
  await mkdir("thumbs", { baseDir: BaseDirectory.AppData, recursive: true });
  await mkdir("tiles", { baseDir: BaseDirectory.AppData, recursive: true });

  return {
    kind: "tauri",
    db: {
      async execute(query: string, params: readonly SqlValue[] = []) {
        const r = await sql.execute(query, [...params]);
        return { rowsAffected: r.rowsAffected };
      },
      async select<T>(query: string, params: readonly SqlValue[] = []) {
        return sql.select<T[]>(query, [...params]);
      },
    },
    fetch: politeFetch(tauriFetch as unknown as HttpFetch, { userAgent: USER_AGENT }),
    files: {
      async saveThumbnail(name, bytes) {
        await writeFile(`thumbs/${name}`, bytes, { baseDir: BaseDirectory.AppData });
        return `thumbs/${name}`;
      },
    },
    photoUrl(path) {
      if (!path) return null;
      if (/^https?:/.test(path)) return path;
      return convertFileSrc(`${dataDir}/${path}`.replace(/\\/g, "/"));
    },
    async tilePacks() {
      const entries = await readDir("tiles", { baseDir: BaseDirectory.AppData });
      const packs = [];
      for (const e of entries) {
        if (!e.isFile || !e.name.endsWith(".pmtiles")) continue;
        const info = await stat(await join(dataDir, "tiles", e.name));
        packs.push({ region: e.name.replace(/\.pmtiles$/, ""), url: convertFileSrc(e.name, "tiles"), sizeBytes: info.size });
      }
      return packs;
    },
    openExternal(url) {
      void openUrl(url);
    },
  };
}
