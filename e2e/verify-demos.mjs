/**
 * M0 smoke verification: loads every demo page headlessly, waits for the map,
 * exercises key interactions, and writes screenshots to e2e/shots/.
 * Run with the dev server up:  node e2e/verify-demos.mjs
 * (Will grow into the Playwright test suite in M1.)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.MAP0_BASE_URL ?? "http://localhost:5173";
mkdirSync(new URL("./shots", import.meta.url), { recursive: true });
const shot = (name) => new URL(`./shots/${name}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

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
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1.5,
});

const summary = [];

async function openDemo(path, name) {
  const page = await context.newPage();
  const messages = [];
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") {
      messages.push(`${m.type()}: ${m.text().slice(0, 220)}`);
    }
  });
  page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 220)}`));
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });

  const ready = await page
    .waitForFunction(
      () => {
        const v = document.querySelector("map0-viewer");
        if (!v?.api?.map) return false;
        const veilGone = !v.shadowRoot?.querySelector(".loading:not([data-done])");
        const layersMounted = v.api.config.layers.length === 0 || v.api.layers.state.value.length > 0;
        return veilGone && layersMounted;
      },
      { timeout: 45_000 },
    )
    .then(() => true)
    .catch(() => false);

  /* let the style and overlay sources actually finish */
  await page
    .waitForFunction(
      () => document.querySelector("map0-viewer")?.api?.map.isStyleLoaded() === true,
      { timeout: 60_000 },
    )
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

  summary.push({ name, ready, messages: messages.slice(0, 6) });
  return page;
}

/* ---- vienna: base render, GFI popup, basemap switch ---- */
{
  const page = await openDemo("/vienna.html", "vienna");
  await page.screenshot({ path: shot("01-vienna") });

  /* GetFeatureInfo: ensure the WMS overlay is mounted, then click the map center */
  await page
    .waitForFunction(
      () => !!document.querySelector("map0-viewer")?.api?.map.getLayer("m0l-widmung"),
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.mouse.click(560, 400);
  const popup = page.locator(".maplibregl-popup");
  const gotPopup = await popup
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (gotPopup) await page.screenshot({ path: shot("02-vienna-featureinfo") });
  summary.push({ name: "vienna GFI popup", ready: gotPopup });

  /* basemap switch: overlays must survive (transformStyle) */
  await page.getByRole("radio", { name: "Orthofoto" }).click();
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const m = document.querySelector("map0-viewer").api.map;
          m.once("idle", () => resolve("idle"));
          setTimeout(resolve, 9_000);
        }),
    )
    .catch(() => {});
  const overlayAlive = await page.evaluate(() => {
    const m = document.querySelector("map0-viewer").api.map;
    return !!m.getLayer("m0l-widmung");
  });
  await page.screenshot({ path: shot("03-vienna-ortho-switch") });
  summary.push({ name: "vienna overlay survives basemap switch", ready: overlayAlive });
  await page.close();
}

/* ---- geojson: clusters + local polygons + popup ---- */
{
  const page = await openDemo("/geojson.html", "geojson");
  await page.screenshot({ path: shot("04-geojson") });
  await page.close();
}

/* ---- globe ---- */
{
  const page = await openDemo("/globe.html", "globe");
  await page.screenshot({ path: shot("05-globe") });
  const projection = await page.evaluate(
    () => document.querySelector("map0-viewer").api.map.getProjection()?.type ?? "unknown",
  );
  summary.push({ name: "globe projection active", ready: projection === "globe" });
  await page.close();
}

/* ---- minimal (inline config) ---- */
{
  const page = await openDemo("/minimal.html", "minimal");
  await page.screenshot({ path: shot("06-minimal") });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(summary, null, 2));
