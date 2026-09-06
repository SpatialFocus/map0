/**
 * Bundles the TypeScript declarations of the npm package (N11) into three files:
 *
 *   packages/ui/src/public.ts  →  dist/map0-types.d.ts   everything both entries share
 *   packages/ui/src/index.ts   →  dist/map0.d.ts         map0-viewer      (imports ./map0-types.js)
 *   packages/ui/src/ssr.ts     →  dist/map0-ssr.d.ts     map0-viewer/ssr  (imports ./map0-types.js)
 *
 * The shared file is one self-contained bundle (dts-bundle-generator) with the
 * workspace packages @map0/core and @map0/schema inlined — a consumer's editor
 * never sees `../core/src/…`, and only what public.ts exports is exported (types
 * that are merely referenced stay unexported, so the .d.ts cannot promise a name
 * the bundle does not deliver). It is compiled from source with
 * packages/ui/tsconfig.dts.json, which maps the workspace packages by path:
 * resolved through the node_modules symlinks, TypeScript would file them as
 * external libraries and emit nothing for them.
 *
 * Why not one bundle per entry: both entries export the same types, and a bundle
 * per entry gives each its own copy. The copies are not interchangeable —
 * `Map0Api` reaches classes with private members, which TypeScript compares by
 * declaration, not by shape — so an app importing `map0-viewer` on the client and
 * `map0-viewer/ssr` on the server would meet two `Map0Api`s and two
 * `HTMLElementTagNameMap` entries for one tag (TS2717). Hence the entries are
 * thin: TypeScript's own declaration emit of index.ts and ssr.ts, with every
 * import pointed at ./map0-types.js.
 *
 * The only imports left are the two type packages a consumer resolves themselves
 * (see packages/map0/package.json): `geojson` — a dependency, the config types use
 * it — and `maplibre-gl`, an optional peer, for `api.map`. Anything else in an
 * import is a leak and fails the build.
 *
 * Usage: pnpm build:types     (part of `pnpm build:npm`, after `pnpm build` — vite empties dist)
 */
import { generateDtsBundle } from "dts-bundle-generator";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const UI = join(root, "packages", "ui");
const SRC = join(UI, "src");
const OUT = join(UI, "dist");
const CONFIG = join(UI, "tsconfig.dts.json");
const SHARED = "map0-types.d.ts";
const ENTRIES = [
  { src: "index.ts", out: "map0.d.ts", browser: true },
  { src: "ssr.ts", out: "map0-ssr.d.ts", browser: false },
];
/** module specifiers the shared bundle may import from */
const ALLOWED_IMPORTS = new Set(["geojson", "maplibre-gl"]);
/** what the entries import in source — all of it is in the shared bundle */
const SHARED_SOURCES = new Set(["@map0/schema", "@map0/core", "./element.js", "./public.js"]);

const die = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
const kb = (text) => `${(text.length / 1024).toFixed(1)} KB`;
/** a declaration file without its comments — a doc sample's `from "…"` is not an import */
const stripComments = (dts) => dts.replace(/\/\*[\s\S]*?\*\//g, "");
/** every module specifier a declaration file refers to */
const specifiers = (dts) => {
  const code = stripComments(dts);
  return [
    ...code.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ...code.matchAll(/\/\/\/\s*<reference\s+(?:types|path)=["']([^"']+)["']/g),
  ].map((m) => m[1]);
};
const check = (problems, file, dts, required) => {
  for (const [name, pattern] of required) {
    if (!pattern.test(dts)) problems.push(`${file}: does not declare ${name}`);
  }
};

const started = Date.now();
const problems = [];
const files = new Map();

/* --------------------------------------------------------------- shared */

const [shared] = generateDtsBundle(
  [
    {
      filePath: join(SRC, "public.ts"),
      output: {
        /* the HTMLElementTagNameMap augmentation (element.ts) has to ride along */
        inlineDeclareGlobals: true,
        /* only what public.ts exports is exported — see the header */
        exportReferencedTypes: false,
        noBanner: true,
      },
    },
  ],
  { preferredConfigPath: CONFIG },
);
for (const spec of new Set(specifiers(shared))) {
  if (!ALLOWED_IMPORTS.has(spec)) problems.push(`${SHARED}: imports "${spec}" — not self-contained`);
}
if (/node_modules[\/]/.test(shared)) problems.push(`${SHARED}: mentions a node_modules path`);
/* the api surface is interfaces (packages/core/src/api.ts). A class here means a
   manager, a Signal or an adapter leaked through Map0Api — with private members
   TypeScript compares such classes by declaration, so consumers would break on
   every internal rename, and two copies of the types would not even be assignable */
for (const m of stripComments(shared).matchAll(/^\s*(?:export\s+)?declare\s+(?:abstract\s+)?class\s+(\w+)/gm)) {
  problems.push(`${SHARED}: declares class ${m[1]} — the api surface is interfaces only, see core/src/api.ts`);
}
check(problems, SHARED, shared, [
  ["Map0Config", /^export interface Map0Config\b/m],
  ["Map0Api", /^export type Map0Api\b/m],
  ["Map0ViewerElement", /^export interface Map0ViewerElement\b/m],
  ["Map0Layers", /^export interface Map0Layers\b/m],
  ["LayerHandle", /^export interface LayerHandle\b/m],
  ["ReadonlySignal", /^export interface ReadonlySignal\b/m],
  ["validateConfig", /^export declare function validateConfig\b/m],
  ["the HTMLElementTagNameMap entry", /interface HTMLElementTagNameMap \{\s*"map0-viewer": /],
]);
files.set(SHARED, shared);

/* -------------------------------------------------------------- entries */

const configFile = ts.readConfigFile(CONFIG, ts.sys.readFile);
if (configFile.error) die(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, UI);
const program = ts.createProgram({
  rootNames: ENTRIES.map((e) => join(SRC, e.src)),
  options: { ...parsed.options, noEmit: false, declaration: true, emitDeclarationOnly: true, declarationMap: false },
});
const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
if (errors.length) {
  const host = { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => "\n" };
  die(`the entries do not compile:\n${ts.formatDiagnostics(errors, host)}`);
}
for (const { src, out, browser } of ENTRIES) {
  let dts = "";
  program.emit(program.getSourceFile(join(SRC, src)), (_file, text) => void (dts = text), undefined, true);
  if (!dts) die(`no declaration emitted for src/${src}`);
  /* every import is redirected to the shared file — one it does not cover is a leak */
  for (const spec of new Set(specifiers(dts))) {
    if (!SHARED_SOURCES.has(spec)) problems.push(`${out}: imports "${spec}" — not covered by ${SHARED}`);
  }
  dts = dts
    .replace(/(\bfrom\s+)["']([^"']+)["']/g, (m, from, spec) => (SHARED_SOURCES.has(spec) ? `${from}"./map0-types.js"` : m))
    .replace(/\/\/# sourceMappingURL=.*\n?/g, "");
  if (/declare global/.test(stripComments(dts))) {
    problems.push(`${out}: has its own \`declare global\` — augmentations belong in element.ts`);
  }
  check(problems, out, dts, [
    ["defineMap0Viewer", /^export declare function defineMap0Viewer\b/m],
    ["createMap", /^export declare function createMap\b/m],
    ["type Map0Viewer", /^export type Map0Viewer = Map0ViewerElement;/m],
    ["the shared exports", /^export \* from "\.\/map0-types\.js";/m],
    ...(browser ? [["const Map0Viewer", /^export declare const Map0Viewer: Map0ViewerConstructor;/m]] : []),
  ]);
  files.set(out, dts);
}

/* ---------------------------------------------------------------- write */

if (problems.length) die(`declarations not clean — nothing written:\n  - ${problems.join("\n  - ")}`);
mkdirSync(OUT, { recursive: true });
for (const [name, text] of files) {
  writeFileSync(join(OUT, name), text);
  console.log(`${name.padEnd(18)} ${kb(text).padStart(8)}`);
}
if (!existsSync(join(OUT, "map0.js"))) {
  console.log("note: packages/ui/dist has no bundle yet — run `pnpm build` for the JavaScript");
}
console.log(`declarations bundled in ${((Date.now() - started) / 1000).toFixed(1)} s`);
