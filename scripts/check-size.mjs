/**
 * Bundle budget (N1 in docs/03-requirements.md).
 *
 * Three tiers, because they are paid at different moments:
 *   page     — the entry and its static imports: every embed pays this on page load
 *   map      — engine, MapLibre, its stylesheet: paid when a map actually initialises
 *              (immediately for a map in view, never for one nobody scrolls to)
 *   deferred — per-feature chunks: capabilities parsing, proj4, PMTiles, dialogs
 *
 * Only the page tier is capped; the rest is reported so regressions stay visible.
 * Usage: node scripts/check-size.mjs [--json]
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "packages/ui/dist";
const PAGE_BUDGET_KB = 40;

const jsFiles = readdirSync(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
const isVendorMaplibre = (f) => f.startsWith("maplibre-gl");

/** static (non-`import()`) chunk-to-chunk edges */
const staticImports = new Map();
const contents = new Map();
for (const file of jsFiles) {
  const src = readFileSync(join(DIST, file), "utf8");
  contents.set(file, src);
  const dynamic = new Set([...src.matchAll(/import\(\s*["']\.\/([^"']+)["']/g)].map((m) => m[1]));
  const all = [...src.matchAll(/(?:from|import)\s*["']\.\/([^"']+)["']/g)].map((m) => m[1]);
  staticImports.set(
    file,
    all.filter((f) => !dynamic.has(f)),
  );
}

const closure = (roots) => {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    stack.push(...(staticImports.get(file) ?? []));
  }
  return seen;
};

const page = closure(["map0.js"]);

/** what a chunk is made of, read from its sourcemap */
const describe = (file) => {
  try {
    const map = JSON.parse(readFileSync(join(DIST, `${file}.map`), "utf8"));
    const names = new Set(
      map.sources.map((s) => {
        const i = s.lastIndexOf("node_modules/");
        if (i >= 0) {
          const rest = s.slice(i + 13);
          return rest.split("/").slice(0, rest.startsWith("@") ? 2 : 1).join("/");
        }
        return s.split("/").pop().replace(/\.[jt]s$/, "");
      }),
    );
    return [...names].slice(0, 3).join(", ");
  } catch {
    return "";
  }
};

/* The map tier is MapLibre plus everything that statically needs it — except the
   modules a user opens by hand. Those reference MapLibre for their own map work
   but are not part of showing a map, so they are listed as on-demand. */
const ON_DEMAND = /(-dialog|^measure)$/;
const isOnDemandChunk = (file) => {
  const parts = describe(file).split(", ").filter(Boolean);
  return parts.length > 0 && parts.every((name) => ON_DEMAND.test(name));
};
const mapTier = new Set(jsFiles.filter(isVendorMaplibre));
for (const file of jsFiles) {
  if (page.has(file) || isVendorMaplibre(file) || isOnDemandChunk(file)) continue;
  if ([...closure([file])].some((f) => isVendorMaplibre(f) || f.startsWith("maplibre-css"))) {
    mapTier.add(file);
  }
}

const rows = [];
const totals = { page: 0, map: 0, deferred: 0 };
for (const file of jsFiles) {
  const gz = gzipSync(readFileSync(join(DIST, file))).length;
  const tier = page.has(file) ? "page" : mapTier.has(file) ? "map" : "deferred";
  totals[tier] += gz;
  rows.push({ file, kb: +(gz / 1024).toFixed(1), tier, contents: describe(file) });
}

const kb = (bytes) => (bytes / 1024).toFixed(1);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, +kb(v)])), rows }, null, 1));
} else {
  rows.sort((a, b) => (a.tier === b.tier ? b.kb - a.kb : a.tier.localeCompare(b.tier)));
  for (const r of rows) {
    console.log(`${r.tier.padEnd(9)}${String(r.kb).padStart(7)} KB  ${r.file.padEnd(28)} ${r.contents}`);
  }
  console.log("─".repeat(78));
  console.log(`page load      ${kb(totals.page).padStart(7)} KB gz   budget ${PAGE_BUDGET_KB} KB`);
  console.log(`+ first map    ${kb(totals.map).padStart(7)} KB gz   engine, MapLibre, stylesheet`);
  console.log(`+ on demand    ${kb(totals.deferred).padStart(7)} KB gz   capabilities, proj4, PMTiles, dialogs`);
  console.log(`map in view    ${kb(totals.page + totals.map).padStart(7)} KB gz`);
}

if (totals.page / 1024 > PAGE_BUDGET_KB) {
  console.error(`\n✗ page-load bundle ${kb(totals.page)} KB exceeds the ${PAGE_BUDGET_KB} KB budget`);
  process.exit(1);
}
