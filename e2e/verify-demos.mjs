/**
 * M0/M1 smoke verification: loads every demo page headlessly, waits for the map,
 * exercises a few key interactions, and writes screenshots to e2e/shots/.
 * Run with the dev server up:  node e2e/verify-demos.mjs [demo-id …]
 * (Will grow into the Playwright test suite in M1.)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.MAP0_BASE_URL ?? "http://localhost:5173";
mkdirSync(new URL("./shots", import.meta.url), { recursive: true });
const shot = (name) =>
  new URL(`./shots/${name}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** every demo page; `standalone` needs `pnpm demo:standalone` first */
const DEMOS = [
  "wms",
  "wmts",
  "vector-tiles",
  "geojson",
  "popups",
  "legend",
  "coordinates",
  "print",
  "add-layer",
  "permalink",
  "globe",
  "minimal",
  "theming",
  "i18n",
  "extends",
  "standalone",
];

const only = process.argv.slice(2);
const targets = only.length > 0 ? DEMOS.filter((d) => only.includes(d)) : DEMOS;

/* prefer a system browser (hardware GL) — the bundled headless shell software-renders WebGL,
   which is too slow for a 780-layer vector style */
async function launchBrowser() {
  for (const opts of [{ channel: "chrome" }, { channel: "msedge" }, {}]) {
    try {
      return await chromium.launch(opts);
    } catch {
      /* try next */
    }
  }
  throw new Error("no browser available");
}

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1.5,
});

const summary = [];
const record = (name, ok, detail) => summary.push({ name, ok, ...(detail ? { detail } : {}) });

/** noise we knowingly accept: the demo services themselves are broken here */
const IGNORED_CONSOLE = {
  /* basemap.at advertises four DNS-dead mirror hosts; probing them is the point */
  wmts: [/ERR_NAME_NOT_RESOLVED/],
};

async function openDemo(id) {
  const page = await context.newPage();
  const messages = [];
  const ignore = IGNORED_CONSOLE[id] ?? [];
  page.on("console", (m) => {
    const text = m.text();
    if (
      (m.type() === "warning" || m.type() === "error") &&
      !text.includes("Lit is in dev mode") &&
      !ignore.some((re) => re.test(text))
    ) {
      messages.push(`${m.type()}: ${text.slice(0, 200)}`);
    }
  });
  page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 200)}`));
  await page.goto(`${BASE}/demos/${id}.html`, { waitUntil: "domcontentloaded" });

  /* the loading veil lifts once the style is in and layers are mounted */
  const ready = await page
    .waitForFunction(
      () => {
        const v = document.querySelector("map0-viewer");
        if (!v?.api?.map) return false;
        const veilGone = !v.shadowRoot?.querySelector(".loading:not([data-done])");
        const mounted =
          v.api.config.layers.length === 0 || v.api.layers.state.value.length > 0;
        return veilGone && mounted;
      },
      { timeout: 45_000 },
    )
    .then(() => true)
    .catch(() => false);

  await page
    .waitForFunction(() => document.querySelector("map0-viewer")?.api?.map.isStyleLoaded() === true, {
      timeout: 60_000,
    })
    .catch(() => {});
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const m = document.querySelector("map0-viewer")?.api?.map;
          if (!m) return resolve("no-map");
          const done = () => resolve("idle");
          m.once("idle", done);
          setTimeout(done, 20_000);
        }),
    )
    .catch(() => {});
  await page.waitForTimeout(400);

  /* the page chrome is rendered by demo.ts — a broken shell must fail loudly too */
  const chrome = await page.evaluate(() => ({
    code: document.querySelectorAll("figure.code pre").length,
    pager: !!document.querySelector(".pager"),
  }));
  record(id, ready && chrome.code > 0 && chrome.pager, `code blocks: ${chrome.code}`);
  if (messages.length > 0) record(`${id} · console`, false, messages.slice(0, 3).join(" | "));
  return page;
}

/* ---- every demo renders ---- */
for (const id of targets) {
  const page = await openDemo(id);
  await page.screenshot({ path: shot(`demo-${id}`), fullPage: false });
  await page.close();
}

/* ---- deeper checks on representative demos ---- */
if (targets.includes("wms")) {
  const page = await openDemo("wms");
  await page.mouse.click(640, 420);
  const popup = await page
    .locator(".maplibregl-popup")
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record("wms · GetFeatureInfo popup", popup);
  if (popup) await page.screenshot({ path: shot("wms-featureinfo") });

  await page.getByRole("radio", { name: "basemap.at" }).click();
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const m = document.querySelector("map0-viewer").api.map;
          m.once("idle", () => resolve("idle"));
          setTimeout(resolve, 12_000);
        }),
    )
    .catch(() => {});
  record(
    "wms · overlay survives basemap switch",
    await page.evaluate(() => !!document.querySelector("map0-viewer").api.map.getLayer("m0l-widmung")),
  );
  await page.close();
}

if (targets.includes("wmts")) {
  const page = await openDemo("wmts");
  record(
    "wmts · resolved to a live tile host",
    await page.evaluate(() => {
      const src = document.querySelector("map0-viewer").api.map.getStyle().sources["m0s-beschriftung"];
      return typeof src?.tiles?.[0] === "string" && !src.tiles[0].includes("maps1.wien.gv.at");
    }),
  );
  await page.close();
}

if (targets.includes("vector-tiles")) {
  const page = await openDemo("vector-tiles");
  record(
    "vector-tiles · TileJSON inlined to absolute templates",
    await page.evaluate(() => {
      const src = document.querySelector("map0-viewer").api.map.getStyle().sources["m0s-buildings"];
      return src?.tiles?.[0]?.startsWith("https://") === true;
    }),
  );
  await page.close();
}

if (targets.includes("coordinates")) {
  const page = await openDemo("coordinates");
  await page.mouse.click(640, 420, { button: "right" });
  const rows = await page
    .locator(".m0-coords tr")
    .count()
    .catch(() => 0);
  record("coordinates · four CRS rows", rows === 4, `rows: ${rows}`);
  await page.close();
}

if (targets.includes("extends")) {
  const page = await openDemo("extends");
  record(
    "extends · inherits basemaps, overrides theme",
    await page.evaluate(() => {
      const cfg = document.querySelector("map0-viewer").api.config;
      return cfg.basemaps.length === 3 && cfg.theme.primary === "#b45309" && cfg.theme.radius === "md";
    }),
  );
  await page.close();
}

await browser.close();

const failed = summary.filter((s) => !s.ok);
console.log(JSON.stringify(summary, null, 1));
console.log(`\n${summary.length - failed.length}/${summary.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
