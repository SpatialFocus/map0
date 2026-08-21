/**
 * Moves the version references that live outside packages/map0/package.json:
 * the CDN snippets and prose mentions in both READMEs, the demo pages, and the
 * German catalogues that translate those same sentences. Counts are asserted so
 * a reworded sentence fails the release loudly instead of leaving a stale
 * version on the website — and the rewritten files are STAGED here, so the
 * release commit carries them without a second list to keep in sync.
 *
 * Usage: node scripts/bump-version-refs.mjs <oldVersion> <newVersion>
 * (release-it calls this from its after:bump hook with ${latestVersion} ${version})
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [oldVersion, newVersion] = process.argv.slice(2);
if (!oldVersion || !newVersion) {
  console.error("usage: bump-version-refs.mjs <oldVersion> <newVersion>");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));

/** file → how many references it must contain (assertion, not a guess) */
const FILES = {
  "README.md": 2, //                              status line + jsDelivr snippet
  "packages/map0/README.md": 4, //                preview banner + jsDelivr + unpkg + schema URL
  "site/demos/standalone.html": 2, //             jsDelivr snippet + unpkg mention
  "site/demos/validate.html": 1, //               pinned schema URL
  "site/i18n/de/demos/standalone.json": 1, //     the German unpkg sentence
  "site/i18n/de/demos/validate.json": 1, //       the German schema URL
};

/** Out of scope for the sweep below: the changelog is a history, the lockfile
    pins what npm resolved, the notices file carries THIRD-PARTY versions that
    can collide with ours by coincidence, and package.json belongs to release-it
    (already bumped by the time this hook runs). */
const SWEEP_EXCLUDES = [
  "CHANGELOG.md",
  "pnpm-lock.yaml",
  "packages/map0/THIRD-PARTY-NOTICES.md",
  "packages/map0/package.json",
];

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = new RegExp(escape(oldVersion), "g");

let failed = false;
for (const [file, expected] of Object.entries(FILES)) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  const found = text.match(pattern)?.length ?? 0;
  if (found !== expected) {
    console.error(`✗ ${file}: expected ${expected} references to ${oldVersion}, found ${found}`);
    failed = true;
    continue;
  }
  writeFileSync(path, text.replaceAll(oldVersion, newVersion));
  console.log(`  ${file}: ${found} reference(s) → ${newVersion}`);
}
if (failed) {
  console.error("  (a reference moved or was reworded — update FILES in this script)");
  process.exit(1);
}

/* Nothing may be left behind. A reference in a file FILES does not know about
   would ship stale — which is exactly what happened to the German catalogues,
   unnoticed for a release. Every rewrite above is done, so any remaining hit is
   a file this script should have covered. */
let stale = [];
try {
  stale = git(
    "grep",
    "--files-with-matches",
    "--fixed-strings",
    oldVersion,
    "--",
    ".",
    ...SWEEP_EXCLUDES.map((f) => `:!${f}`),
  )
    .split("\n")
    .filter(Boolean);
} catch {
  /* git grep exits 1 when it finds nothing — the case we want */
}
if (stale.length > 0) {
  console.error(`✗ ${oldVersion} still appears in: ${stale.join(", ")}`);
  console.error("  (add each file to FILES above, or to SWEEP_EXCLUDES if it belongs there)");
  process.exit(1);
}

/* Staged here rather than by a hand-kept `git add` list in .release-it.json:
   that list drifted from FILES and left rewrites out of two release commits in
   a row. One list, and it is the one that did the rewriting. */
git("add", "--", ...Object.keys(FILES));
console.log(`  staged ${Object.keys(FILES).length} files for the release commit`);
