# Itinera

An offline-capable travel planner. Desktop first (Tauri 2), one React UI and one TypeScript core. See [docs/PRD.md](docs/PRD.md) for the product and [docs/decisions.md](docs/decisions.md) for the decision log.

## Layout

| Folder | What |
| --- | --- |
| `core/` | Pure TypeScript domain package: types and Zod schemas, opening-hours parser, constraint checker, itinerary tree operations, SQLite schema and repository, ingestion pipeline, climate normals, scoring, price bands, cache policy, multi-city planning, trip lifecycle. No UI or Tauri imports; tested with Vitest. |
| `app/` | React UI (`src/`) and the Tauri shell (`src-tauri/`). |
| `ingest/` | Desktop batch jobs: city ingestion into a SQLite file, test fixtures, PMTiles extraction, map assets. |
| `docs/` | PRD and decision log. |

## Prerequisites

- Node 22+ (the ingest scripts use the built-in `node:sqlite`).
- Rust stable and the platform's Tauri prerequisites (on Windows: MSVC Build Tools and WebView2).

## Run

```bash
npm install
npm test                      # core unit tests
npm run tauri dev             # the desktop app
```

On first launch the app fetches Lisbon's places, descriptions, photos and typical weather (about 3 minutes). Everything after that works offline once the city's tile pack is installed:

```bash
npm run ingest -- tools               # downloads the pmtiles CLI into ingest/bin
npm run ingest -- city Lisbon         # needed once: the tile job uses the city's bounding box
npm run ingest -- tiles Lisbon --install
```

`--install` copies the pack into the app data directory (`%APPDATA%\com.itinera.app\tiles` on Windows, `~/Library/Application Support/com.itinera.app/tiles` on macOS). Without a pack the map uses OpenFreeMap online.

### Browser harness

`npm run dev`, then open http://localhost:1420 in a browser. The same UI runs against SQLite in WebAssembly, seeded from `ingest/out/itinera.db` and served tiles from `ingest/out/tiles/`. Add `?reset-db` to the URL to re-seed after re-running the ingest job.

## Data sources

OpenStreetMap via Overpass (places, hours), Nominatim (geocoding), Wikidata and Wikivoyage (descriptions), Wikimedia Commons (photos), Open-Meteo historical archive (typical weather), Protomaps builds (offline tiles), OpenFreeMap (online tiles). All free; requests are paced per host and identify the app. Every place, photo and map shows the attribution its source requires.
