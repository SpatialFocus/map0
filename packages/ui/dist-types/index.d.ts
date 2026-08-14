import { Map0Viewer } from "./map0-viewer.js";
import type { Map0Config } from "@map0/schema";
/** Imperative bootstrap for SPAs/wrappers: creates a <map0-viewer> inside `target`. */
export declare function createMap(target: HTMLElement, config: Map0Config): Map0Viewer;
export { Map0Viewer };
export type { Map0Config };
export * from "@map0/schema";
declare global {
    interface HTMLElementTagNameMap {
        "map0-viewer": Map0Viewer;
    }
}
//# sourceMappingURL=index.d.ts.map