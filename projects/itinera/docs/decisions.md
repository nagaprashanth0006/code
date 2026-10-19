# Decision log

One entry per significant choice: context, decision, alternatives, consequences. Newest first. Scoping decisions made before implementation are in the PRD's decision table; these were made while building P1.1.

## 2026-10-19 · Content Security Policy left off for P1.1

- **Context:** MapLibre needs blob workers, the tiles and asset protocols, and an online tile fallback; a wrong CSP fails silently as blank maps.
- **Decision:** `csp: null` in `tauri.conf.json` for P1.1. The app loads only bundled code; remote text is rendered as text by React.
- **Alternatives:** A strict CSP now.
- **Consequences:** Must be set before the P1.3 installers. Tracked as a follow-up.

## 2026-10-19 · MapLibre 6 worker loaded through Vite

- **Context:** MapLibre 6 ships its worker as a separate ES module. Served as a page module by the Vite dev server, it gets the HMR client injected and never starts, so styles never finish loading.
- **Decision:** `import url from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"` and `setWorkerUrl(url)`.
- **Alternatives:** Copy the worker into `public/`; pin MapLibre 5.
- **Consequences:** Works in dev and in the bundle; one line to remove if MapLibre changes how it locates its worker.

## 2026-10-19 · Offline map fonts and sprites bundled in the app

- **Context:** The Protomaps style needs glyph PBFs and sprites; fetching them from GitHub breaks offline use.
- **Decision:** `npm run ingest -- map-assets` downloads Noto Sans Regular/Medium/Italic glyph ranges for Latin scripts (0–1023, 7680–8703) and light/dark sprites into `app/public/basemaps-assets` (~2 MB), committed.
- **Alternatives:** All 256 glyph ranges per font (tens of MB); system fonts via `localIdeographFontFamily` only.
- **Consequences:** Labels in non-Latin scripts render without missing-glyph ranges until those ranges are added for the cities that need them (P3 coverage work).

## 2026-10-19 · A Rust protocol handler serves PMTiles

- **Context:** MapLibre reads PMTiles with HTTP byte ranges. Tauri's asset protocol could serve files, but its range behaviour isn't documented as a contract and differs by platform webview.
- **Decision:** A ~100-line `tiles://` handler (`app/src-tauri/src/tiles.rs`) that serves only `<app data>/tiles/*.pmtiles`, single ranges, CORS headers, with unit tests.
- **Alternatives:** Asset protocol (`convertFileSrc`); decoding tiles in Rust and serving `z/x/y`.
- **Consequences:** The only hand-written Rust. If the asset protocol proves reliable on Android/iOS, this can be dropped.

## 2026-10-19 · Browser harness with sql.js for UI work

- **Context:** Iterating on the UI through a native window is slow, and browser tooling (DOM inspection, console, network) is better.
- **Decision:** `npm run dev` in a normal browser runs the same UI against SQLite compiled to WebAssembly (sql.js, persisted in IndexedDB). On first load it seeds from the ingest CLI's database through a dev-only Vite middleware that also serves PMTiles with ranges.
- **Alternatives:** Tauri-only development; an in-memory mock repository.
- **Consequences:** One extra runtime dependency (sql.js), loaded only when not running in Tauri. The SQL path is identical in both hosts, so the harness exercises the real repository.

## 2026-10-19 · The core owns the schema and migrations

- **Context:** The schema must be identical on desktop, mobile and in seed bundles, and testable in plain Node.
- **Decision:** SQL and migrations live in `core/src/db`, versioned with `PRAGMA user_version`. Platforms implement a two-method `SqlExecutor` (tauri-plugin-sql, sql.js, node:sqlite). Batch writes use multi-row `INSERT`s, not transactions, because tauri-plugin-sql runs statements on a connection pool.
- **Alternatives:** tauri-plugin-sql's Rust-side migrations; an ORM.
- **Consequences:** Migrations are append-only. A multi-statement atomic write would need a Rust command later.

## 2026-10-19 · Full-text search deferred

- **Context:** The data model marks places as full-text indexed. FTS5 availability differs between sql.js and sqlx's bundled SQLite builds, and a conditional virtual table would make schemas differ across devices.
- **Decision:** P1.1 filters places by name and description with a case-insensitive match in the UI (150 places per city).
- **Alternatives:** FTS5 now; FTS4.
- **Consequences:** Revisit in P3 (search performance) after confirming FTS5 in every build.

## 2026-10-19 · Our own opening_hours subset parser

- **Context:** The checker needs "is X open on this date at this time". OSM's `opening_hours` syntax is large; the reference JS library pulls in i18n and astronomy dependencies.
- **Decision:** A ~300-line subset parser (`core/src/hours.ts`): month and month-day ranges, weekdays, times (incl. overnight and `+`), `off`/`open`/`unknown`, comments, `;` `||` `,` separators. Holiday (`PH`, `SH`) and `easter` rules are skipped on ordinary days. Anything else marks the result partial, and the checker says "unknown" rather than guessing "closed".
- **Alternatives:** The `opening_hours` npm package.
- **Consequences:** All 48 mapped strings for Lisbon parse fully (tested against the fixture). New cities may surface unsupported forms; they degrade to "unknown", never to a false warning.

## 2026-10-19 · Travel time is a deterministic estimate for now

- **Context:** OSRM/Valhalla hosting is an open question; the checker must work offline and be stable.
- **Decision:** Straight-line distance × 1.3 detour; walk at 4.5 km/h up to 1.8 km, otherwise transit at 18 km/h + 10 min. Rounded up to 5 minutes. Flagged above 40 min between consecutive items.
- **Alternatives:** OSRM public demo per pair; precomputed matrices.
- **Consequences:** Good enough to catch "too far"; not turn-by-turn. Swap in routed times behind `estimateInCityTravel` when the routing question is settled.

## 2026-10-19 · What counts as a "great place"

- **Context:** Overpass returns ~800 candidate sights for Lisbon, many minor.
- **Decision:** Rank = log₂(1 + Wikidata sitelinks) + 1.5 if Wikivoyage lists it + 0.5 with a photo + 0.25 with opening hours (−1 for uncategorised). Keep the top 150 with rank ≥ 1.5. Descriptions come from the Wikivoyage listing (CC BY-SA, attributed with a page link), else the Wikidata description (CC0).
- **Alternatives:** OpenTripMap ratings; hand-curated lists.
- **Consequences:** Ranking is explainable and source-backed. OpenTripMap stays available as an extra source later.

## 2026-10-19 · Starter city: Lisbon

- **Context:** Open question in the PRD.
- **Decision:** Lisbon: compact, well mapped, good Wikivoyage coverage, and several major sights close on Mondays, which exercises the P1.1 check.
- **Consequences:** The P1.3 starter set is still open.

## 2026-10-19 · Provisional price-band threshold: 8 observations per month

- **Context:** Open question in the PRD (to settle in P1.2).
- **Decision:** `DEFAULT_MIN_MONTH_OBSERVATIONS = 8` so p10/p90 aren't just the min and max of a handful of points; otherwise the annual band × a default seasonal multiplier.
- **Consequences:** Revisit once real logged prices exist.

## 2026-10-19 · Toolchain versions

- **Context:** TypeScript 7 (the native compiler) is current, but parts of the ecosystem still target the 5.x API.
- **Decision:** TypeScript 5.9, Vite 8, Vitest 5, React 19, Tauri 2.12, MapLibre 6, zod 4. npm workspaces; `@itinera/core` is consumed as TypeScript source (no build step).
- **Consequences:** Move to TypeScript 7 when `tsc -p` and editor tooling are confirmed on it.

## Dependencies

Every runtime dependency and why:

| Package | Where | Why |
| --- | --- | --- |
| zod | core | Validates all external data at the boundary (PRD standard). |
| react, react-dom | app | UI. |
| @dnd-kit/core, /sortable, /utilities | app | Accessible drag-and-drop with keyboard support (PRD choice). |
| maplibre-gl | app | Vector maps (PRD choice). |
| pmtiles | app | Reads local PMTiles packs with byte ranges. |
| @protomaps/basemaps | app | The style layers for Protomaps tiles. |
| @tauri-apps/api, plugin-sql, plugin-http, plugin-fs, plugin-opener | app | The official shell plugins: SQLite, HTTP without CORS limits, thumbnails on disk, opening links. |
| sql.js | app | SQLite in the browser harness only (see above). |
| tauri, tauri-plugin-* (Rust) | shell | The same plugins' native halves. |

Dev only: typescript, vite, @vitejs/plugin-react, vitest, tsx, @tauri-apps/cli, type packages.
