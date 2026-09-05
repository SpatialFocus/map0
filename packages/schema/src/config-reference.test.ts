/**
 * docs/config-reference.md is generated from v1.json by scripts/config-reference.mjs
 * and committed, so it can be read on GitHub without a build step. This test keeps
 * the committed page in step with the schema: change a description in v1.json and
 * it fails until `pnpm docs:reference` has been run — the same guard the validator
 * tables have in v1-schema.test.ts, one level up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateConfigReference, readCommitted } from "../../../scripts/config-reference.mjs";

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL("../v1.json", import.meta.url)), "utf8"),
) as Record<string, any>;

/** every `description` in the schema, wherever it sits */
function descriptions(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) descriptions(item, out);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "description" && typeof value === "string") out.push(value);
      else descriptions(value, out);
    }
  }
  return out;
}

describe("docs/config-reference.md", () => {
  it("is generated from the current v1.json — run `pnpm docs:reference` to regenerate", () => {
    const generated = generateConfigReference(schema);
    expect(
      readCommitted(),
      "docs/config-reference.md is stale: run `pnpm docs:reference` and commit the result",
    ).toBe(generated);
  });

  it("is deterministic", () => {
    expect(generateConfigReference(schema)).toBe(generateConfigReference(schema));
  });

  it("carries every description from the schema", () => {
    /* table cells escape a few characters as entities; undo that before comparing */
    const page = generateConfigReference(schema)
      .replaceAll("&#42;", "*")
      .replaceAll("&#124;", "|")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
    const all = descriptions(schema);
    expect(all.length).toBeGreaterThan(100);
    for (const text of all) expect(page, `description missing from the page: ${text}`).toContain(text);
  });

  it("links every section it lists in the table of contents", () => {
    const page = generateConfigReference(schema);
    const anchors = new Set(
      [...page.matchAll(/^## (.+)$/gm)].map((m) =>
        m[1]!.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ +/g, "-"),
      ),
    );
    const links = [...page.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const target of links) expect(anchors, `dangling link #${target}`).toContain(target);
  });
});
