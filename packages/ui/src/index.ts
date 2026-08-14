import { Map0Viewer } from "./map0-viewer.js";
import type { Map0Config } from "@map0/schema";

if (!customElements.get("map0-viewer")) {
  customElements.define("map0-viewer", Map0Viewer);
}

/** Imperative bootstrap for SPAs/wrappers: creates a <map0-viewer> inside `target`. */
export function createMap(target: HTMLElement, config: Map0Config): Map0Viewer {
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
