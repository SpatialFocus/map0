/** Tiny built-in i18n runtime. de + en ship in core; overrides come later (F11.2). */

const dictionaries: Record<string, Record<string, string>> = {
  en: {
    "layers.title": "Map layers",
    "layers.empty": "No overlays configured",
    "layers.metadata": "Dataset details",
    "layers.error": "Layer failed to load",
    "layers.opacity": "Opacity",
    "basemaps.title": "Basemap",
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
    "basemaps.title": "Hintergrund",
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
