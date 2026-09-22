import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { optionalPeerStubs } from "../../scripts/stub-aliases.mjs";

/**
 * The CLI is one Node bundle. `@map0/core` and `@map0/schema` are compiled in
 * (their sources use TypeScript-style `.js` imports that plain Node cannot
 * resolve), ogc-client stays a runtime dependency. Tree-shaking with
 * `moduleSideEffects: false` is what keeps MapLibre, jsPDF and the other
 * browser-only dependencies of core out: the checker reaches core's
 * capabilities reading and request builders only, and Rollup may drop every
 * module whose exports it never uses — including their import statements.
 */
export default defineConfig({
  resolve: {
    alias: { ...optionalPeerStubs },
  },
  build: {
    target: "node22",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    ssr: fileURLToPath(new URL("./src/cli.ts", import.meta.url)),
    rollupOptions: {
      output: { entryFileNames: "map0-check.js", format: "es" },
      treeshake: { moduleSideEffects: false },
    },
  },
  ssr: {
    target: "node",
    noExternal: [/^@map0\//],
  },
});
