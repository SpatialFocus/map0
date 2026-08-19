/**
 * Assembles the publishable `map0` package (packages/map0) from the built bundle.
 *
 * packages/ui/dist is already the deployable folder — entry, lazy chunks, and
 * MapLibre's three files copied in verbatim (see scripts/maplibre-dist.mjs). This
 * script copies it to packages/map0/dist without the sourcemaps, and regenerates
 * THIRD-PARTY-NOTICES.md from what the sourcemaps say is actually inside those
 * chunks. Since we redistribute other people's code — MapLibre verbatim, the rest
 * compiled in — the notices are a licence obligation, not a nicety: a package that
 * ships without them is broken, so a missing licence text fails the build.
 *
 * Usage: pnpm build:npm     (builds the bundle first, then runs this)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(root, "packages", "ui", "dist");
const PKG = join(root, "packages", "map0");
const OUT = join(PKG, "dist");

/** MapLibre resolves its worker at runtime from a sibling file: no file, no vector tiles. */
const MAPLIBRE_FILES = ["maplibre-gl.mjs", "maplibre-gl-shared.mjs", "maplibre-gl-worker.mjs"];
const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "license", "COPYING"];

/**
 * Packages whose npm tarball ships no licence text at all. Reproducing it is our
 * obligation as the redistributor, not theirs, so the text lives in the repo:
 * canonical SPDX wording with the upstream copyright line, taken from the project's
 * own repository (recorded per entry, and printed in the notices).
 */
const FALLBACK_LICENSES = {
  pmtiles: {
    file: "pmtiles.LICENSE",
    source: "https://github.com/protomaps/PMTiles/blob/main/LICENSE",
  },
  lerc: {
    file: "lerc.LICENSE",
    source: "https://github.com/Esri/lerc/blob/master/LICENSE",
  },
};

const die = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!existsSync(join(SRC, "map0.js"))) die(`no bundle in ${SRC} — run \`pnpm build\` first`);
/* the "node" export condition points here: without it, importing the package in
   any SSR/prerender step resolves to the browser entry and dies on HTMLElement */
if (!existsSync(join(SRC, "map0-ssr.js"))) die(`no SSR entry in ${SRC} — run \`pnpm build\` first`);

/* ---------------------------------------------------------------- dist copy */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sourcemaps = [];
const shipped = [];
for (const file of readdirSync(SRC)) {
  if (file.endsWith(".map")) {
    sourcemaps.push(file);
    continue;
  }
  /* sourcemaps stay out of the tarball, so the references to them must go too —
     otherwise every devtools open on a consumer's site 404s */
  const src = readFileSync(join(SRC, file), "utf8");
  const stripped = src.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, "\n");
  if (stripped === src && /sourceMappingURL/.test(src)) die(`${file}: sourceMappingURL not where expected`);
  writeFileSync(join(OUT, file), stripped);
  shipped.push(file);
}

for (const file of MAPLIBRE_FILES) {
  if (!shipped.includes(file)) die(`${file} missing from the bundle — MapLibre's worker would 404 at runtime`);
}

/* --------------------------------------------------------------- the licence */

copyFileSync(join(root, "LICENSE"), join(PKG, "LICENSE"));

/* ------------------------------------------------- what is inside the chunks */

/** every npm package whose code the sourcemaps attribute to a chunk we ship */
const bundled = new Set();
for (const file of sourcemaps) {
  const { sources = [] } = JSON.parse(readFileSync(join(SRC, file), "utf8"));
  for (const source of sources) {
    /* pnpm paths look like …/node_modules/.pnpm/lit@3.3.1/node_modules/lit/… —
       the last node_modules/ segment is the one that names the package */
    const at = source.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const rest = source.slice(at + "node_modules/".length).split("/");
    bundled.add(rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]);
  }
}
/* MapLibre is external to the chunks, so no sourcemap mentions it — it is copied in */
bundled.add("maplibre-gl");

/** candidate install locations for a package name, pnpm symlink farm included */
const resolvePackage = (name) => {
  const direct = [join(root, "packages", "ui", "node_modules", name), join(root, "node_modules", name)];
  for (const dir of direct) if (existsSync(join(dir, "package.json"))) return dir;

  const store = join(root, "node_modules", ".pnpm");
  if (!existsSync(store)) return null;
  const prefix = `${name.replace("/", "+")}@`;
  const hit = readdirSync(store)
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .pop();
  if (!hit) return null;
  const dir = join(store, hit, "node_modules", name);
  return existsSync(join(dir, "package.json")) ? dir : null;
};

const notices = [];
const missing = [];
for (const name of [...bundled].sort()) {
  const dir = resolvePackage(name);
  if (!dir) {
    missing.push(`${name} (not found in node_modules)`);
    continue;
  }
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const fallback = FALLBACK_LICENSES[name];
  const licenseFile =
    LICENSE_FILES.map((f) => join(dir, f)).find(existsSync) ??
    (fallback ? join(root, "scripts", "third-party", fallback.file) : undefined);
  if (!licenseFile || !existsSync(licenseFile)) {
    missing.push(`${name} (no licence text in ${dir} and no entry in FALLBACK_LICENSES)`);
    continue;
  }
  notices.push({
    name,
    version: meta.version ?? "",
    license: typeof meta.license === "string" ? meta.license : (meta.licenses?.[0]?.type ?? "see below"),
    homepage: meta.homepage ?? (typeof meta.repository === "string" ? meta.repository : meta.repository?.url) ?? "",
    note: fallback ? `Licence text from ${fallback.source} — the npm package ships none.` : "",
    text: readFileSync(licenseFile, "utf8").trim(),
  });
}
if (missing.length) die(`cannot attribute bundled code:\n  - ${missing.join("\n  - ")}`);

const header = `# Third-party notices

map0's own code is MIT licensed (see LICENSE). The published package is a prebuilt
bundle, so it also contains code from the projects below — MapLibre GL JS copied in
verbatim as \`dist/maplibre-gl*.mjs\`, the others compiled into \`dist/\` chunks. Their
licences and copyright notices apply to those parts and are reproduced in full.

Generated by \`scripts/build-npm.mjs\` from the build's sourcemaps — do not edit by hand.
`;

writeFileSync(
  join(PKG, "THIRD-PARTY-NOTICES.md"),
  `${header}\n${notices
    .map(
      ({ name, version, license, homepage, note, text }) =>
        `## ${name} ${version} — ${license}\n${homepage ? `\n${homepage}\n` : ""}${
          note ? `\n${note}\n` : ""
        }\n\`\`\`\n${text}\n\`\`\`\n`,
    )
    .join("\n")}`,
);

/* ------------------------------------------------------------------- report */

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
let raw = 0;
let gz = 0;
for (const file of shipped) {
  const bytes = readFileSync(join(OUT, file));
  raw += bytes.length;
  gz += gzipSync(bytes).length;
}
console.log(`packages/map0/dist — ${shipped.length} files, ${kb(raw)} raw, ${kb(gz)} gzip`);
console.log(`THIRD-PARTY-NOTICES.md — ${notices.length} bundled packages: ${notices.map((n) => n.name).join(", ")}`);
console.log(`\nnext: cd packages/map0 && npm publish   (npm login first; the version is in package.json)`);
