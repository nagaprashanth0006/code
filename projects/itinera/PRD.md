# Itinera — PRD

Oct 19, 2026 · Naga Prashanth Subraveti

> Living copy: https://claude.ai/code/artifact/18c47c33-7aa5-490f-8538-5579a1133139 (has the architecture and roadmap diagrams). This file is the repo snapshot; keep the two in step or treat this one as canonical from here on.

## Overview

Itinera is a one-stop, offline-capable travel planner for a whole trip at any stage: unplanned, planning or planned. It runs as a single self-contained app on desktop first (P1), then Android and iOS (P2), with near-identical functionality on every platform.

The product rests on two separate structures: a **catalog** (Country → City → Great places) of shared reference data, and an **itinerary** (Trip → Legs → Days → Slots → Items) that belongs to the user. Both are browsed as expandable trees, and items move from the catalog into the itinerary by reference.

### Goals

- Plan single- and multi-city trips end to end: places, day plans, transfers, typical weather and budget, in one app.
- Work fully offline once a city's data and maps are cached.
- Use only free data sources, within their rate limits and terms.
- Keep the codebase engineered and explainable: a tested domain core, clear module boundaries, a written decision log.

### Non-goals (for now)

- Live flight and hotel prices, booking, or any affiliate revenue. Prices are shown as historical ranges; booking is a deep link out.
- Live weather forecasts. Only typical (climate-normal) weather for the selected dates.
- Sync between devices. A one-way seed transfer bundle covers moving data.
- A Google Maps-style "search this area" over live map data.
- A visual designer for the landing page (later, P2.3 or P3).

## Users and use cases

The primary user is a traveller planning their own trips, solo or for a small group, who wants one place for ideas, plans and the trip itself. The app opens on a three-door hub:

| Door | What the user does | Lands in |
| --- | --- | --- |
| Plan | Start a trip from source, destination(s) and dates, or continue one | Itinerary planner |
| Explore | Browse curated destinations and the catalog; save places for later | Catalog, wishlist |
| My trips | See and manage every trip at any stage | Trip list, then itinerary |

### Trip lifecycle

Every trip is one object that moves through states, so planned, planning and unplanned trips share one model:

1. **Wishlist**: saved places, no dates.
2. **Idea**: cities picked, rough dates.
3. **Planning**: days and slots filling in.
4. **Ready**: bookings noted.
5. **On trip**: in progress.
6. **Done**: a record of where the user went.

### Core use cases

- Pick a theme-ranked destination from the landing page and get a drafted itinerary with alternatives per slot.
- Browse a city's great places on a live map and add them to a trip.
- Reorder a day's items and see conflicts immediately (closed that day, too far, day overfull).
- Plan a multi-city trip: order the cities, allocate nights, account for transfers.
- Check typical weather and a price range before committing to dates.
- Save places while browsing, then turn the wishlist into a trip later.
- Move a trip and its cached city data to another device with a seed bundle.

## Functional requirements

Each area below lists what the app must do; the phase that delivers it is in the Phases section.

### Landing hub

- Shows dynamically curated destinations before any theme, date or place is chosen.
- Window: the current month plus the next three months.
- One row per theme (Romantic, Solo, Adventure, Nature/Scenic, Historical, Culture), each ranked by the destination score.
- Score = theme fit × season fit for the month × reachability from the home city × price signal. Theme tags live at city level.
- Home city is asked once and stored as a setting.
- Layout (rows, filters, ordering) is defined as config, not hardcoded, so a designer can be added later.

### Catalog

- Expandable tree: Country → City → Great places.
- Each place: name, category, theme tags, coordinates, opening hours, short description, photo with attribution, source links.
- Places show on the map and in the tree; selecting either highlights the other.
- Save a place to the wishlist, or add it to a trip leg.

### Itinerary planner

- Expandable tree: Trip → Legs → Days → Slots (morning, afternoon, evening) → Items.
- Items reference catalog places; edits to place data flow through.
- Drag to reorder within and across days.
- Each slot can hold a primary pick plus alternates that swap in with one action.
- A deterministic constraint checker runs on every change and flags: closed on that day or time, travel time between items, day length exceeded, transfer days overfull.

### Multi-city

- A trip has one or more legs; a single-city trip is a trip with one leg.
- Suggest a city order that avoids zig-zagging.
- Allocate nights per leg from saved places and a minimum stay (two nights unless marked a stopover).
- Transfers between legs are first-class items with mode and estimated duration, and consume time on their day.

### Weather

- Typical weather only, no forecast.
- For each leg's dates: typical low and high temperature, rain days and precipitation, computed from roughly 20 years of daily history.
- Feeds season fit in the landing score.

### Prices and budget

- Flights and hotels shown as a price range, never as a single live price.
- Range = month-specific p10–p90 where enough observations exist; otherwise the annual band adjusted by a seasonal multiplier.
- Every range shows provenance: observation count, date span, source.
- "Check prices" deep-links to an external site prefilled with route or city and dates.
- "Log this price" records an observed fare or rate as a new observation.
- Budget is a rollup of item costs, transfers, nights and logged prices.

### Maps

- Live, interactive vector maps: smooth pan, zoom, rotate and tilt.
- Offline: a local tile extract per city or region.
- Online, outside cached areas: a free hosted vector tile source as fallback.
- Show catalog places, itinerary items per day and the route between them.
- Flights and weather are not shown on the map.

### LLM assistance

- Drafts an itinerary from source, destinations, dates and theme, with alternates per slot.
- Every draft passes through the deterministic constraint checker before it is shown.
- The planner works fully without the LLM; it is an enhancement, not a dependency.
- Desktop: a local model server bundled with the app. Mobile (P2): an on-device model.

### Data portability

- Export a seed bundle: database slice, map tiles, thumbnails and metadata for selected trips and cities.
- Import a bundle on another device; an existing trip is merged or replaced by ID.

## Architecture

One React UI and one TypeScript core run unchanged on desktop and mobile; Rust is limited to a thin native shell built on Tauri 2.

```
┌─ React UI · responsive, three panes to one ────────────────────┐
│  Landing hub │ Catalog tree │ Itinerary tree │ Map (MapLibre)  │
└───────────────────────────────┬────────────────────────────────┘
┌─ TypeScript core · pure package, tested ───────────────────────┐
│  Constraints │ Scoring │ Price bands │ Cache policy            │
└───────────────────────────────┬────────────────────────────────┘
┌─ Tauri shell · Rust only where required ───────────────────────┐   ┌─ Free sources ──────┐
│  SQL plugin │ FS + HTTP │ PMTiles handler │ LLM sidecar        │ ◄─│ OSM / Overpass      │
└──────┬────────────┬─────────────┬────────────────┬─────────────┘   │ Wikidata, Wikivoyage│
   SQLite DB    Thumbnails     Tile packs      Local model           │ Open-Meteo          │
                                                                     │ OpenFreeMap         │
                                                                     └─────────────────────┘
```

The UI calls the core; the core reaches storage and the network only through the shell's plugins, so it stays testable in plain Node.

- **UI:** React, dnd-kit for drag-and-drop, MapLibre GL JS for vector maps. One codebase, three layouts: desktop, tablet, phone.
- **Core:** a pure TypeScript package holding domain types, constraint checker, destination scoring, price bands, cache/TTL policy, trip lifecycle and ingestion logic.
- **Shell:** Tauri 2 with official plugins for SQL (SQLite), file system and HTTP; a small Rust protocol handler serves local PMTiles to MapLibre with byte-range reads.
- **LLM (desktop):** a llama.cpp server bundled as a Tauri sidecar, started on demand.
- **Storage:** one SQLite file plus PMTiles packs, thumbnails and model weights as files in the app data directory.
- **Ingestion:** runs in-app per city on demand and as a background refresher; heavy batch jobs (climate precompute, tile extraction) can also run from `ingest/` scripts on a desktop machine.
- **Mobile (P2):** same UI and core; an on-device model via a native plugin (llama.cpp or MediaPipe/LiteRT) replaces the sidecar.

## Data model

One SQLite schema serves every platform and is the contract for seed bundles. All primary keys are ULIDs, so imported rows never collide with local ones; every row from an external source records its source and fetch time.

### Catalog (shared reference data)

| Entity | Key fields | Notes |
| --- | --- | --- |
| Country | id, name, ISO code, currency | Root of the catalog tree |
| City | id, country_id, name, lat/lon, bbox, theme tags | Theme tags drive landing rows |
| Place | id, city_id, name, category, lat/lon, hours, description, theme tags, photo path, source, fetched_at | The "great places"; full-text indexed |
| ClimateNormal | city_id, day_of_year, temp p10/p50/p90 low and high, rain probability, precipitation | Precomputed from daily history |
| RouteEdge | from_city, to_city, mode, typical duration, direct or connecting | Reachability and transfer estimates |
| PriceObservation | id, kind (flight/stay), route or city, travel date, price, currency, source, observed_at | From datasets or "log this price" |
| PriceBand | kind, route or city, month, p10, p50, p90, n, span | Derived from observations |

### Itinerary (user data)

| Entity | Key fields | Notes |
| --- | --- | --- |
| Trip | id, name, origin city, state, start/end dates | State = wishlist, idea, planning, ready, on trip, done |
| Leg | id, trip_id, city_id, order, nights, is_stopover | One per city stay |
| Transfer | id, trip_id, from_leg, to_leg, mode, est. duration, depart day | First-class item that consumes day time |
| Day | id, leg_id, date, index | |
| Slot | id, day_id, part (morning/afternoon/evening), order | |
| Item | id, slot_id, place_id or custom, order, is_primary, est. cost, notes | Alternates share a slot with is_primary = false |
| WishlistEntry | id, place_id, saved_at, note | Seeds trips later |

### System

| Entity | Key fields | Notes |
| --- | --- | --- |
| CacheEntry | key, category, fetched_at, ttl, status | Drives background refresh |
| Setting | key, value | Home city, units, currency |
| TilePack | id, city or region, bbox, path, size, built_at | PMTiles files live on disk, not in the DB |

Images and map tiles are stored as files; the database holds only paths and attribution. Expected size: tens of MB for a few cities, roughly 0.5–1.5 GB for broad coverage of around 500 cities.

## Data sources and caching

All data comes from free sources, cached locally with a refresh interval set per category. Rate limits and attribution terms are respected; nothing is scraped.

| Category | Source (free) | Refresh |
| --- | --- | --- |
| Places, categories, hours | OSM via Overpass | 1–2 weeks for hours; 4–8 weeks otherwise |
| Descriptions | Wikidata, Wikivoyage | 4–8 weeks |
| Photos | Wikimedia Commons (thumbnails cached as files) | 4–8 weeks |
| Extra POIs | OpenTripMap | 4–8 weeks |
| Geocoding | Nominatim (max 1 request/second) | Permanent |
| Climate normals | Open-Meteo historical archive | Yearly |
| Travel times | OSRM or Valhalla (public demo, or self-hosted) | Permanent per pair |
| Inter-city routes | Static open routes dataset + road/rail estimates | Yearly |
| Accommodation prices | Inside Airbnb snapshots + logged observations | On each new snapshot |
| Flight prices | Calibrated distance-and-season estimate + logged observations | On each new observation |
| Map tiles (offline) | Protomaps build, extracted per city as PMTiles | On demand |
| Map tiles (online fallback) | OpenFreeMap | Live |

### Cache rules

- Store normalized rows, never raw API responses.
- Each cached row carries category, fetched_at and TTL; a background refresher re-fetches stale rows within each source's rate limit.
- Popular cities are pre-warmed so the user rarely waits on a cold fetch.
- Stale data stays usable and is labelled with its fetch date until it refreshes.

### Price bands

- Compute month-specific p10, p50 and p90 when a month has enough observations (threshold to be set in P1.2).
- Otherwise use the annual band × a seasonal multiplier for that month.
- Always display provenance, e.g. "₹4,200–7,800 · 14 observations · Jan 2025–Sep 2026".
- Estimates from the fare model are labelled as estimates, never as observed prices.

Verify each source's current terms and limits before ingestion is built; free API access changes over time.

## Phases

P1 delivers a complete desktop product before any app work starts; each sub-phase ends on a concrete "done when" test. Tick items off here as they land.

```
P1 Desktop (macOS, Windows):  P1.1 Core PoC/MVP ─► P1.2 Usable, demoable ─► P1.3 Complete on PC
        ◆ Gate: a real trip planned and taken with only the app
P2 Apps:                      P2.1 Android ─► P2.2 iOS ─► P2.3 UI refinements
        ◆ Gate: near-identical features on Android and iOS
P3 Global optimization:       coverage, performance, UX
```

P1.1 is the current phase; the riskiest unknowns (stack, maps, data pipeline) are deliberately front-loaded there.

### P1.1 — Core PoC / MVP

- [ ] Tauri 2 shell + React + SQLite via the SQL plugin; schema with ULIDs
- [ ] Pure TS core package with domain types and the constraint checker (hours, travel time, day length), unit-tested
- [ ] Ingestion for one city: OSM/Overpass places, Wikidata/Wikivoyage descriptions, Open-Meteo climate normals
- [ ] MapLibre with a local PMTiles extract for that city, served by the Rust protocol handler
- [ ] Single-leg itinerary: add from catalog, drag to reorder, conflicts flagged
- [ ] Responsive layout skeleton (panes collapse)

**Done when:** you can browse one city's places on a live map, build a 3-day plan, reorder it and see a closed-on-Monday warning, all offline after the first fetch. No LLM.

### P1.2 — Usable, near-demoable

- [ ] Catalog tree and itinerary tree, both expandable
- [ ] Multi-city: leg ordering, nights allocation, transfers as time-consuming items
- [ ] Landing hub (Plan / Explore / My trips) with the score over current month + 3, config-driven layout
- [ ] Typical-weather bands per leg
- [ ] Price bands with provenance; deep links for flights and hotels
- [ ] TTL cache per category with a background refresher
- [ ] LLM drafting via the llama.cpp sidecar, validated by the checker, with a non-LLM fallback

**Done when:** someone else can plan a 3-city trip without help, even if it looks plain.

### P1.3 — Fully working on PC

- [ ] Full trip lifecycle: wishlist → idea → planning → ready → on trip → done
- [ ] "Log this price"; budget rollups
- [ ] Seed bundle export and import
- [ ] Starter city set ingested in batch
- [ ] macOS and Windows installers; error handling, empty states, logging
- [ ] Core test coverage and decision log up to date

**Done when:** a real trip is planned and taken using only this app.

### P2.1 — Android

- [ ] Phone layout (tabs or bottom sheet over the map) and tablet layout (three panes, S Pen drag)
- [ ] On-device LLM plugin (llama.cpp or MediaPipe/LiteRT)
- [ ] Storage, permissions, background refresh and battery policy (designed before this phase starts)
- [ ] Seed import from desktop

**Done when:** P1.3's functionality works on the S23 Ultra and Tab S11 Ultra, offline, from a seed bundle.

### P2.2 — iOS

- [ ] Build, sign and run via Xcode on a Mac; platform quirks resolved

**Done when:** iOS matches Android functionality.

### P2.3 — UI refinements

- [ ] Polish across desktop, tablet and phone
- [ ] Landing designer (here or in P3)

**Done when:** no layout reads as a port of another platform.

### P3 — Global optimization

- [ ] Wider city coverage and ingestion at scale
- [ ] Search, query and tile-size performance
- [ ] UX passes from real use; backend tuning

## Non-functional requirements and engineering standards

The codebase should read as engineered: every layer explainable, the core tested, every significant choice written down.

### Non-functional requirements

- **Self-contained:** one installable app per platform, no external services to run (no database server, no separate backend).
- **Offline-first:** a city with cached data and tiles works with no network.
- **Parity:** desktop, Android and iOS offer near-identical functionality from one codebase.
- **Responsive UI:** layouts collapse from three panes (desktop, tablet) to one (phone); built responsive from P1.1.
- **Map feel:** smooth pan and zoom on target hardware, with no visible tile blur during zoom.
- **Targets:** macOS (M-series) and Windows 11 in P1; Samsung S23 Ultra and Tab S11 Ultra in P2.1; iOS in P2.2.
- **Licensing:** every displayed place, photo and map carries the attribution its source requires.

### Engineering standards

- **Pure core package:** domain types, constraint checker, scoring, price bands, cache policy and lifecycle live in a TypeScript package with no UI or Tauri imports, runnable and debuggable in Node.
- **Strict typing:** TypeScript strict mode; all external data validated at the boundary with Zod schemas.
- **Tests:** unit tests for the core package (Vitest), written alongside or before the logic; fixtures from real city data.
- **Rust only where required:** native plugins and protocol handlers, kept small and documented.
- **Short, intentional dependency list:** every dependency justified in the decision log.
- **Repo layout:** `core/` (domain package), `app/` (React UI + Tauri shell), `ingest/` (data ingestion and tile extraction), `docs/` (PRD, decision log).
- **Decision log:** one short entry per significant choice: context, decision, alternatives, consequences.

## Decision log and open questions

Decisions made while scoping, newest first. Add new entries at the top.

| Date | Decision | Why | Alternatives considered |
| --- | --- | --- | --- |
| 2026-10-19 | Project name: Itinera | Latin for "journeys"; reads as "itinerary" in any market | Pathik; Legwork; Waypoint; Fieldbook |
| 2026-10-19 | Keep the LLM out of P1.1; planner must work without it | Prove the deterministic core first; LLM stays an enhancement | LLM-first drafting |
| 2026-10-19 | Build layouts responsive from P1.1 | Shortens P2.1 to native work and refinement | Desktop-only layout, rework later |
| 2026-10-19 | Tauri 2 shell, TypeScript core, Rust only where required | Parity across desktop and mobile from one codebase; small binaries | Python/FastAPI + separate mobile app; Flet; Chaquopy; Expo + separate desktop |
| 2026-10-19 | Vector maps: MapLibre + PMTiles offline, OpenFreeMap online | Live, smooth interaction with offline support | Raster tiles; Google Maps |
| 2026-10-19 | No sync; one-way seed bundles | Devices work standalone; avoids sync complexity | Bidirectional sync |
| 2026-10-19 | Prices as historical ranges with provenance; booking via deep links | No dependable free live price API | Scraping; paid APIs |
| 2026-10-19 | Typical weather only, no forecast | Planning happens weeks or months ahead | Forecast API |
| 2026-10-19 | Free data sources only, cached per category | No revenue planned; offline-first | Paid APIs |
| 2026-10-19 | SQLite as the single store; ULID keys | Self-contained app; clean imports across devices | Postgres; auto-increment IDs |
| 2026-10-19 | Separate catalog and itinerary structures | Shared reference data vs user-owned plans | One combined tree |

### Open questions

- [ ] Starter city set for P1.1 and P1.3.
- [ ] Minimum observations per month before a month-specific price band is shown.
- [ ] Which local model and size for desktop drafting in P1.2.
- [ ] Self-host OSRM/Valhalla on the Mac Mini, or rely on the public demo plus estimates.
- [ ] Visa and entry-rule information: in scope, and from which free source.
- [ ] Seed bundle transport between devices (file share, LAN, QR link).
- [ ] Android battery and background refresh policy (to be designed before P2.1).
- [ ] Check "Itinera" availability on the Play Store, App Store and domains.
