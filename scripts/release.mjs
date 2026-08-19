/**
 * `pnpm release` — runs release-it for the one publishable package.
 *
 * Two things this wrapper settles: release-it must run *in* packages/map0
 * (that package.json carries the published version; the root one is a private
 * 0.0.0), and the GitHub release needs a token — taken from the gh CLI's
 * keyring login when GITHUB_TOKEN is not already set, so nothing token-shaped
 * lives in a file. Arguments pass through (`pnpm release --dry-run`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

if (!process.env.GITHUB_TOKEN) {
  try {
    process.env.GITHUB_TOKEN = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    }).trim();
  } catch {
    console.error("✗ GITHUB_TOKEN is not set and `gh auth token` failed — run `gh auth login`");
    process.exit(1);
  }
}

const result = spawnSync("release-it", process.argv.slice(2), {
  cwd: join(root, "packages", "map0"),
  stdio: "inherit", // interactive: version prompt, npm OTP
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
