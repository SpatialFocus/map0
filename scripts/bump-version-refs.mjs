/**
 * Moves the version references that live outside packages/map0/package.json:
 * the CDN snippets and prose mentions in both READMEs and the standalone demo
 * page. Counts are asserted so a reworded sentence fails the release loudly
 * instead of leaving a stale version on the website.
 *
 * Usage: node scripts/bump-version-refs.mjs <oldVersion> <newVersion>
 * (release-it calls this from its after:bump hook with ${latestVersion} ${version})
 */
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
  "README.md": 2, //                          status line + jsDelivr snippet
  "packages/map0/README.md": 4, //            preview banner + jsDelivr + unpkg + schema URL
  "examples/demos/standalone.html": 2, //     jsDelivr snippet + unpkg mention
  "examples/demos/validate.html": 1, //       pinned schema URL
};

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
