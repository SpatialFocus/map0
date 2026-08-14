import { Map0Viewer } from "./map0-viewer.js";
if (!customElements.get("map0-viewer")) {
    customElements.define("map0-viewer", Map0Viewer);
}
/** Imperative bootstrap for SPAs/wrappers: creates a <map0-viewer> inside `target`. */
export function createMap(target, config) {
    const el = document.createElement("map0-viewer");
    el.config = config;
    el.style.height = el.style.height || "100%";
    target.appendChild(el);
    return el;
}
export { Map0Viewer };
export * from "@map0/schema";
//# sourceMappingURL=index.js.map