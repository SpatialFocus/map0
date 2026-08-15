/** Registry of all demo pages — the single source of truth for gallery and nav. */

export interface Demo {
  id: string;
  title: string;
  blurb: string;
  group: "Data sources" | "Map features" | "Configuration" | "Integration";
  icon: string;
}

export const DEMOS: Demo[] = [
  {
    id: "wms",
    title: "WMS",
    blurb: "Raster map services with GetFeatureInfo popups and GetLegendGraphic legends.",
    group: "Data sources",
    icon: "🗺️",
  },
  {
    id: "wmts",
    title: "WMTS",
    blurb: "Tiled services resolved straight from GetCapabilities — matrix set, style and mirrors.",
    group: "Data sources",
    icon: "🧱",
  },
  {
    id: "vector-tiles",
    title: "Vector tiles",
    blurb: "MVT overlays styled with the MapLibre style spec; PMTiles works the same way.",
    group: "Data sources",
    icon: "🔺",
  },
  {
    id: "geojson",
    title: "GeoJSON & clustering",
    blurb: "Remote and inline GeoJSON, simplified styling and built-in point clustering.",
    group: "Data sources",
    icon: "💧",
  },
  {
    id: "popups",
    title: "Popups & hover",
    blurb: "Templates, field tables, hover tooltips, selection highlight and multi-layer hits.",
    group: "Map features",
    icon: "💬",
  },
  {
    id: "legend",
    title: "Legend",
    blurb: "Service legends, swatches derived from the style, and hand-written legend entries.",
    group: "Map features",
    icon: "📊",
  },
  {
    id: "search",
    title: "Search",
    blurb: "Type-ahead place and address search, with any gazetteer behind it.",
    group: "Map features",
    icon: "🔍",
  },
  {
    id: "coordinates",
    title: "Coordinates",
    blurb: "Right-click readout in WGS 84, Gauss-Krueger and UTM — with copy buttons.",
    group: "Map features",
    icon: "📐",
  },
  {
    id: "print",
    title: "Print & export",
    blurb: "High-resolution PNG export and a print view with title, legend and scale bar.",
    group: "Map features",
    icon: "🖨️",
  },
  {
    id: "add-layer",
    title: "Add layers",
    blurb: "Users paste a WMS or WMTS URL; capabilities are parsed in the browser.",
    group: "Map features",
    icon: "➕",
  },
  {
    id: "permalink",
    title: "Share & permalink",
    blurb: "The full map state travels in the URL — view, basemap, layers, added services.",
    group: "Map features",
    icon: "🔗",
  },
  {
    id: "globe",
    title: "Globe",
    blurb: "MapLibre's globe projection, one config key and a control away.",
    group: "Map features",
    icon: "🌍",
  },
  {
    id: "minimal",
    title: "Minimal config",
    blurb: "The contract: a version and one basemap must already give you a usable map.",
    group: "Configuration",
    icon: "🧪",
  },
  {
    id: "theming",
    title: "Theming",
    blurb: "Design tokens from config or host CSS, light/dark, and runtime restyling.",
    group: "Configuration",
    icon: "🎨",
  },
  {
    id: "i18n",
    title: "Languages",
    blurb: "Built-in German and English UI plus per-locale string overrides from config.",
    group: "Configuration",
    icon: "🌐",
  },
  {
    id: "extends",
    title: "Config inheritance",
    blurb: "One shared organisation base config, per-map deltas via extends.",
    group: "Configuration",
    icon: "🧬",
  },
  {
    id: "standalone",
    title: "Script tag embed",
    blurb: "The built bundle on a plain HTML page — no bundler, no framework.",
    group: "Integration",
    icon: "📦",
  },
  {
    id: "lazy",
    title: "Lazy loading",
    blurb: "A map below the fold costs 20 KB until someone scrolls to it.",
    group: "Integration",
    icon: "🪶",
  },
];

export const GROUPS: Array<Demo["group"]> = [
  "Data sources",
  "Map features",
  "Configuration",
  "Integration",
];

export function demoById(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
