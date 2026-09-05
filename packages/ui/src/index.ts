import { Map0Viewer as Map0ViewerClass } from "./map0-viewer.js";
import type { Map0ViewerConstructor, Map0ViewerElement } from "./element.js";
import type { Map0Config } from "@map0/schema";

/**
 * Register `<map0-viewer>`. Called automatically on import in a browser; export-
 * ed so SSR/prerender consumers can decide *when* (e.g. in a client-only effect)
 * and under which tag name the element is defined. Registering twice is a no-op.
 */
export function defineMap0Viewer(tag = "map0-viewer"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  customElements.define(tag, Map0ViewerClass);
}

/* importing the package on a server must not throw — there are no custom
   elements there, and the viewer is only ever created on the client */
defineMap0Viewer();

/** Imperative bootstrap for SPAs/wrappers: creates a <map0-viewer> inside `target`. */
export function createMap(target: HTMLElement, config: Map0Config): Map0Viewer {
  defineMap0Viewer();
  const el = document.createElement("map0-viewer");
  el.config = config;
  el.style.height = el.style.height || "100%";
  target.appendChild(el);
  return el;
}

/**
 * The element: a value for `new Map0Viewer()` / `instanceof`, and the type of
 * an instance. Published under its public contract (element.ts) rather than
 * the Lit class, so the type declarations do not depend on `lit`.
 */
export const Map0Viewer: Map0ViewerConstructor = Map0ViewerClass;
export type Map0Viewer = Map0ViewerElement;

/* the schema and the type-only surface, shared with the SSR entry */
export * from "./public.js";
