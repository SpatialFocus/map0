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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["maplibre-gl.mjs", "maplibre-gl-worker.mjs"];
const OPTIONAL_FILES = ["maplibre-gl-shared.mjs"];

/** the import path written into the chunks — relative, so it is only right from `targetDir` itself */
const IMPORT_PATH = "./maplibre-gl.mjs";

const posix = (p) => p.replace(/\\/g, "/");

/** does this output chunk import MapLibre, statically or lazily? */
const importsMaplibre = (chunk) =>
  [...chunk.imports, ...chunk.dynamicImports].some((id) => id === "maplibre-gl" || id === IMPORT_PATH);

/**
 * The worker pin (packages/core/src/maplibre-worker.ts) as a host's bundler has
 * to find it: `new URL("./maplibre-gl-worker.mjs", import.meta.url)` with a
 * literal, nothing in between — Vite and webpack match exactly that shape.
 */
const WORKER_PIN = /new\s+URL\s*\(\s*(["'`])\.\/maplibre-gl-worker\.mjs\1\s*,\s*import\.meta\.url\s*\)/;
/** the comment that kept our own build from rewriting the pin */
const PIN_IGNORE = /\/\*\s*@vite-ignore\s*\*\/(?=\s*["'`]\.\/maplibre-gl-worker\.mjs)/g;

/**
 * Copy MapLibre's dist files into `targetDir` (a URL or absolute path), and
 * refuse a bundle that emits a MapLibre-importing chunk anywhere else.
 *
 * The import path is relative to the importing chunk, so a chunk one directory
 * down 404s on it, and with it everything that chunk is an entry for. Up to
 * Vite 6 an entry did not even have to import MapLibre itself: Rollup hoisted
 * the imports of its dependencies into it (output.hoistTransitiveImports),
 * which is how the site's configurator page broke at assets/configurator/
 * while every chunk that visibly used MapLibre sat in assets/. Rolldown does
 * not hoist, but the chunk layout is still the bundler's to choose. The build
 * fails here instead.
 *
 * It also hands the worker pin to whoever bundles the output next. The source
 * marks the pin `@vite-ignore` (the worker does not sit next to the source, so
 * our build would rewrite the URL into a shape no bundler recognises), and the
 * library build keeps comments — so the comment is blanked out here, with as
 * many spaces as it had characters: line and column of everything else stay
 * put, and so does the sourcemap. A bundle that imports MapLibre without
 * carrying the plain pin fails the build: a host's bundler would lose the
 * worker without a word.
 */
export function copyMaplibreDist(targetDir) {
  const to = typeof targetDir === "string" ? targetDir : fileURLToPath(targetDir);
  return {
    name: "map0:copy-maplibre-dist",
    generateBundle(options, bundle) {
      const outDir = resolve(options.dir ?? dirname(options.file));
      const expected = posix(relative(outDir, to));
      const dirOf = (fileName) => posix(dirname(fileName)).replace(/^\.$/, "");
      const chunks = Object.values(bundle).filter((out) => out.type === "chunk");
      const misplaced = chunks
        .filter((chunk) => importsMaplibre(chunk) && dirOf(chunk.fileName) !== expected)
        .map((chunk) => chunk.fileName);
      if (misplaced.length > 0) {
        this.error(
          `MapLibre is imported as "${IMPORT_PATH}", so every chunk that imports it must be emitted in ` +
            `${expected || "the output root"}/ next to the copied file; these are not: ${misplaced.join(", ")}`,
        );
      }

      for (const chunk of chunks) chunk.code = chunk.code.replace(PIN_IGNORE, (c) => " ".repeat(c.length));
      if (chunks.some(importsMaplibre) && !chunks.some((chunk) => WORKER_PIN.test(chunk.code))) {
        this.error(
          'no chunk carries the MapLibre worker pin `new URL("./maplibre-gl-worker.mjs", import.meta.url)` ' +
            "(packages/core/src/maplibre-worker.ts) — a host's bundler would not find the worker",
        );
      }
    },
    /* writeBundle, not closeBundle: it runs only once the chunks are on disk,
       so a build the hook above refused does not end in a copy into an output
       directory that was never written (an ENOENT that would hide the refusal) */
    writeBundle() {
      const require = createRequire(import.meta.url);
      const from = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
      for (const file of FILES) copyFileSync(join(from, file), join(to, file));
      for (const file of OPTIONAL_FILES) {
        if (existsSync(join(from, file))) copyFileSync(join(from, file), join(to, file));
      }
    },
  };
}

/** bundler settings (build.rolldownOptions) that keep MapLibre out of our chunks and next to them */
export const maplibreExternal = {
  /* the bare specifier only — "maplibre-gl/dist/maplibre-gl.css?inline" stays inlined */
  external: (id) => id === "maplibre-gl",
  /* written verbatim into every chunk that imports MapLibre, so those chunks
     must sit in the same directory as the copied files — copyMaplibreDist
     fails the build when one does not */
  paths: { "maplibre-gl": IMPORT_PATH },
};
