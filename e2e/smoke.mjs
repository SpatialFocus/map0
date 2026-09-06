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
    properties: { label: `${title} square` },
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
  permalink: true,
  /* C5: a key from a hypothetical newer map0 — must warn, must not refuse */
  futureKey: { something: true },
};

/** served at /data/vienna.geojson — what the add-layer dialog's GeoJSON kind fetches */
const VIENNA_GEOJSON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "Stephansdom" }, geometry: { type: "Point", coordinates: [16.3738, 48.2085] } },
    { type: "Feature", properties: { name: "Rathaus" }, geometry: { type: "Point", coordinates: [16.3573, 48.2108] } },
  ],
};

/** served at /config.json for the `config-src` path */
const SRC_CONFIG = {
  version: 1,
  map: { center: [0, 0], zoom: 3 },
  basemaps: [{ type: "empty", title: "None" }],
  layers: [square("#00ff00", "from-src", "From src")],
  controls: { layerSwitcher: { allowAdd: false } },
};

const INVALID_CONFIG = { version: 1, basemaps: [{ type: "wms", url: "https://e.org/x" }] };

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>map0 smoke</title>
<style>
  html, body { margin: 0; height: 100%; background: #fff; }
  #host { width: 640px; height: 400px; }
  body.mobile #host { width: 100vw; height: 100vh; }
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
  window.__config = ${JSON.stringify(CONFIG)};
  const params = new URLSearchParams(location.search);
  if (params.get("mobile")) document.body.classList.add("mobile");
  const el = document.querySelector("map0-viewer");
  for (const type of ["map0:ready", "map0:error"]) {
    el.addEventListener(type, (e) => window.__events.push({ type, detail: e.detail?.message ?? null }));
  }
  if (params.get("src")) el.setAttribute("config-src", "/config.json");
  else el.config = params.get("invalid") ? ${JSON.stringify(INVALID_CONFIG)} : window.__config;
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
  if (path === "/config.json") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(SRC_CONFIG));
  }
  if (path === "/data/vienna.geojson") {
    res.writeHead(200, { "content-type": "application/geo+json" });
    return res.end(JSON.stringify(VIENNA_GEOJSON));
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

/* ------------------------------------------------------------ SSR (no browser) */

/* The package must be importable where there is no DOM: bundlers and frameworks
   evaluate it during prerendering long before anything renders. The browser
   entry cannot be — it declares a custom element — which is why there are two. */
const ssr = await import(new URL("./map0-ssr.js", DIST).href).catch((e) => e);
check(
  "the SSR entry imports in Node",
  !(ssr instanceof Error),
  ssr instanceof Error ? ssr.message : "",
);
if (!(ssr instanceof Error)) {
  check("it knows there is no DOM instead of throwing", ssr.canDefineElements() === false);
  check("defineMap0Viewer() is a no-op on the server", (await ssr.defineMap0Viewer()) === false);
  check(
    "and the config schema works there",
    ssr.validateConfig(CONFIG).valid === true && ssr.validateConfig({}).valid === false,
  );
}
const pkg = JSON.parse(
  await readFile(new URL("../packages/map0/package.json", import.meta.url), "utf8"),
);
const dot = pkg.exports?.["."] ?? {};
const ssrExport = pkg.exports?.["./ssr"] ?? {};
check(
  'the npm package resolves "node" to the SSR entry',
  dot.node?.default === "./dist/map0-ssr.js" && ssrExport.default === "./dist/map0-ssr.js",
  JSON.stringify(dot),
);
/* TypeScript takes the first condition that matches, so "types" has to come first
   in every branch — listed after "default" it is never reached (N11) */
check(
  "every export lists its declarations first",
  [dot.node, dot.default, ssrExport].every(
    (c) => Object.keys(c ?? {})[0] === "types" && String(c.types).endsWith(".d.ts"),
  ) && pkg.types === dot.default?.types,
  JSON.stringify({ node: dot.node, default: dot.default, ssr: ssrExport, types: pkg.types }),
);

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 800, height: 600 } });

/** console noise is a failure here: this page talks to nothing */
function watchConsole(page, sink, warnings) {
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" && !text.includes("Lit is in dev mode")) sink.push(text.slice(0, 200));
    if (m.type() === "warning" && warnings) warnings.push(text.slice(0, 200));
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
  const warnings = [];
  const page = await context.newPage();
  watchConsole(page, noise, warnings);
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

    /* F5.1 — a click on the map answers with an anchored popup at this width */
    await page.mouse.click(320, 200);
    const popup = await page
      .waitForFunction(
        () => {
          const sr = document.querySelector("map0-viewer").shadowRoot;
          const el = sr.querySelector(".maplibregl-popup");
          return el && /Top square/.test(el.textContent) ? { sheet: !!sr.querySelector(".sheet") } : null;
        },
        { timeout: 15_000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    check(
      "a click opens an anchored popup with the feature's attributes (640px wide)",
      popup !== null && popup.sheet === false,
      popup ? JSON.stringify(popup) : "no popup",
    );
    if (popup) {
      await page.evaluate(() =>
        document.querySelector("map0-viewer").shadowRoot.querySelector(".maplibregl-popup-close-button").click(),
      );
      check(
        "closing it clears the selection highlight",
        await page.evaluate(() => {
          const el = document.querySelector("map0-viewer");
          const source = el.api.map.getSource("m0s-highlight");
          return !el.shadowRoot.querySelector(".maplibregl-popup") && source.serialize().data.features.length === 0;
        }),
      );
    }

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

    /* crs — a document in a projected CRS is reprojected to WGS84 before the source gets it */
    const projected = await page.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const id = await el.api.addLayer({
        type: "geojson",
        title: "Projected",
        crs: "EPSG:3857",
        data: { type: "Point", coordinates: [1822000, 6141000] }, // Vienna, in metres
      });
      if (!id) return null;
      const adapter = el.api.layers.all.find((a) => a.def.id === id);
      const coordinates = el.api.map.getSource(adapter.sourceIds[0])?.serialize?.().data?.coordinates;
      return { coordinates, bounds: await adapter.bounds() };
    });
    const lngLat = projected?.coordinates ?? [];
    check(
      "a geojson layer with crs is reprojected to WGS84 on load",
      Math.abs(lngLat[0] - 16.37) < 0.05 && Math.abs(lngLat[1] - 48.25) < 0.05,
      JSON.stringify(projected),
    );

    /* F3.2 — GeoJSON by URL: the same call the dialog's GeoJSON kind makes, then
       zoom-to-layer, which for a URL layer means fetching the file for its bounds */
    const byUrl = await page.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const id = await el.api.addLayer({ type: "geojson", title: "By URL", data: "/data/vienna.geojson" });
      if (!id) return null;
      const zoomed = await el.api.zoomToLayer(id);
      if (el.api.map.isMoving()) await new Promise((r) => el.api.map.once("moveend", r));
      const c = el.api.map.getCenter();
      const row = el.api.layers.state.value.find((l) => l.id === id);
      return { id, zoomed, center: [c.lng, c.lat], title: row?.title, userAdded: row?.userAdded };
    });
    check(
      "a geojson layer added by URL mounts and zooms to its extent",
      byUrl?.zoomed === true &&
        byUrl.userAdded === true &&
        Math.abs(byUrl.center[0] - 16.366) < 0.02 &&
        Math.abs(byUrl.center[1] - 48.21) < 0.02,
      JSON.stringify(byUrl),
    );

    /* F3.2 — files dropped on the viewer: a GeoJSON export in a projected CRS
       (legacy crs member, as QGIS writes it) and a KML track with a line style.
       Dispatched as real DragEvents on the host, which is where the zone listens. */
    const dropped = await page.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const geojson = JSON.stringify({
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::3857" } },
        features: [
          { type: "Feature", properties: { n: 1 }, geometry: { type: "Point", coordinates: [1822000, 6141000] } },
        ],
      });
      const kml =
        '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
        '<Style id="s"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>' +
        '<Placemark><name>Ring</name><styleUrl>#s</styleUrl><LineString><coordinates>' +
        "16.36,48.20,0 16.38,48.21,0</coordinates></LineString></Placemark></Document></kml>";
      const dt = new DataTransfer();
      dt.items.add(new File([geojson], "Vienna 3857.geojson", { type: "application/geo+json" }));
      dt.items.add(new File([kml], "ring.kml", { type: "application/vnd.google-earth.kml+xml" }));
      const fire = (type) =>
        el.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }),
        );
      fire("dragenter");
      const claimed = !fire("dragover"); // preventDefault() → the browser allows the drop
      await el.updateComplete;
      const overlay = !!el.shadowRoot.querySelector(".drop-zone");
      fire("drop");
      const titles = await new Promise((resolve) => {
        const t0 = Date.now();
        const poll = () => {
          const now = el.api.layers.state.value.filter((l) => l.userAdded).map((l) => l.title);
          if ((now.includes("Vienna 3857") && now.includes("ring")) || Date.now() - t0 > 20_000) resolve(now);
          else setTimeout(poll, 50);
        };
        poll();
      });
      await el.updateComplete;
      if (el.api.map.isMoving()) await new Promise((r) => el.api.map.once("moveend", r));
      const adapter = (title) => el.api.layers.all.find((a) => a.def.title === title);
      const pointSource = el.api.map.getSource(adapter("Vienna 3857")?.sourceIds[0])?.serialize?.();
      const c = el.api.map.getCenter();
      return {
        claimed,
        overlay,
        overlayGone: !el.shadowRoot.querySelector(".drop-zone"),
        titles,
        point: pointSource?.data?.features?.[0]?.geometry?.coordinates,
        kmlProps: adapter("ring")?.def.data?.features?.[0]?.properties,
        kmlLineColor: adapter("ring")?.def.style?.["line-color"],
        center: [c.lng, c.lat],
        shareUrl: el.api.getShareUrl(),
      };
    });
    check(
      "a file drag over the viewer is claimed and shows the drop zone, gone after the drop",
      dropped.claimed && dropped.overlay && dropped.overlayGone,
      JSON.stringify({ claimed: dropped.claimed, overlay: dropped.overlay, gone: dropped.overlayGone }),
    );
    check(
      "each dropped file becomes a layer named after it",
      dropped.titles.includes("Vienna 3857") && dropped.titles.includes("ring"),
      dropped.titles.join(", "),
    );
    check(
      "a dropped GeoJSON export with a legacy crs member is reprojected to WGS84",
      Math.abs((dropped.point?.[0] ?? 0) - 16.37) < 0.05 && Math.abs((dropped.point?.[1] ?? 0) - 48.25) < 0.05,
      JSON.stringify(dropped.point),
    );
    check(
      "a dropped KML keeps its name and line style (togeojson chunk loaded from the bundle)",
      dropped.kmlProps?.name === "Ring" &&
        dropped.kmlProps?.stroke === "#ff0000" &&
        JSON.stringify(dropped.kmlLineColor) === JSON.stringify(["coalesce", ["get", "stroke"], "#0e7490"]),
      JSON.stringify({ props: dropped.kmlProps, line: dropped.kmlLineColor }),
    );
    check(
      "the map fits what was dropped",
      Math.abs(dropped.center[0] - 16.37) < 0.05 && Math.abs(dropped.center[1] - 48.22) < 0.05,
      JSON.stringify(dropped.center),
    );
    /* F3.5 — the share link carries the layer added by URL, not the dropped files */
    const shared = (() => {
      const raw = /map0=([^&]+)/.exec(dropped.shareUrl ?? "")?.[1];
      if (!raw) return null;
      const bin = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    })();
    const sharedTitles = (shared?.u ?? []).map((l) => l.title);
    check(
      "the share link carries the URL layer but not the dropped files",
      sharedTitles.includes("By URL") && !sharedTitles.includes("ring") && !sharedTitles.includes("Vienna 3857"),
      sharedTitles.join(", ") || "no user layers in the share state",
    );

    /* F3.2 — the dialog itself, driven like a user would: its GeoJSON kind must
       take a relative URL (the field is type=text on purpose — the browser's own
       url validation would refuse "/data/…" before we ever saw it), report a URL
       the policy refuses in place, and close once the layer is in */
    const viaDialog = await (async () => {
      /* the <map0-add-layer> host has no box of its own (it renders into the
         viewer's shadow tree) — the visible thing is its .dialog */
      await page.locator("map0-viewer .add-btn").click();
      const dialog = page.locator("map0-viewer map0-add-layer .dialog");
      await dialog.waitFor({ state: "visible", timeout: 20_000 });
      await dialog.locator('[role=radio]:has-text("GeoJSON")').click();
      const urlField = dialog.locator("input[inputmode=url]");
      await urlField.fill("ftp://e.org/x.geojson");
      await urlField.press("Enter");
      const refused = (await dialog.locator(".dialog-error").textContent({ timeout: 5_000 })).trim();
      await urlField.fill("/data/vienna.geojson");
      await urlField.press("Enter");
      const outcome = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const el = document.querySelector("map0-viewer");
            const t0 = Date.now();
            const poll = () => {
              const row = el.api.layers.state.value.find((l) => l.title === "vienna");
              const open = !!el.shadowRoot.querySelector("map0-add-layer");
              if ((row && !open) || Date.now() - t0 > 20_000) {
                resolve({ added: !!row, closed: !open, userAdded: row?.userAdded ?? null });
              } else setTimeout(poll, 50);
            };
            poll();
          }),
      );
      return { refused, ...outcome };
    })().catch((e) => ({ refused: "", added: false, closed: false, error: String(e).slice(0, 200) }));
    check(
      "the dialog refuses a URL the config policy refuses, in place",
      /unsupported URL scheme "ftp:"/.test(viaDialog.refused),
      viaDialog.refused || viaDialog.error || "no error shown",
    );
    check(
      "the dialog's GeoJSON kind adds a relative URL as a layer named after the file, then closes",
      viaDialog.added && viaDialog.closed && viaDialog.userAdded === true,
      JSON.stringify(viaDialog),
    );

    /* R2 — remove from the DOM and put it back: the element must come back alive */
    const reconnected = await page.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const host = document.getElementById("host");
      /* the F3.2 checks left share state in the hash; a reconnect would restore the
         URL-added layer from it (correctly) and this check counts configured layers */
      history.replaceState(null, "", location.pathname + location.search);
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

    /* R12 — the nastier variant: removed while a reload was already scheduled,
       so the re-init lands on a detached element. It must stay armable. */
    const racedReload = await page.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const host = document.getElementById("host");
      el.reload(); // tears down now, re-inits after the next update…
      el.remove(); // …which happens with the element out of the DOM
      await new Promise((r) => setTimeout(r, 100));
      const alive = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 30_000);
        el.addEventListener("map0:ready", () => (clearTimeout(timer), resolve(true)), { once: true });
      });
      host.appendChild(el);
      return { alive: await alive, layers: el.api?.layers.state.value.length ?? 0 };
    });
    check(
      "a disconnect during a reload leaves the element armable",
      racedReload.alive && racedReload.layers === 2,
      `${racedReload.layers} layers`,
    );
  }

  /* C5 — the config carries a key this version does not know */
  check(
    "an unknown config key warns and the map opens anyway",
    isReady && warnings.some((w) => w.includes("unknown key") && w.includes("futureKey")),
    warnings.filter((w) => w.includes("unknown key")).join(" | ") || "no warning logged",
  );

  check("no console errors on the happy path", noise.length === 0, noise.join(" | "));

  /* ------------------------------------------- a higher-priority config source */
  const srcNoise = [];
  const srcPage = await context.newPage();
  watchConsole(srcPage, srcNoise);
  await srcPage.goto(`${BASE}/smoke.html?src=1`, { waitUntil: "domcontentloaded" });
  const srcReady = await ready(srcPage)
    .then(() => true)
    .catch(() => false);
  check("a viewer starts from config-src", srcReady);
  if (srcReady) {
    /* F3.2 — allowAdd: false gates the drop zone like the dialog: no overlay, no claim, no layer */
    const ignored = await srcPage.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const before = el.api.layers.state.value.length;
      const dt = new DataTransfer();
      dt.items.add(new File(['{"type":"Point","coordinates":[16,48]}'], "x.geojson"));
      const fire = (type) =>
        el.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }),
        );
      fire("dragenter");
      const claimed = !fire("dragover");
      await el.updateComplete;
      const overlay = !!el.shadowRoot.querySelector(".drop-zone");
      fire("drop");
      await new Promise((r) => setTimeout(r, 500));
      return { claimed, overlay, added: el.api.layers.state.value.length - before };
    });
    check(
      "a viewer with allowAdd: false ignores dropped files",
      !ignored.claimed && !ignored.overlay && ignored.added === 0,
      JSON.stringify(ignored),
    );
  }
  if (srcReady) {
    const swapped = await srcPage.evaluate(async () => {
      const el = document.querySelector("map0-viewer");
      const before = el.api.config.layers.map((l) => l.id);
      const ready = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 30_000);
        el.addEventListener("map0:ready", () => (clearTimeout(timer), resolve(true)), { once: true });
      });
      el.config = window.__config; // first time this property is set: still a change
      return { before, reloaded: await ready, after: el.api?.config.layers.map((l) => l.id) ?? [] };
    });
    check(
      "assigning `config` over it reloads the map",
      swapped.reloaded && JSON.stringify(swapped.after) === JSON.stringify(["top", "bottom"]),
      `${swapped.before.join(",")} → ${swapped.after.join(",")}`,
    );
  }
  check("no console errors when the config source changes", srcNoise.length === 0, srcNoise.join(" | "));

  /* ---------------------------------------- phone: feature info as a bottom sheet */
  const phone = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  const phoneNoise = [];
  const phonePage = await phone.newPage();
  watchConsole(phonePage, phoneNoise);
  await phonePage.goto(`${BASE}/smoke.html?mobile=1`, { waitUntil: "domcontentloaded" });
  const phoneReady = await ready(phonePage)
    .then(() => true)
    .catch(() => false);
  check("the viewer starts in a 375px wide host", phoneReady);
  if (phoneReady) {
    /** the sheet, as the tests need to see it; null while there is none */
    const sheetState = () =>
      phonePage.evaluate(() => {
        const el = document.querySelector("map0-viewer");
        const sr = el.shadowRoot;
        const sheet = sr.querySelector(".sheet");
        if (!sheet) return null;
        const host = el.getBoundingClientRect();
        const box = sheet.getBoundingClientRect();
        return {
          role: sheet.getAttribute("role"),
          label: sheet.getAttribute("aria-label"),
          text: sheet.textContent.replace(/\s+/g, " ").trim(),
          expanded: sheet.hasAttribute("data-expanded"),
          share: box.height / host.height,
          bottom: Math.round(host.bottom - box.bottom),
          popup: !!sr.querySelector(".maplibregl-popup"),
          focusInside: sheet.contains(sr.activeElement),
        };
      });
    /** sheet present (and done sliding in) or gone */
    const waitForSheet = (present) =>
      phonePage
        .waitForFunction(
          (want) => {
            const sheet = document.querySelector("map0-viewer").shadowRoot.querySelector(".sheet");
            return want ? !!sheet && sheet.getAnimations().length === 0 : !sheet;
          },
          present,
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false);

    /* both squares must be on screen before the tap — the hit test is what is being asked */
    await phonePage.evaluate(async () => {
      const api = document.querySelector("map0-viewer").api;
      await new Promise((r) => (api.map.loaded() ? r() : api.map.once("idle", r)));
    });
    await phonePage.touchscreen.tap(187, 406);
    const sheet = (await waitForSheet(true)) ? await sheetState() : null;
    /* on failure, say what the page did instead */
    const why = sheet
      ? ""
      : JSON.stringify(
          await phonePage.evaluate(() => {
            const el = document.querySelector("map0-viewer");
            const point = el.api.map.project([0, 0]);
            return {
              hostWidth: el.getBoundingClientRect().width,
              narrow: el._narrow,
              popup: !!el.shadowRoot.querySelector(".maplibregl-popup"),
              hits: el.api.map.queryRenderedFeatures(point).length,
              centre: [Math.round(point.x), Math.round(point.y)],
            };
          }),
        );
    check("a tap opens a bottom sheet instead of a popup (F5.5)", sheet !== null && sheet.popup === false, why);
    if (sheet) {
      check(
        "it is a dialog named after the layers, showing the same feature attributes",
        sheet.role === "dialog" &&
          sheet.label === "Top, Bottom" &&
          /Top square/.test(sheet.text) &&
          /Bottom square/.test(sheet.text),
        `role=${sheet.role} label=${sheet.label}`,
      );
      check(
        "docked at the bottom, leaving most of the map free",
        sheet.bottom === 0 && sheet.share > 0.3 && sheet.share < 0.6 && !sheet.expanded,
        `${Math.round(sheet.share * 100)}% of the map, ${sheet.bottom}px from the bottom`,
      );
      check("focus moved into the sheet", sheet.focusInside);

      /* the handle grows it, the map above stays visible */
      const handle = await phonePage
        .locator(".sheet-handle")
        .boundingBox()
        .catch(() => null);
      let expanded = null;
      if (handle) {
        await phonePage.touchscreen.tap(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await phonePage.waitForTimeout(400);
        expanded = await sheetState();
      }
      check(
        "tapping the handle expands it to about 90%",
        expanded?.expanded === true && expanded.share > 0.8 && expanded.share < 0.95,
        expanded ? `${Math.round(expanded.share * 100)}%` : "no handle",
      );
      check(
        "its touch targets are at least 44px",
        handle !== null && handle.height >= 44,
        handle ? `handle ${Math.round(handle.height)}px` : "",
      );

      await phonePage.keyboard.press("Escape");
      const closed = await waitForSheet(false);
      const after = closed
        ? await phonePage.evaluate(() => {
            const el = document.querySelector("map0-viewer");
            return {
              highlight: el.api.map.getSource("m0s-highlight").serialize().data.features.length,
              focusOnMap: el.shadowRoot.activeElement === el.api.map.getCanvas(),
            };
          })
        : null;
      check(
        "Escape closes it, clears the highlight and returns focus to the map",
        closed && after.highlight === 0 && after.focusOnMap,
        after ? JSON.stringify(after) : "sheet still open",
      );

      /* a tap on empty map (the squares are ~57px wide at z3) puts the next one away */
      await phonePage.touchscreen.tap(187, 406);
      const reopened = await waitForSheet(true);
      await phonePage.touchscreen.tap(340, 406);
      check("a tap beside the features closes the sheet", reopened && (await waitForSheet(false)));
    }
  }
  check("no console errors on the phone", phoneNoise.length === 0, phoneNoise.join(" | "));
  await phone.close();

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
