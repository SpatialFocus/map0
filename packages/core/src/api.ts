/**
 * The imperative API surface as consumers see it: interfaces, not the manager
 * classes behind them. `Map0Core` — and with it `Map0Api` in the published
 * declarations — is typed with these, and the classes `implement` them, so a
 * member missing here is a compile error there, not a silent drift.
 *
 * Two reasons for the indirection. The published `.d.ts` must not carry
 * `LayerManager`, `Signal` and friends: classes with private members are
 * compared by declaration, so two copies of the package's types (browser and
 * SSR entry in one project) would be incompatible, and every internal rename
 * would be a breaking change. And what is not in these interfaces is not
 * promised — `emit`, `mountAll`, the adapter registry stay ours to change.
 * scripts/build-types.mjs fails the build should a class leak anyway.
 */
import type { GroupLayerDef, LayerDef, NormalizedBasemap, NormalizedLayer } from "@map0/schema";
import type { LayerStatus } from "./adapters/types.js";
import type { CoreEvents } from "./events.js";
import type { LayerUIState } from "./layers.js";
import type { EventSubscriber, ReadonlySignal } from "./signals.js";

/** listen to core events — emitting them is the core's business */
export type Map0Events = EventSubscriber<CoreEvents>;

/** one mounted layer: its normalized definition and the MapLibre ids it owns */
export interface LayerHandle {
  readonly def: NormalizedLayer;
  /** "loading" until the source reports data, then "ready" — or "error" */
  readonly status: ReadonlySignal<LayerStatus>;
  readonly sourceIds: readonly string[];
  readonly layerIds: readonly string[];
  /** [west, south, east, north] when the layer knows its extent */
  bounds(): Promise<[number, number, number, number] | null>;
}

export interface Map0Layers {
  /** every layer as the layer panel sees it, top-most first */
  readonly state: ReadonlySignal<LayerUIState[]>;
  /** every mounted layer, top-most first */
  readonly all: readonly LayerHandle[];
  /** add a (non-group) layer at runtime — its id, or null when mounting failed */
  addLayer(def: Exclude<LayerDef, GroupLayerDef>): Promise<string | null>;
  /** remove a runtime-added layer; configured layers stay */
  removeLayer(id: string): boolean;
  setVisibility(id: string, visible: boolean): void;
  /** 0..1 */
  setOpacity(id: string, opacity: number): void;
  /** fit the map to the layer's extent; false when no bounds are known */
  zoomTo(id: string): Promise<boolean>;
}

export interface Map0Basemaps {
  /** id of the active basemap */
  readonly current: ReadonlySignal<string>;
  readonly all: readonly NormalizedBasemap[];
  switchTo(id: string): Promise<void>;
}
