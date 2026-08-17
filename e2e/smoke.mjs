/**
 * Deterministic browser smoke test — runs in CI against the BUILT bundle.
 *
 * Everything here is network-free (an `empty` basemap plus inline GeoJSON), so
 * it can fail only because map0 is broken, never because a service is down.
 * It covers what unit tests structurally cannot: the custom-element lifecycle,
 * the shadow DOM, and the built file layout (several of this repo's worst bugs
 * existed only in the bundle — see docs/09-engineering-notes.md §4.3, §4.4).
 *
 *   pnpm build && node e2e/smoke.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const DIST = new URL("../packages/ui/dist/", import.meta.url);

/* two opaque fills over the same extent: whichever is on top owns the centre
   pixel, which is the requirement (F2.1) expressed as something a browser can
   answer. "top" is first in the list, so it must win. */
const square = (color, id, title) => ({
  type: "geojson",
  id,
  title,
  data: {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
          [-10, -10],
        ],
      ],
    },
  },
  style: [{ type: "fill", paint: { "fill-color": color, "fill-opacity": 1 } }],
});

const CONFIG = {
  version: 1,
  map: { center: [0, 0], zoom: 3 },
  basemaps: [{ type: "empty", title: "None" }],
  layers: [square("#ff0000", "top", "Top"), square("#0000ff", "bottom", "Bottom")],
};

const INVALID_CONFIG = { version: 1, basemaps: [{ type: "wms", url: "https://e.org/x" }] };

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>map0 smoke</title>
<style>
  html, body { margin: 0; height: 100%; background: #fff; }
  #host { width: 640px; height: 400px; }
  map0-viewer { display: block; width: 100%; height: 100%; }
</style></head>
<body>
<div id="host"><map0-viewer loading="eager"></map0-viewer></div>
<script type="module">
  import "/map0.js";
</script>
<script>
  /* the property is assigned BEFORE the module finishes loading on purpose:
     an upgraded element has to pick up pre-upgrade properties */
  window.__events = [];
  const params = new URLSearchParams(location.search);
  const el = document.querySelector("map0-viewer");
  for (const type of ["map0:ready", "map0:error"]) {
    el.addEventListener(type, (e) => window.__events.push({ type, detail: e.detail?.message ?? null }));
  }
  el.config = params.get("invalid") ? ${JSON.stringify(INVALID_CONFIG)} : ${JSON.stringify(CONFIG)};
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
  if (path === "/" || path === "/smoke.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(HTML);
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

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* prefer a system browser locally; CI has the bundled one */
async function launchBrowser() {
  const args = ["--enable-unsafe-swiftshader"]; // headless WebGL2 without a GPU
  for (const opts of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch({ ...opts, args });
    } catch {
      /* try next */
    }
  }
  throw new Error("no browser available — run `npx playwright install chromium`");
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 800, height: 600 } });

/** console noise is a failure here: this page talks to nothing */
function watchConsole(page, sink) {
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" && !text.includes("Lit is in dev mode")) sink.push(text.slice(0, 200));
  });
  page.on("pageerror", (e) => sink.push(`pageerror: ${String(e).slice(0, 200)}`));
}

const ready = (page) =>
  page.waitForFunction(
    () => {
      const el = document.querySelector("map0-viewer");
      return (
        window.__events.some((e) => e.type === "map0:ready") &&
        !!el?.api?.map &&
        el.api.layers.state.value.length > 0
      );
    },
    { timeout: 60_000 },
  );

try {
  /* ---------------------------------------------------------------- happy path */
  const noise = [];
  const page = await context.newPage();
  watchConsole(page, noise);
  await page.goto(`${BASE}/smoke.html`, { waitUntil: "domcontentloaded" });

  check(
    "element registers from the built bundle",
    await page
      .waitForFunction(() => !!customElements.get("map0-viewer"), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false),
  );

  const isReady = await ready(page)
    .then(() => true)
    .catch(() => false);
  check("map0:ready fires and layers mount", isReady);

  if (isReady) {
    /* R1 — the config order is the z-order, top of the list on top of the map */
    const order = await page.evaluate(() => {
      const api = document.querySelector("map0-viewer").api;
      const style = api.map.getStyle().layers.map((l) => l.id);
      const at = (id) =>
        Math.min(...api.layers.all.find((a) => a.def.id === id).layerIds.map((l) => style.indexOf(l)));
      return {
        state: api.layers.state.value.map((l) => l.id),
        top: at("top"),
        bottom: at("bottom"),
      };
    });
    check(
      "layer state is emitted top-most first",
      JSON.stringify(order.state) === JSON.stringify(["top", "bottom"]),
      order.state.join(" → "),
    );
    check(
      "first configured layer is drawn last (on top)",
      order.top > order.bottom && order.bottom >= 0,
      `top@${order.top} bottom@${order.bottom}`,
    );

    /* the same question asked of MapLibre's render tree: hits come back
       top-most first, so the first one at the centre must be the top layer */
    const hits = await page.evaluate(async () => {
      const api = document.querySelector("map0-viewer").api;
      await new Promise((r) => (api.map.loaded() ? r() : api.map.once("idle", r)));
      const point = api.map.project([0, 0]);
      return api.map.queryRenderedFeatures(point).map((f) => f.layer.id);
    });
    const owner = (mapLayerId) => (mapLayerId.includes("bottom") ? "bottom" : "top");
    check(
      "the top layer wins the hit test at the map centre",
      hits.length > 0 && owner(hits[0]) === "top",
      hits.join(", ") || "no features rendered",
    );

    /* R1 — a layer added at runtime goes on top of the map, and heads the panel */
    const added = await page.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const id = await el.api.addLayer({
        type: "geojson",
        title: "Added",
        data: { type: "Point", coordinates: [0, 0] },
        style: [{ type: "circle", paint: { "circle-color": "#00ff00", "circle-radius": 8 } }],
      });
      await el.updateComplete;
      const style = el.api.map.getStyle().layers.map((l) => l.id);
      const indices = (layerId) =>
        el.api.layers.all.find((a) => a.def.id === layerId).layerIds.map((l) => style.indexOf(l));
      return {
        id,
        first: el.api.layers.state.value[0]?.id,
        onTop: Math.min(...indices(id)) > Math.max(...indices("top"), ...indices("bottom")),
        tocFirst: el.shadowRoot.querySelector(".layer-title")?.textContent.trim(),
      };
    });
    check("a runtime-added layer is mounted above the configured tree", added.onTop === true);
    check(
      "and heads both the layer state and the panel",
      added.first === added.id && added.tocFirst === "Added",
      `state[0]=${added.first}, panel[0]=${added.tocFirst}`,
    );

    /* R2 — remove from the DOM and put it back: the element must come back alive */
    const reconnected = await page.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const host = document.getElementById("host");
      el.remove();
      const tornDown = el.api === undefined;
      window.__events.length = 0;
      host.appendChild(el);
      const alive = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 30_000);
        el.addEventListener(
          "map0:ready",
          () => {
            clearTimeout(timer);
            resolve(true);
          },
          { once: true },
        );
      });
      return { tornDown, alive, layers: el.api?.layers.state.value.length ?? 0 };
    });
    check("disconnect tears the core down", reconnected.tornDown);
    check(
      "reconnect re-initializes the viewer",
      reconnected.alive && reconnected.layers === 2,
      `${reconnected.layers} layers`,
    );
  }

  check("no console errors on the happy path", noise.length === 0, noise.join(" | "));

  /* ------------------------------------------------------------ invalid config */
  const errNoise = [];
  const errPage = await context.newPage();
  watchConsole(errPage, errNoise);
  await errPage.goto(`${BASE}/smoke.html?invalid=1`, { waitUntil: "domcontentloaded" });
  const panel = await errPage
    .waitForFunction(
      () =>
        !!document.querySelector("map0-viewer")?.shadowRoot?.querySelector(".error-panel") &&
        window.__events.some((e) => e.type === "map0:error"),
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);
  check("an invalid config renders the error panel and emits map0:error", panel);
  check("no console errors on the error path", errNoise.length === 0, errNoise.join(" | "));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.error(`smoke test failed: ${failed.map((f) => f.name).join(", ")}`);
  process.exitCode = 1;
}
