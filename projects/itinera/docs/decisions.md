# Decision log

One entry per significant choice: context, decision, alternatives, consequences. Newest first. Scoping decisions made before implementation are in the PRD's decision table; these were made while building P1.1 and P1.2.

## 2026-10-20 · Planner is map-first with floating panels

- **Context:** The three-pane split (catalog | plan | map) read as dated and gave the map a third of the screen.
- **Decision:** The map fills the window. The plan floats over it in a translucent side panel with Itinerary / Places tabs; the selected place opens as a card on the right. On phones the panel is a bottom sheet with three heights. The map's padding follows the panels, so fitting and centring keep content in the visible area.
- **Alternatives:** Keep three panes and restyle; tabs only.
- **Consequences:** One layout model for every width. Place details moved out of the catalog list into the floating card (or the top of the sheet on phones).

## 2026-10-20 · A curated destination index ships with the app

- **Context:** The hub could only rank cities already fetched (3 minutes each), so a new install showed nothing to recommend. The PRD asks for curated destinations before any theme, date or place is chosen.
- **Decision:** A hand-curated seed list (about 110 places, themes tagged by hand) is turned by `npm run ingest -- destinations` into `core/src/data/destinations.json` plus photos in `app/public/destinations` (about 7 MB: 640 px JPEGs, ~64 KB each), both committed. Each entry has coordinates, a Wikipedia summary (CC BY-SA), a Commons photo with attribution, whether Nominatim can find it for a full fetch, its elevation, and typical weather by month. Fetched cities merge into their destination (by distance, or by the name the seed fetches); other fetched cities are candidates on their own.
- **Alternatives:** Ingest a starter set of full cities (hundreds of MB and hours); rank only fetched cities; a remote recommendations service (not self-contained).
- **Consequences:** The hub works offline on first launch. Index weather is labelled approximate until a city is fetched; then its 20-year Open-Meteo normals take over. Theme tags are an editorial choice, visible in one file.

## 2026-10-20 · Index weather from NASA POWER, corrected for elevation

- **Context:** 20 years of daily history from Open-Meteo's archive is weighted as hundreds of calls per location; for 110 destinations that exceeds the free daily limit several times over.
- **Decision:** NASA POWER's daily point API (MERRA-2, ~50 km grid): one request per destination, same normals computation as fetched cities. Its grid averages terrain, which made hill stations far too warm (Ooty read 17–27 °C in December against roughly 6–20 °C), so temperatures are moved from the grid cell's elevation to the place's (Open-Meteo elevation API) at 6.5 °C/km.
- **Alternatives:** Open-Meteo spread over several days; the Open-Meteo climate-model API; no correction.
- **Consequences:** Good enough to rank seasons and show typical ranges; coastal cells still flatten extremes a little. The source and the correction are written into each entry and shown on the destination page.

## 2026-10-20 · Places mapped only as a point can be fetched

- **Context:** The geocoder accepted only a boundary relation with Nominatim's `city` type, so Mumbai, Mysuru, Munnar and most towns failed with "No city boundary".
- **Decision:** Try `city`, then `settlement`; take a boundary relation if either has one, else the place's point with a box around it (±0.12° for a city, ±0.05° for a town). Overpass then searches the box instead of the boundary area. Re-fetching such a place matches it by name and position.
- **Alternatives:** Require boundaries; a fixed radius query.
- **Consequences:** A box can include a neighbouring town's sights; ranking keeps the best 150 either way.

## 2026-10-20 · Network errors name the likely cause

- **Context:** In development, a shell with `https_proxy` set to an unreachable corporate proxy made every desktop fetch fail with the HTTP client's bare "error sending request for url".
- **Decision:** After retries, a network failure says the host couldn't be reached and mentions the connection or an environment proxy; README has the fix.
- **Consequences:** Installed apps don't inherit shell variables, so this is mostly a development aid.

## 2026-10-20 · Landing hub is the opening view; home city and layout are settings

- **Context:** P1.2 adds the three-door hub. The destination score needs a home city, which the PRD says is asked once, and the layout must be config, not code.
- **Decision:** The app opens on the hub; the planner is one door away and the brand button returns to the hub. Home is stored as JSON in the `homeCity` setting (name, country, lat/lon). A name that matches a fetched city or an indexed destination is used without a lookup, so it works offline; otherwise it is geocoded once with Nominatim. A catalog city within 25 km of home is treated as home and isn't ranked. The layout is read from the `landingConfig` setting and validated with `LandingConfigSchema`; a missing or invalid value falls back to `DEFAULT_LANDING_CONFIG`. There is no editor for it yet.
- **Alternatives:** Requiring home to be an ingested city (forces a 3-minute fetch of a city the user isn't visiting); hardcoding rows in the component.
- **Consequences:** Superseded in part the same day: rows now rank the bundled destination index (see above), and fetching a city runs in the background with a progress pill instead of the full-screen first-run screen; a failure shows as a toast. Routes aren't stored yet, so reachability uses the inter-city estimate. The price signal stays neutral (0.75) until price observations exist, and each card says so.

## 2026-10-20 · "Plan" on a destination prefills a long weekend

- **Context:** A ranked destination comes with a best month, not dates.
- **Decision:** `suggestTripDates` picks Friday to Monday, starting on the first Friday of that month that is at least a week away. The user can edit the dates before creating the trip.
- **Alternatives:** The whole month; asking for dates first.
- **Consequences:** A draft trip is one click from the hub. Revisit when multi-city trips set their length from the nights allocated per leg.

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
