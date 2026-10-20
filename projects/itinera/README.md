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

The app opens on the hub, which recommends destinations from a curated index bundled with the app (photos, summaries and typical weather by month for about 110 places), so nothing has to be fetched first. Planning a destination fetches that city's places, opening hours, photos and 20-year daily weather once (about 3 minutes); after that it works offline once the city's tile pack is installed:

```bash
npm run ingest -- tools               # downloads the pmtiles CLI into ingest/bin
npm run ingest -- city Lisbon         # needed once: the tile job uses the city's bounding box
npm run ingest -- tiles Lisbon --install
```

`--install` copies the pack into the app data directory (`%APPDATA%\com.itinera.app\tiles` on Windows, `~/Library/Application Support/com.itinera.app/tiles` on macOS). Without a pack the map uses OpenFreeMap online.

### Destination index

The hub's destinations come from `ingest/src/destination-seeds.ts` (names, countries, hand-picked themes). To add or change one, edit the seeds and run:

```bash
npm run ingest -- destinations                 # adds new seeds; keeps existing entries
npm run ingest -- destinations --only goa,ooty # refreshes some
npm run ingest -- destinations --refresh       # refreshes all (about 12 minutes)
```

It writes `core/src/data/destinations.json` and `app/public/destinations/*.jpg`, both committed. The run is resumable: the file is saved after each destination.

### Troubleshooting: a proxy in your shell

If fetching fails with "Couldn't reach … proxy" (or "error sending request for url"), the shell that started the app has `http_proxy`/`https_proxy` set to a proxy that isn't reachable on this network, and the desktop app's HTTP client honours them. Start it without them:

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY npm run tauri dev
```

npm has the same issue if its config points at a proxy or private registry: add `--registry https://registry.npmjs.org/ --proxy=null --https-proxy=null` to `npm install`.

### Browser harness

`npm run dev`, then open http://localhost:1420 in a browser. The same UI runs against SQLite in WebAssembly, seeded from `ingest/out/itinera.db` and served tiles from `ingest/out/tiles/`. Add `?reset-db` to the URL to re-seed after re-running the ingest job.

## Data sources

OpenStreetMap via Overpass (places, hours), Nominatim (geocoding), Wikidata, Wikivoyage and Wikipedia (descriptions), Wikimedia Commons (photos), Open-Meteo historical archive (typical weather for fetched cities) and elevation API, NASA POWER (approximate typical weather for the destination index), Protomaps builds (offline tiles), OpenFreeMap (online tiles). All free; requests are paced per host and identify the app. Every place, photo and map shows the attribution its source requires.
