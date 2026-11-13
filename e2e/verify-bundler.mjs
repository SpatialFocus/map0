/**
 * The bundler gate: a host app takes the PACKED TARBALL in through Vite, the way
 * a Vite or Nuxt app does — `import("map0-viewer")`, no dist/ folder copied next
 * to the page, no script tag.
 *
 * What breaks there and nowhere else is MapLibre's worker. MapLibre computes
 * its URL at runtime, which no bundler can follow; once maplibre-gl.mjs sits in
 * one of the host's chunks the worker 404s, raster layers still paint, and
 * vector tiles and GeoJSON never appear. map0 pins the URL in a form bundlers
 * see (packages/core/src/maplibre-worker.ts). So the page draws an inline
 * GeoJSON square on an empty basemap — nothing that needs the network — and a
 * rendered feature is the proof the worker came along. Three runs:
 *
 *   build — `vite build`, served from dist/: the worker is an emitted asset;
 *   dev, pre-bundled — Vite's default: the dep optimizer moves map0 into
 *           .vite/deps and has to carry the worker URL along (Vite 8 does);
 *   dev, excluded — `optimizeDeps.exclude: ["map0-viewer"]`, the fallback the
 *           docs give for dep optimizers that do not: the package as it is.
 *
 * Without the pin, the build and the pre-bundled run fail — checked once by
 * hand with a tarball whose pin was patched out.
 *
 * Usage: node e2e/verify-bundler.mjs [path-to-tgz] [--keep]
 *        (no tgz: packs packages/map0 itself — run `pnpm build:npm` first)
 *        MAP0_VITE=<dir of a vite package> runs it with another Vite
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

/* MAP0_VITE=<path to a vite package> tries another Vite than the workspace's (e.g. the one a Nuxt release ships) */
const { build, createServer, preview } = await import(
  process.env.MAP0_VITE ? pathToFileURL(join(resolve(process.env.MAP0_VITE), "dist", "node", "index.js")).href : "vite"
);

const root = fileURLToPath(new URL("..", import.meta.url));
const PKG = join(root, "packages", "map0");
const win = process.platform === "win32";
const keep = process.argv.includes("--keep");
const tgzArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

const die = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

/* the long path: Windows hands out 8.3 names (CHRIST~1) for the temp folder, and a dev
   server comparing them with the real path refuses to serve its own root (403) */
const work = mkdtempSync(join(realpathSync.native(tmpdir()), "map0-bundler-"));
console.log(`  scratch project: ${work}`);

/* ------------------------------------------------------------- tarball */

let tarball;
if (tgzArg) {
  tarball = resolve(process.cwd(), tgzArg);
  if (!existsSync(tarball)) die(`no such tarball: ${tarball}`);
} else {
  if (!existsSync(join(PKG, "dist", "map0.js"))) die("packages/map0/dist/map0.js missing — run `pnpm build:npm` first");
  const { name, version } = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  const pack = spawnSync("pnpm", ["pack", "--pack-destination", work], { cwd: PKG, shell: win, stdio: "inherit" });
  if (pack.status !== 0) die("pnpm pack failed");
  tarball = join(work, `${name}-${version}.tgz`);
  if (!existsSync(tarball)) die(`pnpm pack did not produce ${tarball}`);
}

/* ------------------------------------------------------- the host app */

const CONFIG = {
  version: 1,
  map: { center: [0, 0], zoom: 3 },
  basemaps: [{ type: "empty", title: "None" }],
  layers: [
    {
      type: "geojson",
      id: "square",
      title: "Square",
      data: {
        type: "Feature",
        properties: { name: "square" },
        geometry: { type: "Polygon", coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]] },
      },
      style: [{ type: "fill", paint: { "fill-color": "#ff0000", "fill-opacity": 1 } }],
    },
  ],
  controls: { layerSwitcher: false, legend: false },
};

writeFileSync(
  join(work, "package.json"),
  JSON.stringify({ name: "map0-bundler-host", private: true, type: "module", dependencies: { "map0-viewer": `file:${tarball}` } }, null, 2),
);
writeFileSync(
  join(work, "index.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>map0 bundler host</title><link rel="icon" href="data:,">
<style>html, body { margin: 0; } #map { width: 640px; height: 400px; }</style></head>
<body><div id="map"></div><script type="module" src="/main.js"></script></body></html>
`,
);
/* the way a client-only component does it: the package is imported when the map mounts */
writeFileSync(
  join(work, "main.js"),
  `const { createMap } = await import("map0-viewer");
const viewer = createMap(document.getElementById("map"), ${JSON.stringify(CONFIG)});
viewer.addEventListener("map0:ready", () => { window.__ready = true; });
viewer.addEventListener("map0:error", (e) => { (window.__errors ??= []).push(e.detail?.message ?? String(e.detail?.errors)); });
window.__viewer = viewer;
`,
);

const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
  cwd: work,
  shell: win,
  stdio: "inherit",
});
if (install.status !== 0) die("npm install of the tarball failed");

/* ------------------------------------------------------------- browser */

async function launch() {
  const args = ["--enable-unsafe-swiftshader"]; // headless WebGL2 without a GPU (CI)
  for (const opts of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch({ ...opts, args });
    } catch {
      /* next */
    }
  }
  throw new Error("no browser available for playwright");
}

/** load the host page and report whether the GeoJSON square was drawn */
async function probe(browser, url) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const problems = [];
  const workers = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
    if (r.url().includes("maplibre-gl-worker")) workers.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    /* idle = every source loaded and drawn; a dead worker never gets there, hence the cap */
    await page.evaluate(
      () =>
        new Promise((done) => {
          const map = window.__viewer.api.map;
          if (map.loaded()) done();
          map.once("idle", done);
          setTimeout(done, 15_000);
        }),
    );
    const drawn = await page.evaluate(() => {
      const api = window.__viewer.api;
      const layer = api.layers.all.find((l) => l.def.id === "square");
      return api.map.queryRenderedFeatures({ layers: [...layer.layerIds] }).length;
    });
    return { drawn, workers, problems };
  } catch (e) {
    return { drawn: 0, workers, problems: [...problems, String(e).split("\n")[0]] };
  } finally {
    await page.close();
  }
}

const checks = [];
const record = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const describe = (r) => [`${r.drawn} features`, ...r.workers.map((w) => `worker ${w}`), ...r.problems.slice(0, 3)].join(" | ");

const hostConfig = { root: work, configFile: false, logLevel: "warn", clearScreen: false };
const browser = await launch();
try {
  /* -- build: the worker has to come out as an emitted asset -- */
  await build({ ...hostConfig, build: { outDir: join(work, "dist"), emptyOutDir: true } });
  const previewServer = await preview({ ...hostConfig, build: { outDir: join(work, "dist") }, preview: { port: 0, host: "127.0.0.1" } });
  try {
    const r = await probe(browser, previewServer.resolvedUrls.local[0]);
    record("vite build: GeoJSON drawn through the bundled worker", r.drawn > 0 && r.problems.length === 0, describe(r));
    /* the hashed name is the proof: a preview server answers a missing file with index.html and a 200 */
    record(
      "vite build: worker emitted as an asset of the host",
      r.workers.some((w) => /^200 \/assets\/maplibre-gl-worker-[\w-]+\.mjs$/.test(w)),
      r.workers.join(", "),
    );
  } finally {
    await previewServer.close();
  }

  /* -- dev, both ways: pre-bundled (Vite's default) and served as it is -- */
  for (const [name, extra] of [
    ["vite dev, pre-bundled", {}],
    ['vite dev, optimizeDeps.exclude: ["map0-viewer"]', { optimizeDeps: { exclude: ["map0-viewer"] } }],
  ]) {
    rmSync(join(work, "node_modules", ".vite"), { recursive: true, force: true });
    const dev = await createServer({ ...hostConfig, ...extra, server: { port: 0, host: "127.0.0.1" } });
    await dev.listen();
    try {
      const r = await probe(browser, dev.resolvedUrls.local[0]);
      record(`${name}: GeoJSON drawn`, r.drawn > 0 && r.problems.length === 0, describe(r));
    } finally {
      await dev.close();
    }
  }
} finally {
  await browser.close();
  if (!keep) rmSync(work, { recursive: true, force: true });
}

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} bundler checks passed`);
if (failed) process.exit(1);
