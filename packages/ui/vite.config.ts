import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { optionalPeerStubs } from "../../scripts/stub-aliases.mjs";
import { copyMaplibreDist, maplibreExternal } from "../../scripts/maplibre-dist.mjs";

/**
 * Distribution: `map0.js` is the entry, everything a first view does not need
 * (capabilities parsing, the dialogs, proj4, PMTiles) lands in lazy chunks that
 * load on first use. Deployment stays "copy the folder"; the embed is unchanged.
 *
 * MapLibre stays external and is copied in verbatim — see scripts/maplibre-dist.mjs
 * for why, and for the silent failure that follows from getting it wrong.
 */
export default defineConfig({
  plugins: [copyMaplibreDist(new URL("./dist", import.meta.url))],
  resolve: {
    /* shared with the site build — see scripts/stub-aliases.mjs */
    alias: { ...optionalPeerStubs },
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
      external: maplibreExternal.external,
      output: {
        /* the copied files sit next to the entry, so every chunk that imports
           MapLibre must live there too — a chunks/ subfolder would resolve
           "./maplibre-gl.mjs" one level down */
        paths: maplibreExternal.paths,
        entryFileNames: "map0.js",
        chunkFileNames: "[name]-[hash].js",
      },
    },
  },
});
