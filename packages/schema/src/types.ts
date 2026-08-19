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
  search?: SearchConfig;
  print?: PrintConfig;
  theme?: ThemeConfig;
  i18n?: I18nConfig;
  /**
   * shareable map state in the URL hash (F10.1); opt-in — the host page may use
   * its own hash routing. `true` uses the param name "map0". Supersedes map.hash.
   */
  permalink?: boolean | { param?: string };
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
  | CogLayerDef
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

/** single-band value → color mapping for a "cog" layer */
export interface CogColorDef {
  /** built-in ramp name (ColorBrewer/CARTOColors), e.g. "BrewerSpectral7" or "CartoEarth" */
  scheme: string;
  /** data value mapped to the first ramp color */
  min: number;
  /** data value mapped to the last ramp color */
  max: number;
  /** interpolate between the ramp colors instead of discrete classes; default false */
  continuous?: boolean;
  /** reverse the ramp; default false */
  reverse?: boolean;
}

/** hillshade rendering options for a "cog" DEM layer (MapLibre hillshade paint) */
export interface CogHillshadeDef {
  /** shading intensity 0..1; default 0.5 (also scaled by the layer's opacity) */
  exaggeration?: number;
  /** light azimuth in degrees clockwise from north; default 335 */
  illuminationDirection?: number;
  /** CSS colors */
  shadowColor?: string;
  highlightColor?: string;
  accentColor?: string;
}

export interface CogLayerDef extends LayerCommon {
  type: "cog";
  /** Cloud Optimized GeoTIFF URL — must be in EPSG:3857 (no client-side reprojection) */
  url: string;
  /** omit for RGB/grayscale imagery; set to render a single band through a color ramp */
  color?: CogColorDef;
  /** render a single-band DEM as hillshading (mutually exclusive with `color`) */
  hillshade?: boolean | CogHillshadeDef;
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
  /** measure distance and area (F9.1); default true */
  measure?: boolean;
  /**
   * coordinate readout on right-click/long-press (F5.6); default true.
   * Default CRS list: WGS 84 + matching Austrian GK strip + matching UTM zone;
   * override with explicit codes (custom CRS need a proj4 "def").
   */
  coordinates?: boolean | { crs?: Array<{ code: string; label?: string; def?: string }> };
}

/* -------------------------------- theming ------------------------------- */

export interface ThemeConfig {
  mode?: "auto" | "light" | "dark";
  /** CSS color */
  primary?: string;
  radius?: "none" | "sm" | "md" | "lg";
  font?: string;
}

/** custom geocoder: a URL template plus the shape of its answer */
export interface CustomGeocoderDef {
  /** placeholders: {query} {limit} {lang} {bbox} {lng} {lat} */
  url: string;
  /** "geojson" = FeatureCollection of points (Photon-like) · "nominatim" = array of results */
  format?: "geojson" | "nominatim";
  /** property to use as the result label (geojson only; default: name/label/title) */
  labelField?: string;
}

export interface SearchConfig {
  /** false disables the search box; default is enabled when a `search` key exists */
  enabled?: boolean;
  provider?: "photon" | "nominatim" | CustomGeocoderDef;
  /** override the service instance (self-hosted Photon/Nominatim) */
  url?: string;
  /** ISO country code to restrict results to, e.g. "AT" */
  country?: string;
  /** bias results toward the current view; false disables */
  bias?: boolean;
  limit?: number;
  minLength?: number;
  placeholder?: string;
  /** accept "48.2083, 16.3725" as input (F8.2) */
  coordinates?: boolean;
}

export type PaperSizeName =
  | "current"
  | "A4-landscape"
  | "A4-portrait"
  | "A3-landscape"
  | "A3-portrait";

/** what the print dialog offers (F7); `controls.print` switches the dialog on and off */
export interface PrintConfig {
  /** download buttons to show; the browser print view is always available */
  formats?: Array<"png" | "pdf">;
  sizes?: PaperSizeName[];
  dpi?: number[];
  /** which parts the composed sheet contains */
  elements?: Array<"title" | "legend" | "scalebar" | "attribution" | "date">;
}

export interface I18nConfig {
  /** BCP47 or "auto" */
  locale?: string;
  fallback?: string;
  /** per-locale UI string overrides, e.g. { "de": { "layers.title": "Kartenthemen" } } (F11.2) */
  overrides?: Record<string, Record<string, string>>;
}
