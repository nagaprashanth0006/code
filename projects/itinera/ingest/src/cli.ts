/**
 * Desktop batch jobs.
 *
 *   npm run ingest -- city Lisbon            ingest a city into out/itinera.db (+ thumbnails)
 *   npm run ingest -- fixtures Lisbon        refresh core test fixtures from out/itinera.db
 *   npm run ingest -- tools                  download the pmtiles CLI into bin/
 *   npm run ingest -- tiles Lisbon --install extract a PMTiles pack and copy it to the app data dir
 *   npm run ingest -- map-assets             download fonts and sprites for offline map labels
 *   npm run ingest -- destinations           refresh the curated destination index and its photos
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeClimateNormals,
  DestinationIndexSchema,
  fetchEntities,
  fetchImageInfo,
  fetchElevation,
  fetchPowerDailyHistory,
  fetchWikipediaSummary,
  geocodeCity,
  historyWindow,
  ingestCity,
  lapseCorrect,
  migrate,
  monthClimate,
  politeFetch,
  POWER_ATTRIBUTION,
  Repo,
  shortSummary,
  type Destination,
  type HttpFetch,
} from "@itinera/core";
import { DESTINATION_SEEDS } from "./destination-seeds.js";
import { openSqlite } from "./sqlite.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const BIN = join(ROOT, "bin");
const APP_ID = "com.itinera.app";
export const USER_AGENT = "Itinera/0.1 (personal offline trip planner; https://github.com/nagaprashanth0006/code)";

const http = politeFetch(fetch as unknown as HttpFetch, {
  userAgent: USER_AGENT,
  minIntervalMs: { "en.wikipedia.org": 200, "power.larc.nasa.gov": 1000, "api.open-meteo.com": 300 },
  timeoutMs: 120_000,
});

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function appDataDir(): string {
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_ID);
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", APP_ID);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_ID);
}

const slug = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function openRepo(): Promise<{ repo: Repo; close: () => void }> {
  mkdirSync(OUT, { recursive: true });
  const db = openSqlite(arg("db", join(OUT, "itinera.db"))!);
  await migrate(db);
  return { repo: new Repo(db), close: db.close };
}

async function cmdCity(name: string) {
  const { repo, close } = await openRepo();
  const thumbs = join(OUT, "thumbs");
  mkdirSync(thumbs, { recursive: true });
  const t0 = Date.now();
  const result = await ingestCity(
    {
      fetch: http,
      repo,
      files: {
        async saveThumbnail(file, bytes) {
          writeFileSync(join(thumbs, file), bytes);
          return `thumbs/${file}`;
        },
      },
      onProgress: (p) => {
        // One line per step, plus every 25 items within a step.
        if (p.done && p.done !== p.total && p.done % 25 !== 0) return;
        console.log(`  ${p.step}${p.total ? ` (${p.done ?? 0}/${p.total})` : ""}`);
      },
    },
    name,
    { maxPlaces: Number(arg("max", "150")) },
  );
  close();
  console.log(
    `${result.city.name}: ${result.places} places (${result.withHours} with hours, ${result.withDescription} described, ${result.withPhoto} with photos), ${result.climateDays} climate days, themes ${result.city.themeTags.join(", ")} in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
}

/** Writes a small real-data fixture for core tests. */
async function cmdFixtures(name: string) {
  const { repo, close } = await openRepo();
  const city = (await repo.listCities()).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!city) throw new Error(`Ingest ${name} first`);
  const places = (await repo.placesByCity(city.id)).filter((p) => p.hoursRaw).slice(0, 40);
  const normals = await repo.climateNormals(city.id);
  close();
  const dir = resolve(ROOT, "..", "core", "test", "fixtures");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug(name)}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        note: "Real data from OSM, Wikidata, Wikivoyage and Open-Meteo, written by `npm run ingest -- fixtures`.",
        city: { ...city, fetchedAt: city.fetchedAt },
        places: places.map((p) => ({ ...p, photoPath: null })),
        normals,
      },
      null,
      1,
    ),
  );
  console.log(`Wrote ${places.length} places and ${normals.length} climate days to ${file}`);
}

async function cmdTools() {
  const exe = join(BIN, platform() === "win32" ? "pmtiles.exe" : "pmtiles");
  if (existsSync(exe)) return console.log(`pmtiles already at ${exe}`);
  const release = (await (await fetch("https://api.github.com/repos/protomaps/go-pmtiles/releases/latest")).json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };
  const want = platform() === "win32" ? "Windows_x86_64.zip" : platform() === "darwin" ? "Darwin_arm64.zip" : "Linux_x86_64.tar.gz";
  const asset = release.assets.find((a) => a.name.endsWith(want));
  if (!asset) throw new Error(`No pmtiles build for ${want}`);
  mkdirSync(BIN, { recursive: true });
  const archive = join(BIN, asset.name);
  writeFileSync(archive, new Uint8Array(await (await fetch(asset.browser_download_url)).arrayBuffer()));
  // Windows ships bsdtar, which reads zips; a GNU tar earlier on PATH would misread "M:" as a host.
  const tar = platform() === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xf", asset.name], { cwd: BIN });
  console.log(`pmtiles ${release.tag_name} → ${exe}`);
}

async function cmdTiles(name: string) {
  const exe = join(BIN, platform() === "win32" ? "pmtiles.exe" : "pmtiles");
  if (!existsSync(exe)) throw new Error("Run `npm run ingest -- tools` first");
  const { repo, close } = await openRepo();
  const city = (await repo.listCities()).find((c) => c.name.toLowerCase() === name.toLowerCase());
  close();
  if (!city) throw new Error(`Ingest ${name} first (the tile pack uses its bounding box)`);
  const builds = (await (await fetch("https://build-metadata.protomaps.dev/builds.json")).json()) as Array<{ key: string }>;
  const latest = builds[builds.length - 1]?.key;
  if (!latest) throw new Error("No Protomaps builds listed");
  // Pad the city box a little so the edges aren't blank.
  const [w, s, e, n] = city.bbox;
  const pad = 0.02;
  const bbox = [w - pad, s - pad, e + pad, n + pad].map((v) => v.toFixed(4)).join(",");
  mkdirSync(join(OUT, "tiles"), { recursive: true });
  const file = join(OUT, "tiles", `${slug(name)}.pmtiles`);
  const maxzoom = arg("maxzoom", "15")!;
  console.log(`Extracting ${bbox} z0–${maxzoom} from build ${latest}…`);
  execFileSync(exe, ["extract", `https://build.protomaps.com/${latest}`, file, `--bbox=${bbox}`, `--maxzoom=${maxzoom}`], {
    stdio: "inherit",
  });
  console.log(`${file}: ${(statSync(file).size / 1e6).toFixed(1)} MB`);
  if (process.argv.includes("--install")) {
    const dest = join(appDataDir(), "tiles");
    mkdirSync(dest, { recursive: true });
    copyFileSync(file, join(dest, `${slug(name)}.pmtiles`));
    console.log(`Installed to ${dest}`);
  }
}

/**
 * Fonts (glyph ranges for Latin scripts) and sprites the Protomaps style uses,
 * so map labels and icons render offline.
 */
async function cmdMapAssets() {
  const base = "https://raw.githubusercontent.com/protomaps/basemaps-assets/main";
  const dest = resolve(ROOT, "..", "app", "public", "basemaps-assets");
  const fonts = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
  const ranges = ["0-255", "256-511", "512-767", "768-1023", "7680-7935", "8192-8447", "8448-8703"];
  for (const font of fonts) {
    mkdirSync(join(dest, "fonts", font), { recursive: true });
    for (const r of ranges) {
      const res = await fetch(`${base}/fonts/${encodeURIComponent(font)}/${r}.pbf`);
      if (!res.ok) throw new Error(`${font} ${r}: HTTP ${res.status}`);
      writeFileSync(join(dest, "fonts", font, `${r}.pbf`), new Uint8Array(await res.arrayBuffer()));
    }
  }
  mkdirSync(join(dest, "sprites", "v4"), { recursive: true });
  for (const f of ["light", "dark"].flatMap((v) => [`${v}.json`, `${v}.png`, `${v}@2x.json`, `${v}@2x.png`])) {
    const res = await fetch(`${base}/sprites/v4/${f}`);
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    writeFileSync(join(dest, "sprites", "v4", f), new Uint8Array(await res.arrayBuffer()));
  }
  console.log(`Map assets in ${dest}`);
}

/**
 * The curated destination index: Nominatim (coordinates; whether the city can
 * be fetched), Wikipedia (summary), Wikidata + Commons (photo, attribution),
 * NASA POWER (20 years of daily weather → typical weather per month).
 * Writes core/src/data/destinations.json and app/public/destinations/*.
 * Resumable: entries already in the file are kept and the file is saved after
 * each destination, so a failed run continues where it stopped. `--refresh`
 * redoes every entry; `--only goa,jaipur` redoes just those.
 */
async function cmdDestinations() {
  const dataFile = resolve(ROOT, "..", "core", "src", "data", "destinations.json");
  const photoDir = resolve(ROOT, "..", "app", "public", "destinations");
  mkdirSync(dirname(dataFile), { recursive: true });
  mkdirSync(photoDir, { recursive: true });
  const previous = existsSync(dataFile)
    ? DestinationIndexSchema.parse(JSON.parse(readFileSync(dataFile, "utf8"))).destinations
    : [];
  const only = arg("only")?.split(",");
  const refresh = process.argv.includes("--refresh");
  const window = historyWindow(new Date());
  // Entries by id in seed order; not-yet-refreshed ones keep their previous data, so an interrupted run leaves a whole index.
  const ids = DESTINATION_SEEDS.map((seed) => slug(seed.name).replace(/^-|-$/g, ""));
  const byId = new Map(previous.filter((d) => ids.includes(d.id)).map((d) => [d.id, d]));
  const failed: string[] = [];
  const save = () =>
    writeFileSync(
      dataFile,
      JSON.stringify(
        DestinationIndexSchema.parse({
          generatedAt: new Date().toISOString(),
          note: "Written by `npm run ingest -- destinations` from ingest/src/destination-seeds.ts. Do not edit by hand.",
          destinations: ids.flatMap((id) => byId.get(id) ?? []),
        }),
        null,
        1,
      ) + "\n",
    );

  for (const [i, seed] of DESTINATION_SEEDS.entries()) {
    const id = ids[i]!;
    const redo = only ? only.includes(id) : refresh || !byId.has(id);
    if (!redo) continue;
    process.stdout.write(`[${i + 1}/${DESTINATION_SEEDS.length}] ${seed.name}… `);
    try {
      byId.set(id, await buildDestination(id, seed));
      save();
    } catch (e) {
      console.log(`failed: ${e instanceof Error ? e.message : String(e)}`);
      failed.push(seed.name);
    }
  }
  save();
  optimizePhotos(photoDir);
  console.log(`${byId.size} destinations → ${dataFile}`);
  if (failed.length) console.log(`Failed (run again to retry): ${failed.join(", ")}`);

  async function buildDestination(id: string, seed: (typeof DESTINATION_SEEDS)[number]): Promise<Destination> {
    const query = seed.query ?? seed.name;
    const geo = await geocodeCity(http, query).catch(() => null);

    const summary = await fetchWikipediaSummary(http, seed.wiki ?? seed.name);
    const lat = summary.lat ?? geo?.lat;
    const lon = summary.lon ?? geo?.lon;
    if (lat === undefined || lon === undefined) throw new Error("no coordinates");

    let photo: Destination["photo"] = null;
    const entity = summary.wikidata ? (await fetchEntities(http, [summary.wikidata])).get(summary.wikidata) : undefined;
    // A pinned photo, else Wikidata's image, else the article's lead image (skipping maps and flags).
    const isPhoto = (f: string | null | undefined): f is string => !!f && !/\.(svg|gif|tiff?)$/i.test(f);
    const image =
      seed.photo ?? (isPhoto(entity?.image) ? entity.image : isPhoto(summary.image) ? summary.image : null);
    if (image) {
      const info = (await fetchImageInfo(http, [image])).get(image);
      if (info) {
        // Saved as .jpg; optimizePhotos converts whatever Commons sent (sometimes PNG) to JPEG.
        const file = `${id}.jpg`;
        const res = await http(info.thumbUrl);
        writeFileSync(join(photoDir, file), new Uint8Array(await res.arrayBuffer()));
        photo = { path: `destinations/${file}`, attribution: info.attribution };
      }
    }

    const elevationM = await fetchElevation(http, lat, lon);
    const power = await fetchPowerDailyHistory(http, lat, lon, window);
    const history =
      elevationM !== null && power.gridElevationM !== null ? lapseCorrect(power, power.gridElevationM, elevationM) : power;
    const normals = computeClimateNormals(id, history);
    const months = Array.from({ length: 12 }, (_, m) => monthClimate(normals, m + 1));

    const d: Destination = {
      id,
      name: seed.name,
      countryCode: seed.cc,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      elevationM: elevationM === null ? null : Math.round(elevationM),
      themeTags: seed.themes,
      ingestQuery: geo ? query : null,
      summary: summary.extract ? shortSummary(summary.extract) : null,
      wikipediaUrl: summary.url,
      photo,
      months,
      climateSource: `${POWER_ATTRIBUTION}, daily ${window.start.slice(0, 4)}–${window.end.slice(0, 4)}${
        history !== power ? `, corrected from the ${Math.round(power.gridElevationM!)} m grid cell to ${Math.round(elevationM!)} m` : ""
      }`,
    };
    console.log(`${geo ? "fetchable" : "no city found"}, ${photo ? "photo" : "no photo"}`);
    return d;
  }
}

/**
 * Converts photos to JPEG at most 640 px on the long side, quality 70, with
 * macOS `sips` (about 60 KB each). Skipped on other platforms.
 */
function optimizePhotos(dir: string) {
  if (platform() !== "darwin") return;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jpg")) continue;
    const file = join(dir, f);
    if (statSync(file).size < 90_000) continue;
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "640", file, "--out", file], { stdio: "ignore" });
  }
}

const [command, name] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  city: () => cmdCity(name ?? "Lisbon"),
  fixtures: () => cmdFixtures(name ?? "Lisbon"),
  tools: cmdTools,
  tiles: () => cmdTiles(name ?? "Lisbon"),
  "map-assets": cmdMapAssets,
  destinations: cmdDestinations,
};
const run = command ? commands[command] : undefined;
if (!run) {
  console.error(`Usage: ingest <${Object.keys(commands).join("|")}> [city] [--db path] [--max n] [--maxzoom z] [--install]`);
  process.exit(1);
}
run().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
