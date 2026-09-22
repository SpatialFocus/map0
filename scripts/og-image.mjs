/**
 * site/public/og.jpg — the social preview image (Open Graph / Twitter card):
 * a Playwright screenshot of site/og/card.html, a real map with the wordmark
 * over it, 1200×630 CSS px photographed at 2× for crisp labels. Run after
 * changing the landing config or the card:
 *
 *   pnpm og                                                  # the committed image, from card.map0.json
 *   pnpm og --config card-vector --out candidate.jpg --scale 1   # another site/og/*.map0.json, elsewhere
 *   pnpm og --verbose                                        # page console + map state per poll
 *
 * The image is committed on purpose: the deploy build then needs neither a
 * browser nor the live map services, and the pages reference the image only
 * when the file exists (site/seo/head.ts, which also reads its dimensions).
 * Reuses a dev server on :5173 when one is running, otherwise starts one
 * in-process and stops it afterwards.
 */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
/* a bare name means site/og/<name>.map0.json — and survives Git Bash on Windows,
   which rewrites an argument starting with "/" into a path under its own install */
const CONFIG = opt("config", "card").replace(/^([^/].*?)(\.map0\.json)?$/, "/og/$1.map0.json");
const OUT = resolve(opt("out", fileURLToPath(new URL("../site/public/og.jpg", import.meta.url))));
const SCALE = Number(opt("scale", "2"));
const VERBOSE = args.includes("--verbose");
const CARD = `/og/card.html?config=${encodeURIComponent(CONFIG)}`;
const READY_TIMEOUT_MS = 60_000;

async function reachable(url) {
  try {
    return (await fetch(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

let server;
let base = (process.env.MAP0_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
if (!(await reachable(`${base}/og/card.html`))) {
  const { createServer } = await import("vite");
  server = await createServer({
    configFile: fileURLToPath(new URL("../site/vite.config.ts", import.meta.url)),
    logLevel: "warn",
    server: { strictPort: false },
  });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, "");
}

/* A system browser first (same choice as e2e/verify-demos.mjs); headless
   rendering is not reliable on every machine, so each option is one attempt,
   and the last one forces software rendering, which always works. */
const LAUNCH_OPTIONS = [
  { channel: "chrome" },
  { channel: "msedge" },
  {},
  { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
];

/* Ready means: MapLibre reports style, sources and every tile of the view
   loaded, AND every GeoJSON source that is actually drawn has delivered
   features — the fountains come from a WFS request that finishes well after
   the tiles. A source whose layers are all hidden never loads, so it is not
   waited for. */
const ready = () => {
  const map = document.querySelector("map0-viewer")?.api?.map;
  if (!map || !map.loaded()) return false;
  const style = map.getStyle();
  const drawn = (id) => style.layers.some((l) => l.source === id && l.layout?.visibility !== "none");
  return Object.entries(style.sources).every(
    ([id, source]) => source.type !== "geojson" || !drawn(id) || map.querySourceFeatures(id).length > 0,
  );
};

/** what the poll sees — for `--verbose`, when a run does not become ready */
const state = () => {
  const map = document.querySelector("map0-viewer")?.api?.map;
  if (!map) return "no map yet";
  return {
    loaded: map.loaded(),
    sources: Object.entries(map.getStyle().sources).map(
      ([id, s]) => `${id}:${s.type}:${map.isSourceLoaded(id) ? "loaded" : "pending"}:${map.querySourceFeatures(id).length}`,
    ),
  };
};

/** one attempt with one browser: resolves when the screenshot is written, throws otherwise */
async function capture(launchOptions) {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: SCALE });
    if (VERBOSE) {
      /* "CONTEXT_LOST_WEBGL: loseContext" here is MapLibre releasing a first map
         instance the viewer replaced, not a failure — the poll below decides */
      page.on("console", (m) => console.log(`[page:${m.type()}] ${m.text()}`));
      page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    }
    await page.goto(`${base}${CARD}`, { waitUntil: "domcontentloaded" });

    /* ready twice, 1.5 s apart: a source added late must not slip through between polls */
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (let stable = 0; stable < 2; ) {
      if (Date.now() > deadline) throw new Error(`the map did not become ready in ${READY_TIMEOUT_MS / 1000} s`);
      if (VERBOSE) console.log(JSON.stringify(await page.evaluate(state)));
      if (await page.evaluate(ready)) stable++;
      else stable = 0;
      await page.waitForTimeout(1500);
    }

    /* raster tiles fade in for 300 ms after they arrive: a screenshot taken
       inside that window shows a patchwork of half-transparent tiles. Force a
       frame and wait for the map to go idle, then a little longer. */
    await page.evaluate(
      () =>
        new Promise((done) => {
          const map = document.querySelector("map0-viewer").api.map;
          const timer = setTimeout(done, 4000);
          map.once("idle", () => {
            clearTimeout(timer);
            done();
          });
          map.triggerRepaint();
        }),
    );
    await page.waitForTimeout(1500);

    await page.screenshot({ path: OUT, type: "jpeg", quality: 88 }); // a map compresses far better as JPEG
  } finally {
    await browser.close();
  }
}

try {
  let done = false;
  for (const options of LAUNCH_OPTIONS) {
    const label = options.channel ?? (options.args ? "chromium (software rendering)" : "chromium");
    try {
      await capture(options);
      console.log(`✓ ${OUT} (${CONFIG}, ${SCALE}×, ${label})`);
      done = true;
      break;
    } catch (e) {
      console.warn(`✗ ${label}: ${e.message}`);
    }
  }
  if (!done) process.exitCode = 1;
} finally {
  await server?.close();
}
