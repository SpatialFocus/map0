/**
 * SSR-safe entry (`map0-viewer/ssr`, built as `map0-ssr.js`).
 *
 * The default entry is a browser entry: it defines a custom element, so
 * evaluating it needs `HTMLElement` — importing it in Node (Next.js, Nuxt,
 * Astro, any prerender step) throws before a single line of map0 runs. Guarding
 * the `customElements.define` call cannot help, because the class declaration
 * itself is evaluated on import.
 *
 * This module imports nothing from the DOM side. It carries the schema (config
 * types, validation, normalization — all useful on a server) and hands out the
 * viewer through `import()`, which only ever runs in a browser. Bundlers keep
 * the browser chunk out of the server build entirely.
 *
 * ```ts
 * import { defineMap0Viewer, validateConfig } from "map0-viewer/ssr";
 * // server: validate the config while rendering
 * // client: await defineMap0Viewer() in an effect, then render <map0-viewer>
 * ```
 */
import type { Map0Config } from "@map0/schema";
import type { Map0Viewer } from "./map0-viewer.js";

export * from "@map0/schema";
export type { Map0Viewer };

/** true in a browser, false wherever custom elements do not exist */
export function canDefineElements(): boolean {
  return typeof HTMLElement !== "undefined" && typeof customElements !== "undefined";
}

/**
 * Register `<map0-viewer>` when there is a DOM to register it in. Returns false
 * on a server instead of throwing, so the same code path can run in both.
 */
export async function defineMap0Viewer(tag = "map0-viewer"): Promise<boolean> {
  if (!canDefineElements()) return false;
  const browser = await import("./index.js");
  browser.defineMap0Viewer(tag);
  return true;
}

/** Imperative bootstrap, client-only: creates a `<map0-viewer>` inside `target`. */
export async function createMap(target: HTMLElement, config: Map0Config): Promise<Map0Viewer> {
  const browser = await import("./index.js");
  return browser.createMap(target, config);
}
