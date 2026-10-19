import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const INGEST_OUT = resolve(import.meta.dirname, "../ingest/out");

/**
 * Browser-harness only (`npm run dev` opened in a normal browser): serves the
 * ingest CLI's output so the UI can be developed without Tauri. Supports byte
 * ranges, which PMTiles needs. Never part of a production build.
 */
function devData(): Plugin {
  return {
    name: "itinera-dev-data",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev", (req, res) => {
        const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        if (path === "/tiles/") {
          const dir = join(INGEST_OUT, "tiles");
          const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".pmtiles")) : [];
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(names));
          return;
        }
        const file = join(INGEST_OUT, path);
        if (!file.startsWith(INGEST_OUT) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const size = statSync(file).size;
        res.setHeader("Accept-Ranges", "bytes");
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
        if (range) {
          const start = range[1] ? Number(range[1]) : size - Number(range[2]);
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          res.setHeader("Content-Length", end - start + 1);
          createReadStream(file, { start, end }).pipe(res);
        } else {
          res.setHeader("Content-Length", size);
          createReadStream(file).pipe(res);
        }
      });
    },
  };
}

// Tauri expects a fixed port and fails if it is taken.
export default defineConfig({
  plugins: [react(), devData()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
