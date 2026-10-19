/**
 * Browser harness for UI development (`npm run dev`, opened in a browser).
 * SQLite runs in WebAssembly (sql.js) and is persisted to IndexedDB. On first
 * load it seeds from the ingest CLI's database if the dev server has one, so
 * the UI can be worked on without a 3-minute fetch.
 */
import { politeFetch, type HttpFetch, type SqlValue } from "@itinera/core";
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { USER_AGENT, type Platform } from "./types";

const IDB_NAME = "itinera";
const IDB_KEY = "db";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Uint8Array | null> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("files").objectStore("files").get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(bytes: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadSeed(): Promise<Uint8Array | null> {
  try {
    const res = await fetch("/__dev/itinera.db");
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function createBrowserPlatform(): Promise<Platform> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  // `?reset-db` drops the stored copy and re-seeds from the dev server.
  const reset = new URLSearchParams(location.search).has("reset-db");
  const stored = reset ? null : await idbGet().catch(() => null);
  const seeded = stored ? null : await loadSeed();
  const db: Database = new SQL.Database(stored ?? seeded ?? undefined);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void idbPut(db.export()), 300);
  };
  if (seeded) scheduleSave();

  return {
    kind: "browser",
    db: {
      async execute(sql: string, params: readonly SqlValue[] = []) {
        db.run(sql, params.length ? [...params] : undefined);
        scheduleSave();
        return { rowsAffected: db.getRowsModified() };
      },
      async select<T>(sql: string, params: readonly SqlValue[] = []) {
        const stmt = db.prepare(sql);
        try {
          if (params.length) stmt.bind([...params]);
          const rows: T[] = [];
          while (stmt.step()) rows.push(stmt.getAsObject() as T);
          return rows;
        } finally {
          stmt.free();
        }
      },
    },
    fetch: politeFetch(((url, init) => fetch(url, init)) as HttpFetch, { userAgent: USER_AGENT, browser: true }),
    files: null,
    photoUrl(path) {
      if (!path) return null;
      if (/^https?:/.test(path)) return path;
      return `/__dev/${path}`; // thumbnails written by the ingest CLI
    },
    async tilePacks() {
      try {
        const names = (await (await fetch("/__dev/tiles/")).json()) as string[];
        return names.map((n) => ({ region: n.replace(/\.pmtiles$/, ""), url: `${location.origin}/__dev/tiles/${n}`, sizeBytes: 0 }));
      } catch {
        return [];
      }
    },
    openExternal(url) {
      window.open(url, "_blank", "noopener");
    },
  };
}
