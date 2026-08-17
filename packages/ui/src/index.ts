import { Map0Viewer } from "./map0-viewer.js";
import type { Map0Config } from "@map0/schema";

/**
 * Register `<map0-viewer>`. Called automatically on import in a browser; export-
 * ed so SSR/prerender consumers can decide *when* (e.g. in a client-only effect)
 * and under which tag name the element is defined. Registering twice is a no-op.
 */
export function defineMap0Viewer(tag = "map0-viewer"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  customElements.define(tag, Map0Viewer);
}

/* importing the package on a server must not throw — there are no custom
   elements there, and the viewer is only ever created on the client */
defineMap0Viewer();

/** Imperative bootstrap for SPAs/wrappers: creates a <map0-viewer> inside `target`. */
export function createMap(target: HTMLElement, config: Map0Config): Map0Viewer {
  defineMap0Viewer();
  const el = document.createElement("map0-viewer") as Map0Viewer;
  el.config = config;
  el.style.height = el.style.height || "100%";
  target.appendChild(el);
  return el;
}

export { Map0Viewer };
export type { Map0Config };
export * from "@map0/schema";

declare global {
  interface HTMLElementTagNameMap {
    "map0-viewer": Map0Viewer;
  }
}
