import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { optionalPeerStubs } from "../scripts/stub-aliases.mjs";
import { copyMaplibreDist, maplibreExternal } from "../scripts/maplibre-dist.mjs";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* Every page is its own entry — an .html file added here or under demos/ is
   picked up by the next build without touching this file. */
const pagesIn = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(r(dir))
      .filter((f) => f.endsWith(".html"))
      .map((f) => [`${dir === "." ? "" : `${dir}/`}${f.slice(0, -5)}`, r(`${dir}/${f}`)]),
  );

/**
 * Umami (self-hosted, cookieless) on every page of the deployed site.
 *
 * Injected here rather than written into 20-odd HTML files: a page added later
 * is counted without anyone remembering to paste a script tag. `apply: "build"`
 * keeps it out of `pnpm dev`, so day-to-day work never shows up in the
 * statistics — `pnpm serve` does serve it, since it serves the build.
 */
function analytics(): Plugin {
  return {
    name: "map0:analytics",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: () => [
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "https://analytics.spatial-focus.net/script.js",
            "data-website-id": "4e0f4c01-a1f2-44cf-b4b9-f4d8bd6c4328",
          },
          injectTo: "head",
        },
      ],
    },
  };
}

/**
 * The demo site: dev server (workspace packages resolved to their sources) and
 * the static build deployed as the project website (`pnpm build:site`).
 */
export default defineConfig({
  root: r("."),
  publicDir: "public",
  /* a multi-page site, not an app: no index.html fallback, so a missing file is
     a 404 in dev and preview too. The SPA fallback once served HTML to
     MapLibre's worker with status 200 and it died without a word. */
  appType: "mpa",
  /* MapLibre's three files land next to the hashed chunks in assets/ */
  plugins: [copyMaplibreDist(r("../dist-site/assets")), analytics()],
  build: {
    /* same target as the library bundle: the demo shell loads @map0/ui with a
       top-level await, which the default (es2020) target rejects */
    target: "es2022",
    outDir: r("../dist-site"),
    emptyOutDir: true,
    rollupOptions: {
      input: { ...pagesIn("."), ...pagesIn("demos") },
      external: maplibreExternal.external,
      output: { paths: maplibreExternal.paths },
    },
  },
  resolve: {
    alias: {
      "@map0/schema": r("../packages/schema/src/index.ts"),
      "@map0/core": r("../packages/core/src/index.ts"),
      "@map0/ui": r("../packages/ui/src/index.ts"),
      /* the site compiles those sources itself, so it needs the same stubs the
         library build uses — see scripts/stub-aliases.mjs */
      ...optionalPeerStubs,
    },
  },
  optimizeDeps: {
    // MapLibre v6 spawns a module worker (maplibre-gl-worker.mjs); Vite's dep
    // pre-bundling rewrites the worker URL into .vite/deps where it 404s and the
    // worker dies silently → no vector tiles / GeoJSON. Serve it un-bundled.
    exclude: ["maplibre-gl"],
    // No `include` here: the dialog deps (@camptocamp/ogc-client, jspdf, proj4,
    // pmtiles) are dynamically imported from @map0/core, and Vite's scanner
    // follows bare `import()` calls, so they are already pre-bundled at startup.
    // Naming them here would only warn — this root is outside the workspace, so
    // pnpm leaves them unreachable under packages/core/node_modules.
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  /* `pnpm serve` — the built site, exactly as it will be uploaded */
  preview: {
    port: 4173,
    strictPort: true,
  },
});
