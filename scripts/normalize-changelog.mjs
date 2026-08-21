/**
 * Straightens out what @release-it/conventional-changelog leaves behind on
 * Windows: the plugin normalises its `header` option to `os.EOL` and then
 * strips the old header from the file with an exact `replace(header, '')`.
 * This repo stores LF (.gitattributes: `* text=auto eol=lf`), so on a Windows
 * release the CRLF header never matches the LF one in the file — the strip
 * silently does nothing and a fresh header is prepended above every release.
 * Three releases had produced three headers before this script existed.
 *
 * Runs from the before:git:release hook in packages/map0/.release-it.json,
 * after the plugin wrote the file and before it is staged. Both the header and
 * the file path are read from that config, so this script cannot drift from it.
 *
 * Idempotent, and platform-independent: the result is always one header at the
 * top and LF throughout, whoever cuts the release.
 *
 * Usage: node scripts/normalize-changelog.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = join(root, "packages", "map0", ".release-it.json");

const config = JSON.parse(readFileSync(configPath, "utf8"));
const plugin = config.plugins?.["@release-it/conventional-changelog"];
if (!plugin?.infile || !plugin.header) {
  console.error(`✗ ${relative(root, configPath)}: no conventional-changelog infile/header to read`);
  process.exit(1);
}

/* `infile` is relative to release-it's cwd, which is the config's own package */
const infile = resolve(dirname(configPath), plugin.infile);
const header = plugin.header.split(/\r\n|\r|\n/g).join("\n");

const raw = readFileSync(infile, "utf8");
const crlf = (raw.match(/\r\n/g) ?? []).length;
const text = raw.replaceAll("\r\n", "\n");
const copies = text.split(header).length - 1;

/* strip every copy, then put exactly one back on top; removing a block from
   the middle leaves the surrounding blank lines doubled up */
const body = text.split(header).join("").replace(/\n{3,}/g, "\n\n").trim();
const out = `${header}\n\n${body}\n`;

if (out === raw) {
  console.log(`  ${relative(root, infile)}: one header, LF throughout — nothing to do`);
  process.exit(0);
}
writeFileSync(infile, out);
const notes = [
  copies === 1 ? "header kept" : `${copies} headers → 1`,
  crlf > 0 ? `${crlf} CRLF → LF` : undefined,
].filter(Boolean);
console.log(`  ${relative(root, infile)}: ${notes.join(", ")}`);
