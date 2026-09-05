/**
 * The public contract of `<map0-viewer>` — what the published type declarations
 * describe, and all a host page needs.
 *
 * The element is a Lit component, but Lit is an implementation detail (see
 * docs/06-architecture.md): consumers see an `HTMLElement` with map0's
 * attributes, the `api` handle and typed `map0:*` events, not `LitElement`'s
 * update cycle. Keeping the contract an interface rather than the class also
 * keeps `lit` out of the type graph, so installing the package brings no type
 * dependency on it. The class implements this interface, so a member missing
 * here is a compile error there, not a silent drift. The `HTMLElementTagNameMap`
 * entry lives here too, so `document.querySelector("map0-viewer")` is typed
 * through either entry, browser or SSR.
 */
import type { FeatureInfoResult, Map0Core, SearchResult } from "@map0/core";
import type { Map0Config, ValidationError } from "@map0/schema";

/**
 * Imperative handle on a running map — `viewer.api`, the argument of
 * `map0:ready`, and what `createMap()` hands back after initialisation.
 * `api.map` is the MapLibre `Map` (install `maplibre-gl` for its types).
 */
export type Map0Api = Map0Core;

/** `detail` payloads of the events `<map0-viewer>` dispatches (all bubble and are composed) */
export interface Map0ViewerEventDetails {
  /** the map is up: layers mounted, `api` available */
  "map0:ready": { api: Map0Api };
  /** config validation failed (`errors`), or something went wrong on the map (`message`) */
  "map0:error":
    | { errors: ValidationError[] }
    | { message: string; layerId?: string; sourceId?: string; control?: "geolocate" };
  /** a click hit one or more queryable layers; the popup shows the same results */
  "map0:featureclick": { lngLat: [number, number]; results: FeatureInfoResult[] };
  /** the user picked a search result */
  "map0:search": { result: SearchResult };
}

/** the DOM event map of `<map0-viewer>`: its own events plus everything an HTMLElement fires */
export interface Map0ViewerEventMap extends HTMLElementEventMap {
  "map0:ready": CustomEvent<Map0ViewerEventDetails["map0:ready"]>;
  "map0:error": CustomEvent<Map0ViewerEventDetails["map0:error"]>;
  "map0:featureclick": CustomEvent<Map0ViewerEventDetails["map0:featureclick"]>;
  "map0:search": CustomEvent<Map0ViewerEventDetails["map0:search"]>;
}

/**
 * The `<map0-viewer>` element. Config sources in priority order: the `config`
 * property, the `config-src` attribute, an inline `<script type="application/json">`.
 */
export interface Map0ViewerElement extends HTMLElement {
  /** config object (wins over `config-src` and the inline script) */
  config?: Map0Config;
  /** URL of a config file — the `config-src` attribute */
  configSrc?: string;
  /**
   * When to start loading — mirrors `<img loading>`. `"lazy"` (default) waits
   * until the element is near the viewport; `"eager"` starts immediately.
   */
  loading: "lazy" | "eager";
  /**
   * Host-page override for the colour scheme: wins over the config's
   * `theme.mode`, and flipping it restyles a running map.
   */
  theme?: "light" | "dark";
  /** imperative access to the running map (available after `map0:ready`) */
  readonly api: Map0Api | undefined;
  /** start loading now, whatever `loading` says (tabs, accordions, tests) */
  load(): void;
  /** tear down and initialise again (e.g. after assigning a new config) */
  reload(): void;

  addEventListener<K extends keyof Map0ViewerEventMap>(
    type: K,
    listener: (this: Map0ViewerElement, ev: Map0ViewerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof Map0ViewerEventMap>(
    type: K,
    listener: (this: Map0ViewerElement, ev: Map0ViewerEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

/** the element class as consumers see it: `new Map0Viewer()`, `el instanceof Map0Viewer` */
export interface Map0ViewerConstructor {
  new (): Map0ViewerElement;
  readonly prototype: Map0ViewerElement;
}

declare global {
  interface HTMLElementTagNameMap {
    "map0-viewer": Map0ViewerElement;
  }
}
