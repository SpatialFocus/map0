/**
 * Visual regression (N9) — screenshots of the viewer's UI states, compared with
 * committed baselines. Runs in CI against the BUILT bundle.
 *
 * Network-free like smoke.mjs: `empty` basemaps and inline GeoJSON, every
 * request to another host is blocked and fails the scene. The demo pages
 * themselves draw live SDI tiles, so a screenshot of them would change
 * whenever a server re-renders; the scenes below rebuild what the demos show
 * (layer tree, legend, popups, dialogs, measuring, theming, i18n, the phone
 * layout) from fixtures instead.
 *
 * Text and anti-aliasing differ between operating systems, so the baselines are
 * per platform: e2e/visual/<process.platform>/<scene>.png. CI compares against
 * `linux`; `pnpm visual:linux` produces those on any machine with Docker.
 *
 *   pnpm build && node e2e/visual.mjs              compare every scene
 *   node e2e/visual.mjs toc legend                 only these
 *   node e2e/visual.mjs --update [scene …]         accept the current rendering
 *   node e2e/visual.mjs --serve                    open the scenes in a browser yourself
 *
 * A failing scene leaves <scene>.actual.png and <scene>.diff.png in
 * e2e/visual/.out/<platform>/.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const DIST = new URL("../packages/ui/dist/", import.meta.url);
const BASELINES = new URL(`./visual/${process.platform}/`, import.meta.url);
const OUT = new URL(`./visual/.out/${process.platform}/`, import.meta.url);
/* a webfont instead of the system stack: the same glyphs on every machine that
   shares a platform, whatever fonts the CI image happens to carry */
const FONT_FILE = createRequire(import.meta.url).resolve(
  "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
);
const FONT = "Map0 Visual";

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const SERVE = args.includes("--serve");
const ONLY = args.filter((a) => !a.startsWith("--"));

/** per-channel colour distance pixelmatch tolerates (0..1), anti-aliased pixels are ignored */
const THRESHOLD = 0.1;
/** differing pixels a scene may have before it fails — a checkbox state is ~150 */
const MAX_DIFF_PIXELS = 40;

/* ------------------------------------------------------------------ fixtures */

const box = (w, s, e, n) => ({
  type: "Polygon",
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});
const feature = (properties, geometry) => ({ type: "Feature", properties, geometry });
const fc = (...features) => ({ type: "FeatureCollection", features });

const PARKS = fc(
  feature({ name: "Prater", kind: "Park", area_ha: 600 }, box(16.395, 48.19, 16.43, 48.212)),
  feature({ name: "Augarten", kind: "Park", area_ha: 52 }, box(16.368, 48.222, 16.382, 48.231)),
  feature({ name: "Türkenschanzpark", kind: "Park", area_ha: 15 }, box(16.322, 48.234, 16.338, 48.242)),
);
const WATERWAYS = fc(
  feature(
    { name: "Donaukanal" },
    {
      type: "LineString",
      coordinates: [
        [16.335, 48.248],
        [16.36, 48.231],
        [16.378, 48.217],
        [16.395, 48.207],
        [16.425, 48.186],
      ],
    },
  ),
);
const STOPS = fc(
  ...[
    ["Stephansplatz", 16.3725, 48.2083],
    ["Schwedenplatz", 16.3778, 48.2117],
    ["Praterstern", 16.3917, 48.2186],
    ["Karlsplatz", 16.3699, 48.2003],
    ["Schottentor", 16.3622, 48.2152],
  ].map(([name, lng, lat]) => feature({ name, lines: "U1 U4" }, { type: "Point", coordinates: [lng, lat] })),
);
const DISTRICTS = fc(
  feature({ name: "Innere Stadt" }, box(16.355, 48.198, 16.385, 48.218)),
  feature({ name: "Leopoldstadt" }, box(16.385, 48.205, 16.44, 48.235)),
);
const NOISE = fc(feature({ db: 65 }, box(16.34, 48.19, 16.36, 48.205)));
const LANDUSE = fc(feature({ use: "residential" }, box(16.33, 48.2, 16.37, 48.23)));

const STOPS_LAYER = {
  id: "stops",
  type: "geojson",
  title: "Public transport stops",
  data: STOPS,
  style: { "circle-color": "#1d4ed8", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 },
  popup: { title: "{{name}}", fields: [{ key: "lines", label: "Lines" }] },
};
const PARKS_LAYER = {
  id: "parks",
  type: "geojson",
  title: "Parks and green areas",
  data: PARKS,
  style: { "fill-color": "#16a34a", "fill-opacity": 0.55 },
  popup: {
    title: "{{name}}",
    fields: [
      { key: "kind", label: "Kind" },
      { key: "area_ha", label: "Area (ha)" },
    ],
  },
};

const base = (extra = {}) => ({
  version: 1,
  meta: { title: "map0 visual regression" },
  map: { center: [16.424, 48.217], zoom: 12 },
  basemaps: [{ type: "empty", id: "plain", title: "Plain" }],
  /* geolocate and fullscreen depend on what the browser grants, not on map0 */
  controls: { geolocate: false, fullscreen: false },
  theme: { font: `"${FONT}"` },
  ...extra,
});

/** the layer tree as most demos have it: groups, a radio group, a collapsed group, a hidden layer, a zoom hint */
const TREE = base({
  basemaps: [
    { type: "empty", id: "plain", title: "Plain" },
    { type: "empty", id: "blank", title: "Blank" },
  ],
  layers: [
    STOPS_LAYER,
    {
      type: "group",
      title: "Environment",
      children: [
        PARKS_LAYER,
        {
          id: "waterways",
          type: "geojson",
          title: "Waterways",
          data: WATERWAYS,
          opacity: 0.8,
          style: { "line-color": "#0284c7", "line-width": 4 },
        },
        {
          id: "noise",
          type: "geojson",
          title: "Road noise 2024",
          data: NOISE,
          visible: false,
          style: { "fill-color": "#ea580c", "fill-opacity": 0.5 },
        },
      ],
    },
    {
      type: "group",
      title: "Land use",
      exclusive: true,
      children: [
        {
          id: "landuse-2024",
          type: "geojson",
          title: "Land use 2024",
          data: LANDUSE,
          style: { "fill-color": "#a16207", "fill-opacity": 0.2 },
        },
        {
          id: "landuse-2014",
          type: "geojson",
          title: "Land use 2014",
          data: LANDUSE,
          style: { "fill-color": "#7c3aed", "fill-opacity": 0.2 },
        },
      ],
    },
    {
      type: "group",
      title: "Administration",
      collapsed: true,
      children: [
        {
          id: "districts",
          type: "geojson",
          title: "Districts",
          data: DISTRICTS,
          /* a style layer, not the simple style: simple line-* keys only draw LineStrings */
          style: [{ type: "line", paint: { "line-color": "#6b21a8", "line-width": 2 } }],
        },
      ],
    },
    {
      id: "buildings",
      type: "geojson",
      title: "Building footprints",
      data: fc(),
      minZoom: 15,
    },
  ],
});

/** legend panel: style-derived swatches next to hand-written entries */
const LEGEND = base({
  layers: [
    STOPS_LAYER,
    PARKS_LAYER,
    {
      id: "districts",
      type: "geojson",
      title: "Districts",
      data: DISTRICTS,
      /* a style layer, not the simple style: simple line-* keys only draw LineStrings */
          style: [{ type: "line", paint: { "line-color": "#6b21a8", "line-width": 2 } }],
      legend: [
        { label: "District boundary", color: "#6b21a8", shape: "line" },
        { label: "City centre", color: "#f59e0b", shape: "circle" },
        { label: "Planning area", color: "#94a3b8", shape: "square" },
      ],
    },
  ],
  controls: {
    geolocate: false,
    fullscreen: false,
    layerSwitcher: { open: false },
    legend: { open: true },
  },
});

const INVALID = {
  version: 1,
  basemaps: [{ type: "wms", url: "https://example.org/wms" }],
  layers: [{ type: "geojson", title: "No data" }, { type: "group" }],
};

/* -------------------------------------------------------------------- scenes */

/**
 * name → { config, viewport?, phone?, act? }. `act` drives the page into the
 * state worth a picture; it receives helpers bound to the page.
 */
const SCENES = {
  /* layer tree, basemap switcher, search box, map controls */
  toc: {
    config: { ...TREE, search: { provider: "photon" } },
  },
  /* the same tree in dark mode, German, with another accent and radius */
  "toc-dark-de": {
    config: {
      ...TREE,
      theme: { mode: "dark", primary: "#e11d48", radius: "lg", font: `"${FONT}"` },
      i18n: { locale: "de" },
    },
  },
  /* the filter box with a query: a group title hit, highlighted terms */
  "toc-filter": {
    config: {
      ...TREE,
      controls: { geolocate: false, fullscreen: false, layerSwitcher: { filter: true } },
    },
    act: async ({ page }) => {
      await page.locator("map0-viewer .toc-filter input").fill("land 20");
    },
  },
  /* default corners, legend open: the tree and the legend share the right edge */
  "toc-legend": {
    config: { ...TREE, controls: { geolocate: false, fullscreen: false, legend: { open: true } } },
  },
  /* the tree docked bottom-left, above the basemap switcher, below the search */
  "toc-bottom-left": {
    config: {
      ...TREE,
      search: { provider: "photon" },
      controls: { geolocate: false, fullscreen: false, layerSwitcher: { position: "bottom-left" }, legend: { open: true } },
    },
  },
  legend: { config: LEGEND },
  /* a click on a park: popup with title and field table, feature highlighted */
  popup: {
    config: { ...TREE, controls: { geolocate: false, fullscreen: false, layerSwitcher: { open: false } } },
    act: async ({ clickAt, waitIn }) => {
      await clickAt(16.41, 48.2);
      await waitIn("popup", ".maplibregl-popup-content");
    },
  },
  /* measuring: three vertices of a distance line, the bar with the result */
  measure: {
    config: { ...TREE, controls: { geolocate: false, fullscreen: false, layerSwitcher: { open: false } } },
    act: async ({ clickAt, clickButton, waitIn }) => {
      await clickButton("Measure");
      await waitIn("measure", ".measure-bar");
      await clickAt(16.3725, 48.2056);
      await clickAt(16.398, 48.2319);
      await clickAt(16.4274, 48.2147);
    },
  },
  "add-layer": {
    config: TREE,
    act: async ({ page, waitIn }) => {
      await page.evaluate(() =>
        document.querySelector("map0-viewer").shadowRoot.querySelector(".add-btn").click(),
      );
      await waitIn("add-layer", "map0-add-layer", ".dialog");
    },
  },
  print: {
    config: TREE,
    act: async ({ clickButton, waitIn }) => {
      await clickButton("Print & export");
      await waitIn("print", "map0-print", ".dialog");
    },
  },
  /* a phone: the layer tree collapses to a button, a tap opens the bottom sheet */
  phone: {
    config: { ...TREE, map: { center: [16.385, 48.19], zoom: 11.8 } },
    viewport: { width: 375, height: 667 },
    phone: true,
    act: async ({ page, project }) => {
      const [x, y] = await project(16.41, 48.2);
      await page.touchscreen.tap(x, y);
      await page.waitForFunction(
        () => {
          const sheet = document.querySelector("map0-viewer").shadowRoot.querySelector(".sheet");
          return !!sheet && sheet.getAnimations().length === 0;
        },
        undefined,
        { timeout: 15_000 },
      );
    },
  },
  /* the error panel an invalid config renders in place of the map */
  error: { config: INVALID, invalid: true },
};

/* ------------------------------------------------------------------- server */

const sceneHtml = (scene) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>map0 visual</title>
<link rel="preload" href="/__visual/font.woff2" as="font" type="font/woff2" crossorigin>
<style>
  @font-face { font-family: "${FONT}"; src: url(/__visual/font.woff2) format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; background: #fff; }
  #host { width: ${scene.phone ? "100vw" : "800px"}; height: ${scene.phone ? "100vh" : "560px"}; }
  map0-viewer { display: block; width: 100%; height: 100%; }
</style></head>
<body>
<div id="host"><map0-viewer loading="eager"></map0-viewer></div>
<script type="module">
  import "/map0.js";
</script>
<script>
  window.__events = [];
  const el = document.querySelector("map0-viewer");
  for (const type of ["map0:ready", "map0:error"]) el.addEventListener(type, () => window.__events.push(type));
  /* the config waits for the font, so the first layout already uses it */
  document.fonts.load('16px "${FONT}"').then(() => { el.config = ${JSON.stringify(scene.config)}; });
</script>
</body></html>`;

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const scene = path.match(/^\/__visual\/scene\/([\w-]+)$/)?.[1];
  if (scene && SCENES[scene]) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(sceneHtml(SCENES[scene]));
  }
  if (path === "/__visual/font.woff2") {
    return readFile(FONT_FILE).then((body) => {
      res.writeHead(200, { "content-type": "font/woff2" });
      res.end(body);
    });
  }
  readFile(new URL(`.${path}`, DIST))
    .then((body) => {
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    })
    .catch(() => {
      res.writeHead(404).end("not found");
    });
});

await new Promise((resolve) => server.listen(SERVE ? 4174 : 0, "127.0.0.1", resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* --serve: keep the scenes up for a look in a real browser, compare nothing */
if (SERVE) {
  console.log("scenes (Ctrl+C to stop):");
  for (const name of Object.keys(SCENES)) console.log(`  ${ORIGIN}/__visual/scene/${name}`);
  await new Promise(() => {});
}

/* ------------------------------------------------------------------- driver */

/* the bundled Chromium only — no system Chrome fallback as in smoke.mjs: a
   different browser build renders different pixels */
const browser = await chromium
  .launch({
    args: [
      "--enable-unsafe-swiftshader", // WebGL2 without a GPU, the same rasteriser everywhere
      "--font-render-hinting=none",
      "--force-color-profile=srgb",
    ],
  })
  .catch((e) => {
    console.error("the bundled Chromium is missing — run `pnpm exec playwright install chromium`");
    throw e;
  });

/** wait until a selector resolves in `page` — `path` steps through nested shadow roots */
async function waitIn(page, what, ...path) {
  await page
    .waitForFunction(
      (selectors) => {
        let root = document.querySelector("map0-viewer").shadowRoot;
        let node = null;
        for (const s of selectors) {
          node = root?.querySelector(s);
          if (!node) return false;
          root = node.shadowRoot ?? node;
        }
        return node.getAnimations?.().length === 0;
      },
      path,
      { timeout: 15_000 },
    )
    .catch(() => {
      throw new Error(`${what}: ${path.join(" › ")} never appeared`);
    });
}

/** map idle, fonts loaded, two frames painted — the moment a screenshot is stable */
const settle = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const map = document.querySelector("map0-viewer").api?.map;
    if (map) {
      await new Promise((resolve) => {
        map.once("idle", resolve);
        map.triggerRepaint();
      });
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

async function shoot(name, scene) {
  const context = await browser.newContext({
    viewport: scene.viewport ?? { width: 800, height: 560 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    colorScheme: "light",
    ...(scene.phone ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  const problems = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    problems.push(`blocked request to ${url.slice(0, 120)}`);
    return route.abort();
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !scene.invalid) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));

  try {
    await page.goto(`${ORIGIN}/__visual/scene/${name}`, { waitUntil: "domcontentloaded" });
    if (scene.invalid) {
      await page.waitForFunction(() => window.__events.includes("map0:error"), undefined, { timeout: 30_000 });
    } else {
      await page.waitForFunction(
        () => {
          const el = document.querySelector("map0-viewer");
          const layers = el?.api?.layers.state.value ?? [];
          return (
            window.__events.includes("map0:ready") &&
            layers.length > 0 &&
            layers.every((l) => l.status !== "loading")
          );
        },
        undefined,
        { timeout: 60_000 },
      );
      await settle(page);
    }

    const project = (lng, lat) =>
      page.evaluate(
        ([lng, lat]) => {
          const el = document.querySelector("map0-viewer");
          const p = el.api.map.project([lng, lat]);
          const r = el.api.map.getContainer().getBoundingClientRect();
          return [r.left + p.x, r.top + p.y];
        },
        [lng, lat],
      );
    const clickAt = async (lng, lat) => {
      const [x, y] = await project(lng, lat);
      await page.mouse.click(x, y);
    };
    const clickButton = (label) =>
      page.evaluate((label) => {
        const btn = document
          .querySelector("map0-viewer")
          .shadowRoot.querySelector(`button[aria-label="${label}"]`);
        if (!btn) throw new Error(`no button "${label}"`);
        btn.click();
      }, label);

    if (scene.act) {
      await scene.act({ page, project, clickAt, clickButton, waitIn: (what, ...path) => waitIn(page, what, ...path) });
      await settle(page);
    }

    /* theme.font covers map0's own text; MapLibre's controls, code in the error
       panel and anything else with a font stack of its own would fall back to
       whatever the machine has installed */
    await page.evaluate((font) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`* { font-family: "${font}" !important; }`);
      const visit = (root) => {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
      };
      visit(document.querySelector("map0-viewer").shadowRoot);
    }, FONT);
    await settle(page);

    const png = await page.locator("#host").screenshot({ animations: "disabled", caret: "hide" });
    return { png, problems };
  } catch (e) {
    problems.push(String(e.message ?? e).split("\n")[0]);
    return { png: null, problems };
  } finally {
    await context.close();
  }
}

function compare(expected, actual) {
  const a = PNG.sync.read(expected);
  const b = PNG.sync.read(actual);
  if (a.width !== b.width || a.height !== b.height) {
    return { pixels: Infinity, size: `${a.width}×${a.height} → ${b.width}×${b.height}` };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const pixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: THRESHOLD });
  return { pixels, diff: PNG.sync.write(diff) };
}

/* -------------------------------------------------------------------- run */

const names = ONLY.length > 0 ? ONLY : Object.keys(SCENES);
const unknown = names.filter((n) => !SCENES[n]);
if (unknown.length > 0) {
  console.error(`unknown scene(s): ${unknown.join(", ")} — known: ${Object.keys(SCENES).join(", ")}`);
  process.exit(2);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(BASELINES, { recursive: true });
let failed = 0;
console.log(`visual regression — ${process.platform} baselines${UPDATE ? ", updating" : ""}`);

try {
  for (const name of names) {
    const { png, problems } = await shoot(name, SCENES[name]);
    const baseline = new URL(`${name}.png`, BASELINES);
    const report = (ok, detail) => {
      if (!ok) failed++;
      console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
      for (const p of problems) console.log(`         ${p}`);
    };
    if (!png || problems.length > 0) {
      report(false, "the scene did not render cleanly");
      continue;
    }
    const known = existsSync(baseline);
    const result = known ? compare(await readFile(baseline), png) : null;
    if (UPDATE) {
      /* rewrite only on a real change, so re-running --update leaves git alone */
      if (!result || result.pixels > 0) {
        await writeFile(baseline, png);
        report(true, known ? `baseline updated (${result.size ?? `${result.pixels} px`})` : "baseline written");
      } else report(true, "unchanged");
      continue;
    }
    if (!result) {
      await mkdir(OUT, { recursive: true });
      await writeFile(new URL(`${name}.actual.png`, OUT), png);
      report(false, `no ${process.platform} baseline — run with --update and review the image`);
      continue;
    }
    if (result.pixels <= MAX_DIFF_PIXELS) {
      report(true, result.pixels > 0 ? `${result.pixels} px within tolerance` : "");
      continue;
    }
    await mkdir(OUT, { recursive: true });
    await writeFile(new URL(`${name}.actual.png`, OUT), png);
    if (result.diff) await writeFile(new URL(`${name}.diff.png`, OUT), result.diff);
    report(false, result.size ? `size changed ${result.size}` : `${result.pixels} px differ`);
  }
} finally {
  await browser.close();
  server.close();
}

if (failed > 0) {
  console.log(`\n${failed} scene(s) failed — actual and diff images in e2e/visual/.out/${process.platform}/`);
  process.exit(1);
}
console.log(`\nall ${names.length} scene(s) match`);
