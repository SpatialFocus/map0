/**
 * Runs e2e/visual.mjs inside Microsoft's Playwright image — the Linux baselines
 * CI compares against, produced on any machine with Docker (N9):
 *
 *   pnpm build && pnpm visual:linux --update [scene …]
 *
 * The image tag follows the installed playwright version, so the browser build
 * is the one CI installs. The repo is mounted at /work with node_modules masked
 * by an empty volume (pnpm's links from another OS do not resolve in Linux);
 * the script's few dependencies are installed elsewhere and linked in as
 * /node_modules, where Node's module resolution walks up to them (npm refuses
 * to install into / itself).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = (name) =>
  JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"))
    .version;

const deps = ["playwright", "pixelmatch", "pngjs", "@fontsource-variable/inter"].map(
  (name) => `${name}@${version(name)}`,
);
const image = `mcr.microsoft.com/playwright:v${version("playwright")}-noble`;
const args = process.argv.slice(2).filter((a) => /^[\w-]+$/.test(a.replace(/^--/, "")));

const script = [
  `npm install --prefix /opt/visual --no-save --no-package-lock --no-audit --no-fund --no-update-notifier --loglevel=error ${deps.join(" ")}`,
  "ln -s /opt/visual/node_modules /node_modules",
  `node e2e/visual.mjs ${args.join(" ")}`,
].join(" && ");

console.log(`visual regression in ${image}`);
const run = spawnSync(
  "docker",
  ["run", "--rm", "-v", `${root}:/work`, "-v", "/work/node_modules", "-w", "/work", image, "sh", "-c", script],
  { stdio: "inherit" },
);
if (run.error) {
  console.error(`docker could not be started: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
