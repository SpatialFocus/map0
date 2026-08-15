/**
 * Bundle budget (N1 in docs/03-requirements.md): the code a first view must
 * download has to stay small. MapLibre is shipped verbatim as its own files and
 * is measured separately — it is the floor we build on, not our budget.
 * Lazy chunks are reported but not capped: they cost nothing until used.
 *
 * Usage: node scripts/check-size.mjs [--json]
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "packages/ui/dist";
/** our own eager code: entry + the chunks it imports statically */
const EAGER_BUDGET_KB = 100;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (!name.endsWith(".map")) files.push(path);
  }
};
walk(DIST);

const entry = readFileSync(join(DIST, "map0.js"), "utf8");
/** chunks the entry pulls in with a static import — everything else is lazy */
const eagerChunks = new Set(
  [...entry.matchAll(/(?:^|\n)import[^"']*["'](\.\/[^"']+)["']/g)].map((m) =>
    join(DIST, m[1].replace(/^\.\//, "")),
  ),
);

let eager = 0;
let lazy = 0;
let maplibre = 0;
const rows = [];
for (const path of files) {
  const gz = gzipSync(readFileSync(path)).length;
  const rel = relative(DIST, path).replaceAll("\\", "/");
  const kind = rel.startsWith("maplibre-gl")
    ? "maplibre"
    : rel === "map0.js" || eagerChunks.has(path)
      ? "eager"
      : "lazy";
  if (kind === "maplibre") maplibre += gz;
  else if (kind === "eager") eager += gz;
  else lazy += gz;
  rows.push({ file: rel, kb: +(gz / 1024).toFixed(1), kind });
}

const kb = (bytes) => (bytes / 1024).toFixed(1);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ eagerKb: +kb(eager), lazyKb: +kb(lazy), maplibreKb: +kb(maplibre), rows }, null, 1));
} else {
  rows.sort((a, b) => b.kb - a.kb);
  for (const r of rows) console.log(`${r.kind.padEnd(9)} ${String(r.kb).padStart(7)} KB  ${r.file}`);
  console.log("─".repeat(52));
  console.log(`eager (map0)   ${kb(eager).padStart(7)} KB gz   budget ${EAGER_BUDGET_KB} KB`);
  console.log(`maplibre-gl    ${kb(maplibre).padStart(7)} KB gz   (shipped verbatim)`);
  console.log(`lazy chunks    ${kb(lazy).padStart(7)} KB gz   (loaded on first use)`);
  console.log(`first view     ${kb(eager + maplibre).padStart(7)} KB gz`);
}

if (eager / 1024 > EAGER_BUDGET_KB) {
  console.error(`\n✗ eager bundle ${kb(eager)} KB exceeds the ${EAGER_BUDGET_KB} KB budget`);
  process.exit(1);
}
