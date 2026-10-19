/**
 * Desktop batch jobs.
 *
 *   npm run ingest -- city Lisbon            ingest a city into out/itinera.db (+ thumbnails)
 *   npm run ingest -- fixtures Lisbon        refresh core test fixtures from out/itinera.db
 *   npm run ingest -- tools                  download the pmtiles CLI into bin/
 *   npm run ingest -- tiles Lisbon --install extract a PMTiles pack and copy it to the app data dir
 *   npm run ingest -- map-assets             download fonts and sprites for offline map labels
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestCity, migrate, politeFetch, Repo, type HttpFetch } from "@itinera/core";
import { openSqlite } from "./sqlite.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const BIN = join(ROOT, "bin");
const APP_ID = "com.itinera.app";
export const USER_AGENT = "Itinera/0.1 (personal offline trip planner; https://github.com/nagaprashanth0006/code)";

const http = politeFetch(fetch as unknown as HttpFetch, { userAgent: USER_AGENT });

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

const [command, name] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  city: () => cmdCity(name ?? "Lisbon"),
  fixtures: () => cmdFixtures(name ?? "Lisbon"),
  tools: cmdTools,
  tiles: () => cmdTiles(name ?? "Lisbon"),
  "map-assets": cmdMapAssets,
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
