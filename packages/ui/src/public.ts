/**
 * What both entries export besides their own functions: the config schema
 * (values and types) and the type-only surface a host page meets — the element
 * contract and the core types reachable through `api` and the events.
 *
 * One module, so the browser and the SSR entry cannot drift apart, and so the
 * published declarations carry it once: scripts/build-types.mjs bundles this
 * file into dist/map0-types.d.ts and points both entry declarations at it.
 */
export * from "@map0/schema";
export type {
  Map0Api,
  Map0ViewerConstructor,
  Map0ViewerElement,
  Map0ViewerEventDetails,
  Map0ViewerEventMap,
} from "./element.js";
export type { CoreEvents, FeatureInfoResult, LayerUIState, SearchResult } from "@map0/core";
