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
import type { Feature, Geometry } from "geojson";
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
  /** switching a layer of an exclusive group on switches the group's other options off */
  setVisibility(id: string, visible: boolean): void;
  /** 0..1 */
  setOpacity(id: string, opacity: number): void;
  /** fit the map to the layer's extent; false when no bounds are known */
  zoomTo(id: string): Promise<boolean>;
  /**
   * Filter what a layer draws, without touching the MapLibre layer ids map0
   * generates. The filter goes on every style layer of the layer, or only on
   * the one whose `id` in the config's `style` array is `options.styleLayer`.
   * It is combined with the style layer's own filter (`["all", own, filter]`)
   * unless `options.replace` is set; `null` restores the own filter.
   *
   * false when the layer is unknown, draws no style layers of its own (wms,
   * wmts, raster, cog), `styleLayer` names none of them, or MapLibre rejects
   * the filter — its reason then goes out as an `error` event.
   */
  setFilter(id: string, filter: LayerFilter | null, options?: LayerFilterOptions): boolean;
  /**
   * Read one tile of a `vector` layer, decoded: the tile at `query.zoom` that
   * contains `query.lngLat`, typically to read attributes from a finer zoom
   * level than the map shows. A PMTiles archive is read through the instance
   * the map already opened, so its header and directories are not fetched a
   * second time; tile templates and TileJSON sources are fetched (usually from
   * the HTTP cache, when the map drew the same tile).
   *
   * null when the layer is unknown or not a `vector` layer; a tile the source
   * does not have comes back with no features. Rejects when the tile cannot be
   * fetched or is not a Mapbox Vector Tile.
   */
  getTile(id: string, query: TileQuery): Promise<TileResult | null>;
}

/**
 * A MapLibre filter expression — what maplibre-gl types as `FilterSpecification`.
 * Typed loosely, so the declarations do not depend on maplibre-gl; MapLibre
 * validates it when it is set. Combined with a style layer's own filter, both
 * must use expression syntax (`["get", "key"]`), not the legacy one.
 */
export type LayerFilter = boolean | readonly unknown[];

export interface LayerFilterOptions {
  /** only the style layer with this `id` in the layer's `style` array (default: all of them) */
  styleLayer?: string;
  /**
   * replace the style layer's own filter — the one in the config, or the one
   * map0 gives its default GeoJSON styling — instead of combining with it
   */
  replace?: boolean;
}

export interface TileQuery {
  /**
   * zoom level of the tile; rounded down, and capped to the zoom range the
   * source has tiles for (a PMTiles archive's or a TileJSON's min/maxzoom)
   */
  zoom: number;
  /** a position inside the tile — [lng, lat], or a MapLibre `LngLat` such as a click's `e.lngLat` */
  lngLat: readonly [number, number] | { readonly lng: number; readonly lat: number };
  /** only the features of this source layer (default: every source layer in the tile) */
  sourceLayer?: string;
  /** false skips converting coordinates: every feature comes with `geometry: null` (default true) */
  geometry?: boolean;
}

/** a feature of a vector tile, coordinates in WGS84 */
export interface TileFeature extends Feature<Geometry | null> {
  /** the source layer of the tile the feature is in */
  sourceLayer: string;
}

export interface TileResult {
  /** the tile that was read — `z` after capping */
  z: number;
  x: number;
  y: number;
  features: TileFeature[];
}

export interface Map0Basemaps {
  /** id of the active basemap */
  readonly current: ReadonlySignal<string>;
  readonly all: readonly NormalizedBasemap[];
  switchTo(id: string): Promise<void>;
}
