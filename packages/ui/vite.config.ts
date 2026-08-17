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
      /* two entries: the browser one (a custom element, needs a DOM to be
         evaluated at all) and the SSR-safe one that only reaches for it via
         import() — see src/ssr.ts */
      entry: {
        map0: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        "map0-ssr": fileURLToPath(new URL("./src/ssr.ts", import.meta.url)),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: maplibreExternal.external,
      output: {
        /* the copied files sit next to the entry, so every chunk that imports
           MapLibre must live there too — a chunks/ subfolder would resolve
           "./maplibre-gl.mjs" one level down */
        paths: maplibreExternal.paths,
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
      },
    },
  },
});
