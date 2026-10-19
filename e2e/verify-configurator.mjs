/**
 * Smoke check for the configurator page: opens /configurator/ with a config
 * carried in the URL, drives the element through its public surface (the
 * same methods the forms call) and asserts on the config it produces —
 * data-driven styling from the preview's features, a drag-and-drop move,
 * the JSON export, undo — then the German page. Same-origin data only
 * (an empty basemap and /data/demo-areas.geojson), so a failure is ours.
 *
 * Run with the dev server up:  node e2e/verify-configurator.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.MAP0_BASE_URL ?? "http://localhost:5173";
mkdirSync(new URL("./shots", import.meta.url), { recursive: true });
const shot = (name) =>
  new URL(`./shots/${name}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const CONFIG = {
  version: 1,
  map: { center: [16.37, 48.21], zoom: 11 },
  basemaps: [{ type: "empty", title: "None" }],
  layers: [{ type: "geojson", title: "Areas", data: "/data/demo-areas.geojson" }],
};

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

const summary = [];
const record = (name, ok, detail) => summary.push({ name, ok, ...(detail ? { detail } : {}) });

function watchConsole(page) {
  const messages = [];
  page.on("console", (m) => {
    const text = m.text();
    if (
      (m.type() === "warning" || m.type() === "error") &&
      !text.includes("Lit is in dev mode") &&
      !/GL Driver Message/.test(text) &&
      /* dev-build-only Lit note: the viewer reloads from its own updated() hook whenever
         its config is reassigned — every apply here does that; not a configurator defect */
      !/Element map0-viewer scheduled an update/.test(text)
    )
      messages.push(`${m.type()}: ${text.slice(0, 200)}`);
  });
  page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 200)}`));
  return messages;
}

/** the element with its preview up and the sample layer mounted */
async function openConfigurator(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  return page
    .waitForFunction(
      () => {
        const c = document.querySelector("map0-configurator");
        const api = c?.shadowRoot?.querySelector("map0-viewer")?.api;
        return !!api && c.previewReady === true && api.layers.all.length > 0 && api.layers.all[0].status.value === "ready";
      },
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
}

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const messages = watchConsole(page);

const ready = await openConfigurator(page, `/configurator/?c=${encodeURIComponent(JSON.stringify(CONFIG))}`);
record("configurator · loads with ?c= config and the preview mounts the layer", ready);

if (ready) {
  const result = await page.evaluate(async () => {
    const c = document.querySelector("map0-configurator");
    const sr = c.shadowRoot;
    const out = {};
    out.sections = [...sr.querySelectorAll(".sections button")].length;
    out.status = sr.querySelector(".status")?.textContent?.trim();
    out.linkedUrlCleaned = !location.search.includes("c=");

    /* data-driven style from the features the preview holds */
    c.section = "layers";
    c.selectLayer([0]);
    await c.updateComplete;
    const sample = c.sampleFeatures([0]);
    out.sampleCount = sample?.length ?? null;
    const select = [...sr.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "name"));
    out.attributeSelect = !!select;
    if (select) {
      select.value = "name";
      select.dispatchEvent(new Event("change"));
      await c.updateComplete;
    }
    const styled = c.cfg.layers[0];
    out.styleLayers = Array.isArray(styled.style) ? styled.style.map((l) => l.type) : null;
    out.legendEntries = Array.isArray(styled.legend) ? styled.legend.length : null;

    /* drag-and-drop: a new group at the top, then the layer dropped into it */
    c.addGroup();
    c.setDrag({ from: [1], over: null, position: null });
    c.dropLayer([0], 0);
    out.tree = c.cfg.layers.map((l) => (l.type === "group" ? `group(${l.children.map((x) => x.title).join(",")})` : l.title));
    out.selectedAfterDrop = c.selectedPath;

    /* export: the JSON the user copies */
    c.section = "export";
    await c.updateComplete;
    const json = sr.querySelector("textarea").value;
    out.jsonKeys = Object.keys(JSON.parse(json));
    out.jsonHasGroup = json.includes('"type": "group"');

    /* undo walks back through the edits */
    const before = c.cfg.layers.length;
    c.undo();
    c.undo();
    out.undo = { before, after: c.cfg.layers.length, styleAfterUndo: Array.isArray(c.cfg.layers[0]?.style) };
    return out;
  });

  record("configurator · eight sections, preview status shown", result.sections === 8 && /Preview shows/.test(result.status ?? ""), result.status);
  record("configurator · linked ?c= config removed from the URL", result.linkedUrlCleaned);
  record("configurator · features sampled from the preview", (result.sampleCount ?? 0) > 0, `features: ${result.sampleCount}`);
  record(
    "configurator · colour by attribute yields style layers and a legend",
    result.attributeSelect && Array.isArray(result.styleLayers) && result.styleLayers.includes("fill") && (result.legendEntries ?? 0) > 0,
    `layers: ${result.styleLayers?.join(",")} · legend: ${result.legendEntries}`,
  );
  record(
    "configurator · drop moves the layer into the new group",
    result.tree?.[0] === "group(Areas)" && result.selectedAfterDrop?.join(",") === "0,0",
    result.tree?.join(" | "),
  );
  record("configurator · export JSON starts with $schema and carries the tree", result.jsonKeys?.[0] === "$schema" && result.jsonHasGroup);
  record("configurator · undo reverts group and drop", result.undo?.after === 1 && result.undo?.styleAfterUndo === true, JSON.stringify(result.undo));

  /* the preview must have caught up with the last valid config */
  const applied = await page
    .waitForFunction(() => /Preview shows/.test(document.querySelector("map0-configurator").shadowRoot.querySelector(".status")?.textContent ?? ""), { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  record("configurator · preview re-applies after edits", applied);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("configurator"), fullPage: false });
}

if (messages.length > 0) record("configurator · console", false, messages.slice(0, 3).join(" | "));

/* the German twin: same element, German strings */
const dePage = await context.newPage();
const deMessages = watchConsole(dePage);
const deReady = await openConfigurator(dePage, `/de/configurator/?c=${encodeURIComponent(JSON.stringify(CONFIG))}`);
const de = deReady
  ? await dePage.evaluate(() => {
      const c = document.querySelector("map0-configurator");
      return {
        lang: c.getAttribute("lang"),
        firstNav: c.shadowRoot.querySelector(".sections button")?.textContent?.trim().split("\n")[0],
        h1: document.querySelector("h1")?.textContent?.trim(),
      };
    })
  : null;
record("configurator · German page speaks German", de?.lang === "de" && de?.firstNav === "Allgemein" && de?.h1 === "Konfigurator", JSON.stringify(de));
if (deMessages.length > 0) record("configurator/de · console", false, deMessages.slice(0, 3).join(" | "));

await browser.close();

let failed = 0;
for (const { name, ok, detail } of summary) {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? `  — ${detail}` : ""}`);
}
console.log(`\n${summary.length - failed}/${summary.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
