import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { optionalPeerStubs } from "../scripts/stub-aliases.mjs";
import { copyMaplibreDist, maplibreExternal } from "../scripts/maplibre-dist.mjs";
import { i18n } from "./i18n/plugin.js";
import { prettyPath } from "./i18n/translate.js";

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

/** The GitHub mark, inlined: no icon font, no extra request. */
const GITHUB_ICON =
  `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">` +
  `<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>` +
  `</svg>`;

/* Sun/moon for the theme toggle — which one shows is pure CSS (see demo.css),
   so the icon is right even before any script runs. */
const SUN_ICON =
  `<svg class="sun" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">` +
  `<circle cx="12" cy="12" r="4" fill="currentColor"/>` +
  `<path stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/>` +
  `</svg>`;
const MOON_ICON =
  `<svg class="moon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">` +
  `<path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>` +
  `</svg>`;

/* Head script on every page: apply a stored dark/light choice before first
   paint (no stored choice = the OS decides, live, via the media queries in
   demo.css), and expose the two handlers the topbar controls call. Embedded
   maps follow through the viewer's `theme` attribute. */
const CHROME_SCRIPT =
  `(function(){` +
  `try{var t=localStorage.getItem("map0-theme");if(t==="dark"||t==="light")document.documentElement.classList.add(t)}catch(e){}` +
  `var mapsTo=function(t){document.querySelectorAll("map0-viewer").forEach(function(v){v.setAttribute("theme",t)})};` +
  `window.__map0={` +
  `theme:function(){var d=document.documentElement,dark=d.classList.contains("dark")||` +
  `(!d.classList.contains("light")&&matchMedia("(prefers-color-scheme: dark)").matches),n=dark?"light":"dark";` +
  `d.classList.remove("dark","light");d.classList.add(n);try{localStorage.setItem("map0-theme",n)}catch(e){}mapsTo(n)},` +
  `lang:function(l){try{localStorage.setItem("map0-lang",l)}catch(e){}}};` +
  `addEventListener("DOMContentLoaded",function(){try{var t=localStorage.getItem("map0-theme");` +
  `if(t==="dark"||t==="light")mapsTo(t)}catch(e){}});` +
  `})()`;

/**
 * One topbar and one footer on every page — injected like the analytics tag,
 * so the 20-odd HTML files cannot drift apart. Markup lives here, styling in
 * demo.css (.topbar, footer.site), which every page loads. No `apply:
 * "build"`: the chrome belongs in `pnpm dev` too.
 */
function sharedChrome(): Plugin {
  return {
    name: "map0:chrome",
    transformIndexHtml: {
      handler: (_html, ctx) => {
        const page = ctx.path.replace(/^\//, "") || "index.html";
        return [
          { tag: "script", children: CHROME_SCRIPT, injectTo: "head-prepend" },
          {
            tag: "div",
            attrs: { class: "topbar" },
            children:
              `<div class="wrap">` +
              `<a class="brand" href="/">map<span>0</span></a>` +
              `<nav>` +
              `<a href="/#start" data-i18n="chrome.nav.start">Quick start</a>` +
              `<a href="/#features" data-i18n="chrome.nav.features">Features</a>` +
              `<a href="/#next" data-i18n="chrome.nav.next">What's next</a>` +
              `<a href="/demos/"${ctx.path.includes("demos/") ? ' aria-current="page"' : ""} data-i18n="chrome.nav.demos">Demos</a>` +
              `<a href="/playground/"${ctx.path.includes("playground") ? ' aria-current="page"' : ""} data-i18n="chrome.nav.playground">Playground</a>` +
              `<a class="gh" href="https://github.com/SpatialFocus/map0" aria-label="map0 on GitHub" data-i18n-attrs="aria-label:chrome.nav.github">${GITHUB_ICON}</a>` +
              `<button class="theme-toggle" type="button" aria-label="Toggle dark mode" data-i18n-attrs="aria-label:chrome.theme" onclick="__map0.theme()">${SUN_ICON}${MOON_ICON}</button>` +
              `<div class="lang" role="group" aria-label="Language" data-i18n-attrs="aria-label:chrome.lang">` +
              `<a data-lang="en" href="${prettyPath(page)}" aria-current="true" onclick="__map0.lang('en')">EN</a>` +
              `<a data-lang="de" href="/de${prettyPath(page)}" onclick="__map0.lang('de')">DE</a>` +
              `</div>` +
              `</nav>` +
              `</div>`,
            injectTo: "body-prepend",
          },
          {
            tag: "footer",
            attrs: { class: "site" },
            children:
              `<div class="wrap">` +
              `<a class="footmark" href="/">map<span>0</span></a>` +
              `<span data-i18n="chrome.tagline">The web map client you configure, not code.</span>` +
              `<nav class="footnav">` +
              `<a href="/imprint.html" data-i18n="chrome.imprint">Imprint</a>` +
              `<a href="/privacy.html" data-i18n="chrome.privacy">Privacy</a>` +
              `<span data-i18n="chrome.madeby">Made with ❤️ by <a href="https://www.spatial-focus.net">Spatial Focus</a></span>` +
              `</nav>` +
              `</div>`,
            injectTo: "body",
          },
        ];
      },
    },
  };
}

/**
 * The published config schema (C3), served at /schema/v1.json — the stable
 * `$schema` URL on map0.net. The canonical file lives in packages/schema next
 * to the validator it is sync-tested against, so it is copied in at build (and
 * served from source in dev) rather than committed twice; the npm package
 * carries the same file (scripts/build-npm.mjs).
 */
function schemaFile(): Plugin {
  const src = r("../packages/schema/v1.json");
  return {
    name: "map0:schema",
    configureServer(server) {
      server.middlewares.use("/schema/v1.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(readFileSync(src));
      });
    },
    closeBundle() {
      mkdirSync(r("../dist-site/schema"), { recursive: true });
      copyFileSync(src, r("../dist-site/schema/v1.json"));
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
  plugins: [copyMaplibreDist(r("../dist-site/assets")), analytics(), sharedChrome(), schemaFile(), i18n(r("../dist-site"))],
  build: {
    /* same target as the library bundle: the demo shell loads @map0/ui with a
       top-level await, which the default (es2020) target rejects */
    target: "es2022",
    outDir: r("../dist-site"),
    emptyOutDir: true,
    rollupOptions: {
      input: { ...pagesIn("."), ...pagesIn("demos"), ...pagesIn("playground") },
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
