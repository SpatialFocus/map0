import { getVersion, getWorkerUrl, setWorkerUrl } from "maplibre-gl";

/**
 * Tell MapLibre where its worker is, in a form a bundler can see.
 *
 * MapLibre builds the worker URL itself, at runtime, from a variable — no
 * bundler can follow that. Served as a folder (script tag, CDN) it works, since
 * the worker sits next to maplibre-gl.mjs. Taken in by a host's bundler (Vite,
 * Nuxt, webpack), maplibre-gl.mjs ends up in one of the host's chunks, the URL
 * points next to that chunk, and vector tiles and GeoJSON silently never draw.
 *
 * `new URL("./…", import.meta.url)` with a literal is the pattern bundlers do
 * follow: they emit the file as an asset and rewrite the URL. In our own builds
 * the worker is copied next to every chunk that imports MapLibre (scripts/
 * maplibre-dist.mjs), and this module imports MapLibre, so the relative URL is
 * right there too. `@vite-ignore` keeps our own build from rewriting it (the file
 * does not exist next to this source); copyMaplibreDist blanks the comment out
 * of the output, so the published chunk carries the plain pattern.
 *
 * Not on our dev server: there this module is served from src/, where no worker
 * sits, while maplibre-gl is served un-bundled (site/vite.config.ts,
 * optimizeDeps.exclude) and finds its worker by itself.
 * A worker URL the host set itself wins.
 *
 * The URL MapLibre builds itself carries `?v=<its version>`, so that a worker
 * left in the HTTP cache by an older release is not started against a newer
 * main thread (maplibre/maplibre-gl-js#8621) — a dist/ folder copied over the
 * previous one keeps its file names. The pin replaces that URL, so it carries
 * the same parameter; behind a host's bundler, whose asset names are hashed,
 * it is merely redundant.
 */
export function pinMaplibreWorker(): void {
  if (import.meta.env.DEV || getWorkerUrl()) return;
  const url = new URL(/* @vite-ignore */ "./maplibre-gl-worker.mjs", import.meta.url);
  url.searchParams.set("v", getVersion());
  setWorkerUrl(url.href);
}
