/** Registry of all demo pages — the single source of truth for gallery and nav. */

export interface Demo {
  id: string;
  title: string;
  /** German title — omitted where the English one is a proper name anyway */
  titleDe?: string;
  blurb: string;
  blurbDe: string;
  group: "Data sources" | "Map features" | "Configuration" | "Integration";
  icon: string;
}

export const DEMOS: Demo[] = [
  {
    id: "wms",
    title: "WMS",
    blurb: "Raster map services with GetFeatureInfo popups and GetLegendGraphic legends.",
    blurbDe: "Raster-Kartendienste mit GetFeatureInfo-Popups und GetLegendGraphic-Legenden.",
    group: "Data sources",
    icon: "🗺️",
  },
  {
    id: "wmts",
    title: "WMTS",
    blurb: "Tiled services resolved straight from GetCapabilities — matrix set, style and mirrors.",
    blurbDe: "Kacheldienste direkt aus den GetCapabilities aufgelöst — Matrix-Set, Style und Mirrors.",
    group: "Data sources",
    icon: "🧱",
  },
  {
    id: "vector-tiles",
    title: "Vector tiles",
    titleDe: "Vector Tiles",
    blurb: "MVT overlays styled with the MapLibre style spec; PMTiles works the same way.",
    blurbDe: "MVT-Overlays, gestylt mit der MapLibre-Style-Spezifikation; PMTiles funktioniert genauso.",
    group: "Data sources",
    icon: "🔺",
  },
  {
    id: "geojson",
    title: "GeoJSON & clustering",
    titleDe: "GeoJSON & Clustering",
    blurb: "Remote and inline GeoJSON, simplified styling and built-in point clustering.",
    blurbDe: "Externes und eingebettetes GeoJSON, vereinfachtes Styling und eingebautes Punkt-Clustering.",
    group: "Data sources",
    icon: "💧",
  },
  {
    id: "cog",
    title: "Cloud Optimized GeoTIFF",
    blurb: "Rasters read straight from static storage — imagery, terrain and classified values.",
    blurbDe: "Raster direkt aus statischem Speicher gelesen — Orthofoto, Gelände und klassifizierte Werte.",
    group: "Data sources",
    icon: "🛰️",
  },
  {
    id: "popups",
    title: "Popups & hover",
    titleDe: "Popups & Hover",
    blurb: "Templates, field tables, hover tooltips, selection highlight and multi-layer hits.",
    blurbDe: "Templates, Attributtabellen, Hover-Tooltips, Hervorhebung und Treffer über mehrere Layer.",
    group: "Map features",
    icon: "💬",
  },
  {
    id: "legend",
    title: "Legend",
    titleDe: "Legende",
    blurb: "Service legends, swatches derived from the style, and hand-written legend entries.",
    blurbDe: "Dienst-Legenden, aus dem Style abgeleitete Farbfelder und handgeschriebene Einträge.",
    group: "Map features",
    icon: "📊",
  },
  {
    id: "search",
    title: "Search",
    titleDe: "Suche",
    blurb: "Type-ahead place and address search, with any gazetteer behind it.",
    blurbDe: "Orts- und Adresssuche mit Vorschlägen — dahinter ein Gazetteer Ihrer Wahl.",
    group: "Map features",
    icon: "🔍",
  },
  {
    id: "coordinates",
    title: "Coordinates",
    titleDe: "Koordinaten",
    blurb: "Right-click readout in WGS 84, Gauss-Krueger and UTM — with copy buttons.",
    blurbDe: "Rechtsklick-Anzeige in WGS 84, Gauß-Krüger und UTM — mit Kopier-Buttons.",
    group: "Map features",
    icon: "📐",
  },
  {
    id: "measure",
    title: "Measure",
    titleDe: "Messen",
    blurb: "Distance and area on the sphere — click, drag a vertex, double-click.",
    blurbDe: "Strecke und Fläche auf der Kugel — klicken, Stützpunkt ziehen, Doppelklick.",
    group: "Map features",
    icon: "📏",
  },
  {
    id: "print",
    title: "Print & export",
    titleDe: "Drucken & Export",
    blurb: "High-resolution PNG export and a print view with title, legend and scale bar.",
    blurbDe: "Hochauflösender PNG-Export und eine Druckansicht mit Titel, Legende und Maßstab.",
    group: "Map features",
    icon: "🖨️",
  },
  {
    id: "add-layer",
    title: "Add layers",
    titleDe: "Layer hinzufügen",
    blurb: "Users paste a WMS or WMTS URL; capabilities are parsed in the browser.",
    blurbDe: "Eine WMS- oder WMTS-URL genügt; die Capabilities werden im Browser geparst.",
    group: "Map features",
    icon: "➕",
  },
  {
    id: "permalink",
    title: "Share & permalink",
    titleDe: "Teilen & Permalink",
    blurb: "The full map state travels in the URL — view, basemap, layers, added services.",
    blurbDe: "Der komplette Kartenzustand steckt in der URL — Ausschnitt, Hintergrund, Layer, Dienste.",
    group: "Map features",
    icon: "🔗",
  },
  {
    id: "globe",
    title: "Globe",
    titleDe: "Globus",
    blurb: "MapLibre's globe projection, one config key and a control away.",
    blurbDe: "MapLibres Globus-Projektion — nur einen Config-Schlüssel und ein Control entfernt.",
    group: "Map features",
    icon: "🌍",
  },
  {
    id: "minimal",
    title: "Minimal config",
    titleDe: "Minimale Config",
    blurb: "The contract: a version and one basemap must already give you a usable map.",
    blurbDe: "Die Garantie: Version plus eine Basemap ergeben bereits eine brauchbare Karte.",
    group: "Configuration",
    icon: "🧪",
  },
  {
    id: "theming",
    title: "Theming",
    blurb: "Design tokens from config or host CSS, light/dark, and runtime restyling.",
    blurbDe: "Design-Tokens aus Config oder Host-CSS, Hell/Dunkel und Umstylen zur Laufzeit.",
    group: "Configuration",
    icon: "🎨",
  },
  {
    id: "i18n",
    title: "Languages",
    titleDe: "Sprachen",
    blurb: "Built-in German and English UI plus per-locale string overrides from config.",
    blurbDe: "Deutsche und englische UI eingebaut, plus String-Overrides je Sprache aus der Config.",
    group: "Configuration",
    icon: "🌐",
  },
  {
    id: "extends",
    title: "Config inheritance",
    titleDe: "Config-Vererbung",
    blurb: "One shared organisation base config, per-map deltas via extends.",
    blurbDe: "Eine gemeinsame Basis-Config der Organisation, Abweichungen je Karte via extends.",
    group: "Configuration",
    icon: "🧬",
  },
  {
    id: "validate",
    title: "Validate a config",
    titleDe: "Config validieren",
    blurb: "Paste a config and run map0's validator online — plus every other place a config is checked.",
    blurbDe: "Config einfügen und direkt online validieren — plus ein Überblick über alle anderen Prüfstellen.",
    group: "Configuration",
    icon: "✅",
  },
  {
    id: "standalone",
    title: "Script tag embed",
    titleDe: "Script-Tag-Einbindung",
    blurb: "The built bundle on a plain HTML page — no bundler, no framework.",
    blurbDe: "Das gebaute Bundle auf einer einfachen HTML-Seite — ohne Bundler, ohne Framework.",
    group: "Integration",
    icon: "📦",
  },
  {
    id: "lazy",
    title: "Lazy loading",
    titleDe: "Lazy Loading",
    blurb: "A map below the fold costs 20 KB until someone scrolls to it.",
    blurbDe: "Eine Karte unterhalb des sichtbaren Bereichs kostet 20 KB — bis jemand hinscrollt.",
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

export const GROUP_LABELS_DE: Record<Demo["group"], string> = {
  "Data sources": "Datenquellen",
  "Map features": "Kartenfunktionen",
  Configuration: "Konfiguration",
  Integration: "Integration",
};

export function demoById(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
