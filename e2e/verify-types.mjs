/**
 * The types gate (N11): a fresh consumer project installs the PACKED TARBALL and
 * type-checks against it — never against packages/ui/src, where every import
 * resolves. Two installs, because the declarations lean on two outside packages
 * in two different ways (docs/09 §release):
 *
 *   full — tarball + maplibre-gl (the optional peer that types `api.map`):
 *          `tsc --strict` under `bundler` resolution with skipLibCheck OFF, so the
 *          bundled .d.ts themselves are checked, and under `nodenext` (which takes
 *          the "node" export condition, i.e. the SSR declarations — skipLibCheck
 *          on there: maplibre-gl's own dependencies do not pass it under nodenext,
 *          which is not ours to fix); plus a negative control — a file with three
 *          type errors has to fail, or the green above proves nothing;
 *   bare — tarball only: @types/geojson has to arrive as a dependency, maplibre-gl
 *          must NOT (an optional peer is a suggestion, not a 10 MB download), and
 *          the consumer still compiles with skipLibCheck on — `api.map` is `any`.
 *
 * Usage: node e2e/verify-types.mjs [path-to-tgz] [--keep]
 *        (no tgz: packs packages/map0 itself — run `pnpm build:npm` first)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PKG = join(root, "packages", "map0");
const TSC = join(root, "node_modules", "typescript", "lib", "tsc.js");
const win = process.platform === "win32";
const keep = process.argv.includes("--keep");
const tgzArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

const die = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
if (!existsSync(TSC)) die("no TypeScript in node_modules — run `pnpm install`");

const work = mkdtempSync(join(tmpdir(), "map0-types-"));
console.log(`  scratch project: ${work}`);

/* ------------------------------------------------------------- tarball */

let tarball;
if (tgzArg) {
  tarball = resolve(process.cwd(), tgzArg);
  if (!existsSync(tarball)) die(`no such tarball: ${tarball}`);
} else {
  for (const file of ["map0.js", "map0-types.d.ts", "map0.d.ts", "map0-ssr.d.ts"]) {
    if (!existsSync(join(PKG, "dist", file))) die(`packages/map0/dist/${file} missing — run \`pnpm build:npm\` first`);
  }
  const { name, version } = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  const pack = spawnSync("pnpm", ["pack", "--pack-destination", work], { cwd: PKG, shell: win, stdio: "inherit" });
  if (pack.status !== 0) die("pnpm pack failed");
  tarball = join(work, `${name}-${version}.tgz`);
  if (!existsSync(tarball)) die(`pnpm pack did not produce ${tarball}`);
}

const checks = [];
const record = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

/* relative path only: a drive letter makes GNU tar read "C:" as a remote host */
const listing = spawnSync("tar", ["-tzf", basename(tarball)], { cwd: dirname(tarball), encoding: "utf8" });
for (const file of ["package/dist/map0-types.d.ts", "package/dist/map0.d.ts", "package/dist/map0-ssr.d.ts"]) {
  record(`tarball ships ${file.slice("package/".length)}`, listing.stdout?.includes(file) ?? false);
}

/* --------------------------------------------------------- the consumer */

/** works under both resolutions: `defineMap0Viewer` is sync in the browser entry, a Promise in the SSR one */
const CONSUMER = [
  "import {",
  "  createMap,",
  "  defineMap0Viewer,",
  "  validateConfig,",
  "  type Map0Api,",
  "  type Map0Config,",
  "  type Map0Viewer,",
  "  type Map0ViewerEventMap,",
  '} from "map0-viewer";',
  "",
  "const config: Map0Config = {",
  "  version: 1,",
  '  basemaps: [{ type: "empty", title: "None" }],',
  '  layers: [{ id: "pts", type: "geojson", title: "Points", data: { type: "FeatureCollection", features: [] } }],',
  "};",
  "void defineMap0Viewer();",
  'const viewer: Map0Viewer = document.querySelector("map0-viewer")!;',
  "viewer.config = config;",
  'viewer.loading = "eager";',
  'viewer.theme = "dark";',
  "const zoom: number = viewer.api!.map.getZoom();",
  'viewer.addEventListener("map0:ready", (event) => {',
  "  const api: Map0Api = event.detail.api;",
  '  api.setLayerVisibility("pts", false);',
  '  void api.zoomToLayer("pts");',
  "  const url: string | null = api.getShareUrl();",
  "  void url;",
  "});",
  'viewer.addEventListener("map0:error", (event) => {',
  "  const detail = event.detail;",
  '  if ("errors" in detail) console.warn(detail.errors.map((e) => e.path + ": " + e.message));',
  "  else console.warn(detail.message, detail.layerId);",
  "});",
  'viewer.addEventListener("map0:featureclick", (event) => {',
  "  const [lng, lat] = event.detail.lngLat;",
  "  console.log(lng, lat, event.detail.results.map((r) => r.layerTitle));",
  "});",
  'viewer.addEventListener("click", (event) => console.log(event.clientX));',
  'const onReady = (event: Map0ViewerEventMap["map0:ready"]): string => event.detail.api.locale;',
  "const result = validateConfig(config);",
  "if (!result.valid) console.error(result.errors);",
  "void createMap(document.body, config);",
  "void zoom;",
  "void onReady;",
  "",
].join("\n");

/** browser entry only — the SSR entry has no `Map0Viewer` value */
const BROWSER = [
  'import { Map0Viewer, createMap, defineMap0Viewer, type Map0Config } from "map0-viewer";',
  "",
  'defineMap0Viewer("my-map");',
  "const el = new Map0Viewer();",
  'el.config = { version: 1, basemaps: [{ type: "empty" }] } satisfies Map0Config;',
  "el.load();",
  "if (el instanceof Map0Viewer) el.reload();",
  'const created: Map0Viewer = createMap(document.body, { version: 1, basemaps: [{ type: "empty" }] });',
  'created.addEventListener("map0:search", (event) => console.log(event.detail.result.label));',
  "",
].join("\n");

const SERVER = [
  "import {",
  "  canDefineElements,",
  "  defineMap0Viewer,",
  "  normalizeConfig,",
  "  validateConfig,",
  "  type Map0Config,",
  "  type Map0Viewer,",
  '} from "map0-viewer/ssr";',
  "",
  'const cfg: Map0Config = { version: 1, basemaps: [{ type: "empty" }] };',
  "const checked = validateConfig(cfg);",
  "if (checked.valid) console.log(normalizeConfig(checked.config!).basemaps.length);",
  "",
  "export async function mount(): Promise<Map0Viewer | null> {",
  "  if (!canDefineElements()) return null;",
  "  const defined: boolean = await defineMap0Viewer();",
  '  return defined ? document.querySelector("map0-viewer") : null;',
  "}",
  "",
].join("\n");

/**
 * both entries in one program (a server component next to a client component):
 * their types have to be the same declarations, not two look-alike copies —
 * `Map0Api` reaches classes with private members, which TypeScript compares by
 * declaration, so a copy per entry would make these assignments fail
 */
const BOTH = [
  'import type { Map0Api, Map0Viewer } from "map0-viewer";',
  'import type { Map0Api as SsrApi, Map0Viewer as SsrViewer } from "map0-viewer/ssr";',
  "",
  "export const api = (a: SsrApi): Map0Api => a;",
  "export const viewer = (v: SsrViewer): Map0Viewer => v;",
  'export const el: SsrViewer | null = document.querySelector("map0-viewer");',
  "",
].join("\n");

/** three errors, one per line 2–4 — each has to be reported */
const NEGATIVE = [
  'import { type Map0Config } from "map0-viewer";',
  "const bad: Map0Config = { version: 2, basemaps: [] };",
  'const zoom: string = document.querySelector("map0-viewer")!.api!.map.getZoom();',
  'document.querySelector("map0-viewer")!.addEventListener("map0:ready", (event) => event.detail.nope);',
  "void bad;",
  "void zoom;",
  "",
].join("\n");

/* ------------------------------------------------------------- helpers */

function install(name, extra) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `map0-types-${name}`, private: true, type: "module" }, null, 2),
  );
  writeFileSync(join(dir, "consumer.ts"), CONSUMER);
  writeFileSync(join(dir, "browser.ts"), BROWSER);
  writeFileSync(join(dir, "server.ts"), SERVER);
  writeFileSync(join(dir, "both.ts"), BOTH);
  writeFileSync(join(dir, "negative.ts"), NEGATIVE);
  const args = ["install", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error", tarball, ...extra];
  const res = spawnSync("npm", args, { cwd: dir, shell: win, encoding: "utf8" });
  if (res.status !== 0) die(`npm install failed in ${dir}:\n${res.stdout}\n${res.stderr}`);
  return dir;
}

/** run tsc --strict on `files`; returns { ok, output } */
function typecheck(dir, label, files, { resolution, skipLibCheck }) {
  const config = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: resolution === "nodenext" ? "NodeNext" : "ESNext",
      moduleResolution: resolution,
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      skipLibCheck,
      types: [],
    },
    files,
  };
  const path = join(dir, `tsconfig.${label}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2));
  const res = spawnSync(process.execPath, [TSC, "-p", path, "--pretty", "false"], { cwd: dir, encoding: "utf8" });
  return { ok: res.status === 0, output: `${res.stdout}${res.stderr}`.trim() };
}

const firstLine = (s) => s.split("\n").find(Boolean) ?? "";

/* ------------------------------------------------------- full install */

console.log("\n  full: tarball + maplibre-gl");
const full = install("full", ["maplibre-gl@^6.3.0"]);
record("maplibre-gl installed alongside", existsSync(join(full, "node_modules", "maplibre-gl", "package.json")));

const bundler = typecheck(full, "bundler", ["consumer.ts", "browser.ts", "server.ts", "both.ts"], {
  resolution: "bundler",
  skipLibCheck: false,
});
record("strict consumer compiles, bundler resolution, lib check on", bundler.ok, firstLine(bundler.output));

/* skipLibCheck on: @maplibre/geojson-vt (a maplibre-gl dependency) ships declarations
   with extensionless relative imports, which nodenext rejects — the bundler pass
   above already checks our own declarations with the lib check on */
const nodenext = typecheck(full, "nodenext", ["consumer.ts", "server.ts", "both.ts"], {
  resolution: "nodenext",
  skipLibCheck: true,
});
record("strict consumer compiles, nodenext resolution (node condition)", nodenext.ok, firstLine(nodenext.output));

const negative = typecheck(full, "negative", ["negative.ts"], { resolution: "bundler", skipLibCheck: false });
const errorLines = negative.output.split("\n").filter((l) => /error TS\d+/.test(l));
const onlyNegative = errorLines.length > 0 && errorLines.every((l) => l.startsWith("negative.ts("));
const linesHit = [2, 3, 4].filter((n) => errorLines.some((l) => l.startsWith(`negative.ts(${n},`)));
record(
  "negative control fails on all three lines",
  !negative.ok && onlyNegative && linesHit.length === 3,
  `${errorLines.length} errors, lines ${linesHit.join(",")}`,
);

/* ------------------------------------------------------- bare install */

console.log("\n  bare: tarball only");
const bare = install("bare", []);
record(
  "@types/geojson arrives as a dependency",
  existsSync(join(bare, "node_modules", "@types", "geojson", "index.d.ts")),
);
record("maplibre-gl is NOT pulled in (optional peer)", !existsSync(join(bare, "node_modules", "maplibre-gl")));

const bareOk = typecheck(bare, "bare", ["consumer.ts", "browser.ts", "server.ts", "both.ts"], {
  resolution: "bundler",
  skipLibCheck: true,
});
record("strict consumer compiles with skipLibCheck (api.map is any)", bareOk.ok, firstLine(bareOk.output));

const bareStrict = typecheck(bare, "bare-libcheck", ["consumer.ts"], { resolution: "bundler", skipLibCheck: false });
record(
  "without skipLibCheck the error names maplibre-gl",
  !bareStrict.ok && /maplibre-gl/.test(bareStrict.output),
  firstLine(bareStrict.output),
);

/* -------------------------------------------------------------- report */

if (keep) console.log(`\n  kept ${work}`);
else rmSync(work, { recursive: true, force: true, maxRetries: 3 });

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} type checks passed`);
if (failed) process.exit(1);
