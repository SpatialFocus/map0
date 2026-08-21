/**
 * The release gate from docs/09 §release, automated: verify the PACKED TARBALL,
 * never packages/ui/dist. Unpacks the tarball's dist over site/public/standalone,
 * loads /demos/standalone.html (which uses exactly those files), and checks the two
 * paths that only break in built bundles:
 *
 *   1. the vector-tile basemap — a missing maplibre worker file still paints
 *      raster layers, so only rendered vector features prove the folder is a unit;
 *   2. the COG config — the decoder is a lazy chunk, and lazy chunk resolution
 *      is what regresses between dev server and bundle (docs/09 §4.4).
 *
 * Reuses a dev server already running on :5173, otherwise starts one and stops
 * it again. Usage: node e2e/verify-tarball.mjs <path-to-tgz>
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.env.MAP0_BASE_URL ?? "http://localhost:5173";
const PAGE = `${BASE}/demos/standalone.html`;

const tarball = resolve(process.cwd(), process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(tarball)) {
  console.error(`usage: verify-tarball.mjs <path-to-tgz> — got "${process.argv[2] ?? ""}"`);
  process.exit(1);
}

/* ---------------------------------------------- unpack over /standalone/ */

const standalone = join(root, "site", "public", "standalone");
rmSync(standalone, { recursive: true, force: true });
mkdirSync(standalone, { recursive: true });
/* relative paths only: a drive-letter argument makes GNU tar (MSYS) read
   "C:" as a remote host ("Cannot connect to C") */
const tar = spawnSync(
  "tar",
  [
    "-xzf",
    basename(tarball),
    "-C",
    relative(dirname(tarball), standalone) || ".",
    "--strip-components=2",
    "package/dist",
  ],
  { cwd: dirname(tarball), stdio: "inherit" },
);
if (tar.status !== 0) process.exit(tar.status ?? 1);
if (!existsSync(join(standalone, "maplibre-gl-worker.mjs"))) {
  console.error("✗ tarball has no dist/maplibre-gl-worker.mjs — refusing to continue");
  process.exit(1);
}

/* the published JSON Schema (C3) rides along as schema/v1.json — its jsDelivr
   URL is documented, so a tarball without it is broken */
const listing = spawnSync("tar", ["-tzf", basename(tarball)], {
  cwd: dirname(tarball),
  encoding: "utf8",
});
if (!listing.stdout?.includes("package/schema/v1.json")) {
  console.error("✗ tarball has no schema/v1.json — run `pnpm build:npm` before packing");
  process.exit(1);
}

/* ---------------------------------------------------------- dev server */

const up = async () => {
  try {
    const res = await fetch(PAGE, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

let server;
if (await up()) {
  console.log(`  reusing the server at ${BASE}`);
} else {
  console.log("  starting the dev server…");
  server = spawn("pnpm", ["dev"], { cwd: root, shell: true, stdio: "ignore" });
  const deadline = Date.now() + 60_000;
  while (!(await up())) {
    if (Date.now() > deadline) {
      console.error("✗ dev server did not come up within 60 s");
      stopServer();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function stopServer() {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
}

/* ------------------------------------------------------------- browser */

async function launch() {
  for (const opts of [{ channel: "chrome" }, { channel: "msedge" }, {}]) {
    try {
      return await chromium.launch(opts);
    } catch {
      /* next */
    }
  }
  throw new Error("no browser available for playwright");
}

const checks = [];
const record = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const messages = [];
  const requests = [];
  /* Chromium relays GPU-driver chatter as console warnings on some machines —
     "[.WebGL-…]GL Driver Message (OpenGL, Performance, …): GPU stall due to
     ReadPixels" and friends. That is the driver talking, not map0, and it broke
     a release on a machine whose GPU emits it; the console-clean gate is about
     OUR warnings only. */
  const driverNoise = /GL Driver Message/;
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (t.includes("Lit is in dev mode") || driverNoise.test(t)) return;
    messages.push(`${m.type()}: ${t.slice(0, 160)}`);
  });
  page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on("request", (r) => requests.push(r.url()));

  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.locator("map0-viewer").first().scrollIntoViewIfNeeded({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const v = document.querySelector("map0-viewer");
      return !!v?.api?.map && !v.shadowRoot?.querySelector(".loading:not([data-done])");
    },
    { timeout: 60_000 },
  );

  /* -- 1: vector tiles through the tarball's maplibre worker -- */
  await page.getByRole("radio", { name: "basemap.at" }).click();
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const m = document.querySelector("map0-viewer").api.map;
          m.once("idle", resolve);
          setTimeout(resolve, 30_000);
        }),
    )
    .catch(() => {});
  await page.waitForTimeout(1500);

  const vt = await page.evaluate(() => {
    const api = document.querySelector("map0-viewer").api;
    const feats = api.map.queryRenderedFeatures();
    return {
      vectorFeatures: feats.filter((f) => f.source && !/^m0s-/.test(f.source)).length,
      wmsOverlay: !!api.map.getLayer("m0l-widmung"),
    };
  });
  const fromTarball = requests.filter((u) => u.includes("/standalone/"));
  const devLeak = requests.filter((u) => /\/packages\/(ui|core|schema)\/src\//.test(u));
  record(
    "vector tiles render from the tarball bundle",
    vt.vectorFeatures > 500,
    `${vt.vectorFeatures} vector features`,
  );
  record(
    "maplibre worker + shared served out of the tarball",
    fromTarball.some((u) => u.includes("maplibre-gl-worker.mjs")) &&
      fromTarball.some((u) => u.includes("maplibre-gl-shared.mjs")),
  );
  record("WMS overlay survives the basemap switch", vt.wmsOverlay);
  record("no dev sources loaded (bundle only)", devLeak.length === 0, devLeak[0] ?? "");

  /* -- 2: the COG path — same bundle, different config -- */
  await page.evaluate(() => {
    document.querySelector("map0-viewer").setAttribute("config-src", "/configs/cog-terrain.map0.json");
  });
  await page.waitForFunction(
    () => {
      const layers = document.querySelector("map0-viewer")?.api?.layers?.state?.value ?? [];
      return layers.some((l) => l.id === "dgm") && layers.every((l) => l.status !== "loading");
    },
    { timeout: 90_000 },
  );
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const m = document.querySelector("map0-viewer").api.map;
          m.once("idle", resolve);
          setTimeout(resolve, 30_000);
        }),
    )
    .catch(() => {});

  const cog = await page.evaluate(() => {
    const api = document.querySelector("map0-viewer").api;
    const style = api.map.getStyle();
    const layers = api.layers.state.value;
    const byId = (id) => layers.find((l) => l.id === id);
    return {
      demSource: style.sources["m0s-dgm"]?.type,
      demFragment: !!style.sources["m0s-dgm"]?.url?.endsWith("#dem"),
      demLayer: api.map.getLayer("m0l-dgm")?.type,
      statuses: layers.map((l) => `${l.id}:${l.status}`).join(" "),
      allReady: layers.every((l) => l.status === "ready"),
      rampEntries: byId("dgm-elevation")?.legend?.entries?.length ?? 0,
    };
  });
  record(
    "COG hillshade renders from the tarball bundle",
    cog.demSource === "raster-dem" && cog.demFragment && cog.demLayer === "hillshade",
    `${cog.demSource}/${cog.demLayer}`,
  );
  record("all COG layers reach ready", cog.allReady, cog.statuses);
  record("ramp legend derived in the bundle", cog.rampEntries >= 5, `${cog.rampEntries} entries`);
  record("console clean", messages.length === 0, messages.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  stopServer();
}

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} tarball checks passed`);
if (failed) process.exit(1);
