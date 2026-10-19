/**
 * MapLibre ships as ESM in separate files: maplibre-gl.mjs (main thread) and
 * maplibre-gl-worker.mjs (worker entry). The worker URL is built at RUNTIME,
 * relative to the importing bundle, so no bundler can see it — the files have to
 * be copied next to the chunks that import MapLibre, and MapLibre has to stay
 * external so the worker's code is not bundled into ours *and* fetched again.
 *
 * Up to 6.12 both files imported a third one, maplibre-gl-shared.mjs. Since 6.13
 * the worker is self-contained (a stale cached worker crashed the map after an
 * upgrade, maplibre/maplibre-gl-js#8621) and the shared file ships empty for
 * compatibility; it disappears in the next major, so it is copied only while
 * MapLibre still publishes it.
 *
 * Get this wrong and the failure is silent: the worker 404s (or, behind a SPA
 * fallback, receives HTML), raster layers still paint, and vector tiles and
 * GeoJSON simply never appear. Used by the library bundle and the demo site.
 */
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["maplibre-gl.mjs", "maplibre-gl-worker.mjs"];
const OPTIONAL_FILES = ["maplibre-gl-shared.mjs"];

/** copy MapLibre's dist files into `targetDir` (a URL or absolute path) */
export function copyMaplibreDist(targetDir) {
  return {
    name: "map0:copy-maplibre-dist",
    closeBundle() {
      const require = createRequire(import.meta.url);
      const from = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
      const to = typeof targetDir === "string" ? targetDir : fileURLToPath(targetDir);
      for (const file of FILES) copyFileSync(join(from, file), join(to, file));
      for (const file of OPTIONAL_FILES) {
        if (existsSync(join(from, file))) copyFileSync(join(from, file), join(to, file));
      }
    },
  };
}

/** rollup settings that keep MapLibre out of our chunks and next to them */
export const maplibreExternal = {
  /* the bare specifier only — "maplibre-gl/dist/maplibre-gl.css?inline" stays inlined */
  external: (id) => id === "maplibre-gl",
  /* written verbatim into every chunk that imports MapLibre, so those chunks
     must sit in the same directory as the copied files */
  paths: { "maplibre-gl": "./maplibre-gl.mjs" },
};
