/**
 * map0 configuration types — schema v0 (draft).
 * Shapes follow docs/04-configuration.md; v0 covers the M0 spike subset.
 */
import type { FeatureCollection, Feature, Geometry } from "geojson";

export type Map0Version = 1;

export interface Map0Config {
  $schema?: string;
  version: Map0Version;
  extends?: string;
  meta?: MetaConfig;
  map?: MapConfig;
  basemaps: BasemapDef[];
  layers?: LayerDef[];
  controls?: ControlsConfig;
  theme?: ThemeConfig;
  i18n?: I18nConfig;
}

export interface MetaConfig {
  title?: string;
  description?: string;
}

export interface MapConfig {
  /** [lon, lat] in WGS84 */
  center?: [number, number];
  zoom?: number;
  /** [west, south, east, north] — wins over center/zoom when set */
  bounds?: [number, number, number, number];
  minZoom?: number;
  maxZoom?: number;
  maxBounds?: [number, number, number, number];
  bearing?: number;
  pitch?: number;
  projection?: "mercator" | "globe";
  /** opt-in URL-hash view sync (may clash with host-page routing) */
  hash?: boolean;
}

/* ------------------------------- basemaps ------------------------------- */

export type BasemapType = "style" | "raster" | "empty";

export interface BasemapDef {
  id?: string;
  title?: string;
  type: BasemapType;
  /** style: MapLibre style URL · raster: XYZ/WMTS-REST template */
  url?: string;
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
  thumbnail?: string;
  default?: boolean;
}

/* -------------------------------- layers -------------------------------- */

export type LayerDef =
  | GroupLayerDef
  | WmsLayerDef
  | WmtsLayerDef
  | RasterLayerDef
  | GeoJsonLayerDef
  | VectorLayerDef;

export type LayerType = LayerDef["type"];

export interface LegendEntryDef {
  label: string;
  /** CSS color for the swatch */
  color?: string;
  shape?: "square" | "line" | "circle";
  /** image URL instead of a color swatch */
  image?: string;
}

export interface LayerCommon {
  id?: string;
  title?: string;
  visible?: boolean;
  /** 0..1 */
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  /** [west, south, east, north] — used for "zoom to layer" (auto-filled from capabilities where possible) */
  bounds?: [number, number, number, number];
  attribution?: string;
  metadata?: { url?: string; title?: string };
  /**
   * "auto" (default): WMS GetLegendGraphic / swatches derived from the style ·
   * false: no legend · string: legend image URL · array: explicit entries
   */
  legend?: "auto" | false | string | LegendEntryDef[];
}

export interface GroupLayerDef {
  type: "group";
  title?: string;
  collapsed?: boolean;
  children: LayerDef[];
}

export interface FieldDef {
  key: string;
  label?: string;
}

export interface PopupConfig {
  /** template with {{property}} placeholders */
  title?: string;
  /** HTML template with {{property}} placeholders (sanitized before rendering) */
  content?: string;
  /** alternative to content: render listed properties as a table */
  fields?: FieldDef[];
  maxWidth?: string;
}

export interface WmsLayerDef extends LayerCommon {
  type: "wms";
  url: string;
  /** WMS LAYERS parameter (comma-separated) */
  layers: string;
  styles?: string;
  format?: string;
  version?: "1.1.1" | "1.3.0";
  transparent?: boolean;
  tileSize?: number;
  /** extra vendor parameters appended to GetMap/GetFeatureInfo */
  params?: Record<string, string>;
  /** presence enables GetFeatureInfo on click */
  info?: (PopupConfig & { format?: string }) | false;
}

export interface WmtsLayerDef extends LayerCommon {
  type: "wmts";
  /** WMTS GetCapabilities URL */
  url: string;
  /** layer identifier from the capabilities */
  layer: string;
  /** tile matrix set identifier; default: the first WebMercator-compatible one (D-02) */
  matrixSet?: string;
  /** style identifier; default: the layer's default style */
  style?: string;
  /** preferred tile format (e.g. "image/png") */
  format?: string;
}

export interface RasterLayerDef extends LayerCommon {
  type: "raster";
  /** XYZ/WMTS-REST template */
  url: string;
  tileSize?: number;
}

/** flat paint-property object (circle-*, line-*, fill-*) */
export type SimpleStyle = Record<string, unknown>;

/** full MapLibre style-spec layer objects (source/source-layer injected by map0) */
export type StyleLayerSpec = Record<string, unknown> & { type: string };

export interface GeoJsonLayerDef extends LayerCommon {
  type: "geojson";
  /** URL or inline GeoJSON */
  data: string | FeatureCollection | Feature | Geometry;
  style?: SimpleStyle | StyleLayerSpec[];
  cluster?: boolean | { enabled?: boolean; radius?: number; maxZoom?: number };
  popup?: PopupConfig | false;
  /** short tooltip template shown on hover (F5.4) */
  hover?: { content: string } | false;
  promoteId?: string;
}

export interface VectorLayerDef extends LayerCommon {
  type: "vector";
  /** TileJSON URL, {z}/{x}/{y} template, or pmtiles:// URL */
  url: string;
  sourceLayer?: string;
  style: StyleLayerSpec[];
  popup?: PopupConfig | false;
  /** short tooltip template shown on hover (F5.4) */
  hover?: { content: string } | false;
}

/* ------------------------------- controls ------------------------------- */

export type ControlPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface ControlsConfig {
  navigation?: boolean;
  scale?: boolean | { maxWidth?: number; unit?: "metric" | "imperial" };
  fullscreen?: boolean;
  geolocate?: boolean | { follow?: boolean };
  globe?: boolean;
  home?: boolean;
  attribution?: boolean | { compact?: boolean | "auto" };
  layerSwitcher?:
    | boolean
    | {
        position?: ControlPosition;
        open?: boolean | "auto";
        title?: string;
        /** show the "add layer by URL" dialog (F3.1); default true */
        allowAdd?: boolean;
      };
  basemapSwitcher?: boolean | { position?: ControlPosition };
  legend?: boolean | { position?: ControlPosition; open?: boolean };
  /** print & export dialog (F7); default true */
  print?: boolean;
}

/* -------------------------------- theming ------------------------------- */

export interface ThemeConfig {
  mode?: "auto" | "light" | "dark";
  /** CSS color */
  primary?: string;
  radius?: "none" | "sm" | "md" | "lg";
  font?: string;
}

export interface I18nConfig {
  /** BCP47 or "auto" */
  locale?: string;
  fallback?: string;
  /** per-locale UI string overrides, e.g. { "de": { "layers.title": "Kartenthemen" } } (F11.2) */
  overrides?: Record<string, Record<string, string>>;
}
