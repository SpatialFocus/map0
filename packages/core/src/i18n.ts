/** Tiny built-in i18n runtime. de + en ship in core; overrides come later (F11.2). */

const dictionaries: Record<string, Record<string, string>> = {
  en: {
    "layers.title": "Map layers",
    "layers.empty": "No overlays configured",
    "layers.metadata": "Dataset details",
    "layers.error": "Layer failed to load",
    "layers.opacity": "Opacity",
    "layers.zoomHintMin": "visible from zoom",
    "layers.zoomHintMax": "visible up to zoom",
    "layers.remove": "Remove layer",
    "layers.added": "Added layers",
    "addLayer.title": "Add layer",
    "addLayer.intro":
      "Paste a WMS URL. The service is queried directly in the browser (it must allow CORS).",
    "addLayer.load": "Load",
    "addLayer.loading": "Loading capabilities…",
    "addLayer.add": "Add",
    "addLayer.cancel": "Cancel",
    "addLayer.empty": "No layers found",
    "addLayer.failed": "Could not load the service",
    "addLayer.no3857": "no Web Mercator (EPSG:3857) declared — may not display",
    "print.title": "Print & export",
    "print.titleLabel": "Title",
    "print.size": "Size",
    "print.size.current": "Current view",
    "print.size.a4l": "A4 landscape",
    "print.size.a4p": "A4 portrait",
    "print.dpi": "Resolution",
    "print.includeLegend": "Include legend",
    "print.rendering": "Rendering map…",
    "print.failed": "Export failed",
    "print.png": "Download PNG",
    "print.print": "Print",
    "basemaps.title": "Basemap",
    "legend.title": "Legend",
    "popup.close": "Close",
    "popup.noInfo": "No information at this location",
    "popup.loading": "Loading feature info…",
    "popup.more": "more features",
    "error.title": "map0 configuration error",
    "error.intro": "The map could not start. Please fix the configuration:",
    "control.home": "Initial view",
  },
  de: {
    "layers.title": "Kartenebenen",
    "layers.empty": "Keine Overlays konfiguriert",
    "layers.metadata": "Datensatzdetails",
    "layers.error": "Ebene konnte nicht geladen werden",
    "layers.opacity": "Deckkraft",
    "layers.zoomHintMin": "sichtbar ab Zoom",
    "layers.zoomHintMax": "sichtbar bis Zoom",
    "layers.remove": "Layer entfernen",
    "layers.added": "Hinzugefügte Layer",
    "addLayer.title": "Layer hinzufügen",
    "addLayer.intro":
      "WMS-URL einfügen. Der Dienst wird direkt im Browser abgefragt (muss CORS erlauben).",
    "addLayer.load": "Laden",
    "addLayer.loading": "Lade Capabilities…",
    "addLayer.add": "Hinzufügen",
    "addLayer.cancel": "Abbrechen",
    "addLayer.empty": "Keine Layer gefunden",
    "addLayer.failed": "Dienst konnte nicht geladen werden",
    "addLayer.no3857": "kein Web Mercator (EPSG:3857) deklariert — Anzeige evtl. nicht möglich",
    "print.title": "Drucken & Export",
    "print.titleLabel": "Titel",
    "print.size": "Größe",
    "print.size.current": "Aktueller Ausschnitt",
    "print.size.a4l": "A4 quer",
    "print.size.a4p": "A4 hoch",
    "print.dpi": "Auflösung",
    "print.includeLegend": "Legende einbeziehen",
    "print.rendering": "Karte wird gerendert…",
    "print.failed": "Export fehlgeschlagen",
    "print.png": "PNG herunterladen",
    "print.print": "Drucken",
    "basemaps.title": "Hintergrund",
    "legend.title": "Legende",
    "popup.close": "Schließen",
    "popup.noInfo": "Keine Informationen an dieser Stelle",
    "popup.loading": "Lade Informationen…",
    "popup.more": "weitere Objekte",
    "error.title": "map0-Konfigurationsfehler",
    "error.intro": "Die Karte konnte nicht starten. Bitte Konfiguration korrigieren:",
    "control.home": "Ausgangsansicht",
  },
};

export type Translate = (key: string) => string;

export function resolveLocale(configured: string, fallback: string): string {
  const wanted =
    configured === "auto"
      ? (typeof navigator !== "undefined" ? navigator.language : fallback)
      : configured;
  const short = wanted.toLowerCase().split("-")[0] ?? fallback;
  return dictionaries[short] ? short : fallback;
}

export function makeT(locale: string, fallback = "en"): Translate {
  const dict = dictionaries[locale] ?? dictionaries[fallback] ?? {};
  const fb = dictionaries[fallback] ?? {};
  return (key) => dict[key] ?? fb[key] ?? key;
}

/** Partial MapLibre `locale` map so built-in control tooltips match the UI language. */
export function maplibreLocale(locale: string): Record<string, string> | undefined {
  if (locale !== "de") return undefined;
  return {
    "NavigationControl.ZoomIn": "Hineinzoomen",
    "NavigationControl.ZoomOut": "Herauszoomen",
    "NavigationControl.ResetBearing": "Nach Norden ausrichten",
    "FullscreenControl.Enter": "Vollbild",
    "FullscreenControl.Exit": "Vollbild beenden",
    "GeolocateControl.FindMyLocation": "Meinen Standort anzeigen",
    "GeolocateControl.LocationNotAvailable": "Standort nicht verfügbar",
    "GlobeControl.Enable": "Globus aktivieren",
    "GlobeControl.Disable": "Globus deaktivieren",
    "ScrollZoomBlocker.CtrlMessage": "Strg + Scrollen zum Zoomen",
    "ScrollZoomBlocker.CmdMessage": "⌘ + Scrollen zum Zoomen",
    "TouchPanBlocker.Message": "Mit zwei Fingern verschieben",
  };
}
