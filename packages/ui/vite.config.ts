import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * MapLibre v6 spawns its worker from SEPARATE module files resolved relative to the
 * main bundle URL: maplibre-gl-worker.mjs (shim) → imports maplibre-gl-shared.mjs
 * (engine). Both must ship next to map0.js. (Blob-inlining is a possible M1 option.)
 */
function copyMaplibreWorker(): Plugin {
  return {
    name: "map0:copy-maplibre-worker",
    closeBundle() {
      const require = createRequire(import.meta.url);
      for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        const src = require.resolve(`maplibre-gl/dist/${file}`);
        copyFileSync(src, fileURLToPath(new URL(`./dist/${file}`, import.meta.url)));
      }
    },
  };
}

/**
 * M0 distribution: one ESM file (MapLibre, Lit, adapters, CSS inlined) + the MapLibre
 * worker file. `<script type="module" src="map0.js">` on a plain HTML page is the install.
 * Bundle splitting/lazy modules come in M1 (see docs/06-architecture.md → Performance).
 */
export default defineConfig({
  plugins: [copyMaplibreWorker()],
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
      output: { inlineDynamicImports: true },
    },
  },
});
