import type { Platform } from "./types";

export type { LocalTilePack, Platform } from "./types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

/** Loads only the adapter for the current host, so neither bundles the other's runtime. */
export async function createPlatform(): Promise<Platform> {
  if (isTauri()) return (await import("./tauri")).createTauriPlatform();
  return (await import("./browser")).createBrowserPlatform();
}
