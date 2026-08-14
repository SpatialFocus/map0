import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Dev server for the demo gallery — resolves workspace packages to their sources. */
export default defineConfig({
  root: r("."),
  publicDir: "public",
  resolve: {
    alias: {
      "@map0/schema": r("../packages/schema/src/index.ts"),
      "@map0/core": r("../packages/core/src/index.ts"),
      "@map0/ui": r("../packages/ui/src/index.ts"),
    },
  },
  optimizeDeps: {
    // MapLibre v6 spawns a module worker (maplibre-gl-worker.mjs); Vite's dep
    // pre-bundling rewrites the worker URL into .vite/deps where it 404s and the
    // worker dies silently → no vector tiles / GeoJSON. Serve it un-bundled.
    exclude: ["maplibre-gl"],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
