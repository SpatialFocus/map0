import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

/**
 * MapLibre ships as ESM split across three files: maplibre-gl.mjs (main thread),
 * maplibre-gl-worker.mjs (worker entry) and maplibre-gl-shared.mjs, which BOTH
 * import. Bundling the library would put that shared half into our bundle while
 * the worker still needs its own copy on disk — ~130 KB gzip shipped twice.
 * So we keep maplibre-gl external, copy its files verbatim into dist and let the
 * browser resolve them relative to our entry. Side effect worth having: those
 * files are byte-identical across map0 releases and stay in the HTTP cache.
 */
function copyMaplibreDist(): Plugin {
  return {
    name: "map0:copy-maplibre-dist",
    closeBundle() {
      const require = createRequire(import.meta.url);
      const from = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
      const to = fileURLToPath(new URL("./dist", import.meta.url));
      for (const file of [
        "maplibre-gl.mjs",
        "maplibre-gl-shared.mjs",
        "maplibre-gl-worker.mjs",
      ]) {
        copyFileSync(join(from, file), join(to, file));
      }
    },
  };
}

/**
 * Distribution: `map0.js` is the entry, everything a first view does not need
 * (capabilities parsing, the dialogs, proj4, PMTiles) lands in lazy chunks that
 * load on first use. Deployment stays "copy the folder"; the embed is unchanged.
 */
export default defineConfig({
  plugins: [copyMaplibreDist()],
  resolve: {
    alias: {
      /* ogc-client's optional OpenLayers/proj4 peers — stubbed, see src/stubs/ol-stub.ts */
      "ol/tilegrid/WMTS": fileURLToPath(new URL("./src/stubs/ol-stub.ts", import.meta.url)),
      "ol/proj/proj4": fileURLToPath(new URL("./src/stubs/ol-stub.ts", import.meta.url)),
      "ol/proj": fileURLToPath(new URL("./src/stubs/ol-stub.ts", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "map0.js",
    },
    rollupOptions: {
      /* the bare specifier only — "maplibre-gl/dist/maplibre-gl.css?inline" stays inlined */
      external: (id) => id === "maplibre-gl",
      output: {
        /* Rollup writes this specifier verbatim into every chunk that imports
           MapLibre, so chunks must sit in the same directory as the entry —
           a chunks/ subfolder would resolve "./maplibre-gl.mjs" one level down. */
        paths: { "maplibre-gl": "./maplibre-gl.mjs" },
        entryFileNames: "map0.js",
        chunkFileNames: "[name]-[hash].js",
      },
    },
  },
});
