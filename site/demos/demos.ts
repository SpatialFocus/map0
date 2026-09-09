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
    blurb: "WMTS services configured from capabilities, including matrix sets, styles and tile hosts.",
    blurbDe: "WMTS-Dienste aus Capabilities konfigurieren, einschließlich Matrix-Sets, Styles und Kachel-Hosts.",
    group: "Data sources",
    icon: "🧱",
  },
  {
    id: "wfs",
    title: "WFS",
    blurb: "Vector data from a Web Feature Service, loaded as GeoJSON with WFS 2.0 paging.",
    blurbDe: "Vektordaten aus einem Web Feature Service, als GeoJSON und mit seitenweisem Laden für WFS 2.0.",
    group: "Data sources",
    icon: "🚰",
  },
  {
    id: "ogcapi-features",
    title: "OGC API Features",
    blurb: "Load a collection as GeoJSON and follow next links for subsequent pages.",
    blurbDe: "Eine Collection als GeoJSON laden und weitere Ergebnisseiten über next-Links abrufen.",
    group: "Data sources",
    icon: "🛤️",
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
    id: "geoparquet",
    title: "GeoParquet",
    blurb: "Compressed vector data from a GeoParquet file, decoded in the browser.",
    blurbDe: "Komprimierte Vektordaten aus einer GeoParquet-Datei, im Browser dekodiert.",
    group: "Data sources",
    icon: "🗜️",
  },
  {
    id: "cog",
    title: "Cloud Optimized GeoTIFF",
    blurb: "Imagery, elevation and classified raster values loaded from static storage.",
    blurbDe: "Bilddaten, Höhenmodelle und klassifizierte Rasterwerte aus statischem Speicher laden.",
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
    blurbDe: "Orts- und Adresssuche mit Vorschlägen und einem konfigurierbaren Suchanbieter.",
    group: "Map features",
    icon: "🔍",
  },
  {
    id: "coordinates",
    title: "Coordinates",
    titleDe: "Koordinaten",
    blurb: "Display and copy WGS84, Gauß-Krüger and UTM coordinates with a right-click.",
    blurbDe: "Koordinaten in WGS84, Gauß-Krüger und UTM per Rechtsklick anzeigen und kopieren.",
    group: "Map features",
    icon: "📐",
  },
  {
    id: "measure",
    title: "Measure",
    titleDe: "Messen",
    blurb: "Measure distances and areas with movable vertices.",
    blurbDe: "Strecken und Flächen mit verschiebbaren Stützpunkten messen.",
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
    blurb: "Add service and GeoJSON URLs or import local GeoJSON, KML and GPX files.",
    blurbDe: "Dienst- und GeoJSON-URLs hinzufügen oder lokale GeoJSON-, KML- und GPX-Dateien importieren.",
    group: "Map features",
    icon: "➕",
  },
  {
    id: "permalink",
    title: "Share & permalink",
    titleDe: "Teilen & Permalink",
    blurb: "Share the view, basemap, layer settings and added services through a URL.",
    blurbDe: "Ausschnitt, Hintergrundkarte, Layer-Einstellungen und hinzugefügte Dienste per URL teilen.",
    group: "Map features",
    icon: "🔗",
  },
  {
    id: "globe",
    title: "Globe",
    titleDe: "Globus",
    blurb: "MapLibre's globe projection, one config key and a control away.",
    blurbDe: "MapLibres Globusprojektion konfigurieren und die Ansicht per Schaltfläche wechseln.",
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
    blurb: "Validate a config online and learn about checks in the editor, build pipeline and viewer.",
    blurbDe: "Eine Konfiguration online prüfen und weitere Prüfungen im Editor, Build und Viewer kennenlernen.",
    group: "Configuration",
    icon: "✅",
  },
  {
    id: "standalone",
    title: "Script tag embed",
    titleDe: "Script-Tag-Einbindung",
    blurb: "Embed the built package in a plain HTML page.",
    blurbDe: "Das fertig gebaute Paket in eine einfache HTML-Seite einbinden.",
    group: "Integration",
    icon: "📦",
  },
  {
    id: "lazy",
    title: "Lazy loading",
    titleDe: "Lazy Loading",
    /* No figure here on purpose: the gallery is rendered at runtime, so the
       build-time number fill (see fillNumbers in i18n/plugin.ts) cannot reach
       this string — and a typed one drifts, as "20 KB" did while the page it
       links to had moved on to 31. The measured figures live on that page. */
    blurb: "A map below the fold costs only the custom element until someone scrolls to it.",
    blurbDe:
      "Karten erst beim Heranscrollen laden und den anfänglichen Download klein halten.",
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
