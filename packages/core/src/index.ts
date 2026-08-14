import { Map as MaplibreMap } from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  normalizeConfig,
  validateConfig,
  type Map0Config,
  type NormalizedConfig,
  type ValidationError,
} from "@map0/schema";
import { BasemapManager, basemapStyle, resolveBasemapStyle } from "./basemaps.js";
import { applyControls, type InitialView } from "./controls.js";
import type { CoreEvents } from "./events.js";
import { formatCoordinates } from "./coordinates.js";
import { wireFeatureInfo } from "./featureinfo.js";
import { HighlightManager } from "./highlight.js";
import { makeT, maplibreLocale, resolveLocale, type Translate } from "./i18n.js";
import { LayerManager } from "./layers.js";
import { Emitter } from "./signals.js";

export * from "./adapters/types.js";
export { deriveFromStyleLayers, entryFromPaint } from "./adapters/legend-derive.js";
export { registerAdapter } from "./adapters/registry.js";
export { expandSimpleStyle } from "./adapters/geojson.js";
export { buildGetFeatureInfoUrl, buildLegendUrl, buildWmsTileUrl } from "./adapters/wms.js";
export { buildWmtsTemplate, isMercatorCrs, type WmtsTemplateParts } from "./adapters/wmts.js";
export { basemapStyle, BasemapManager } from "./basemaps.js";
export { geojsonBounds } from "./bbox.js";
export { autoGkCode, autoUtmCode, formatCoordinates, type CoordinateEntry } from "./coordinates.js";
export { HighlightManager };
export type { CoreEvents } from "./events.js";
export { makeT, resolveLocale, type Translate } from "./i18n.js";
export { LayerManager, type LayerUIState } from "./layers.js";
export { Emitter, Signal, type Unsubscribe } from "./signals.js";
export {
  collectAttributions,
  composePrint,
  computeScaleBar,
  renderMapImage,
  type PrintComposeOptions,
  type PrintLegendItem,
  type PrintRenderOptions,
} from "./print.js";
export { escapeHtml, renderAllProps, renderFields, renderTemplate } from "./template.js";
export { validateConfig, normalizeConfig };
export type { Map0Config, NormalizedConfig, ValidationError };

export interface CoreOptions {
  container: HTMLElement;
  config: NormalizedConfig;
  /** element that should go fullscreen (the host, so panels stay visible) */
  fullscreenTarget?: HTMLElement;
}

export interface Map0Core {
  map: MapLibreMap;
  config: NormalizedConfig;
  layers: LayerManager;
  basemaps: BasemapManager;
  events: Emitter<CoreEvents>;
  t: Translate;
  locale: string;
  setBasemap(id: string): void;
  setLayerVisibility(id: string, visible: boolean): void;
  setLayerOpacity(id: string, opacity: number): void;
  addLayer(def: Parameters<LayerManager["addLayer"]>[0]): Promise<string | null>;
  removeLayer(id: string): boolean;
  zoomToLayer(id: string): Promise<boolean>;
  clearHighlight(): void;
  destroy(): void;
}

/** background color for synthetic (raster/empty) basemap styles */
function themeBackground(mode: "auto" | "light" | "dark"): string {
  const dark =
    mode === "dark" ||
    (mode === "auto" &&
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  return dark ? "#1c1f24" : "#f4f5f7";
}

export async function createCore(opts: CoreOptions): Promise<Map0Core> {
  const cfg = opts.config;
  const locale = resolveLocale(cfg.i18n.locale, cfg.i18n.fallback, cfg.i18n.overrides);
  const t = makeT(locale, cfg.i18n.fallback, cfg.i18n.overrides);
  const events = new Emitter<CoreEvents>();
  const background = themeBackground(cfg.theme.mode);

  const initialBasemap = cfg.basemaps.find((b) => b.id === cfg.defaultBasemapId)!;
  const initialStyle = await resolveBasemapStyle(initialBasemap, background);
  const m = cfg.map;

  const map = new MaplibreMap({
    container: opts.container,
    style: initialStyle as never,
    ...(m.center ? { center: m.center } : {}),
    ...(m.zoom !== undefined ? { zoom: m.zoom } : {}),
    ...(m.bounds ? { bounds: m.bounds, fitBoundsOptions: { padding: 24 } } : {}),
    ...(m.bearing !== undefined ? { bearing: m.bearing } : {}),
    ...(m.pitch !== undefined ? { pitch: m.pitch } : {}),
    ...(m.minZoom !== undefined ? { minZoom: m.minZoom } : {}),
    ...(m.maxZoom !== undefined ? { maxZoom: m.maxZoom } : {}),
    ...(m.maxBounds ? { maxBounds: m.maxBounds } : {}),
    ...(m.hash ? { hash: "map0" } : {}),
    attributionControl: false,
    ...(maplibreLocale(locale) ? { locale: maplibreLocale(locale) } : {}),
  });

  /* initial projection (globe): apply once; basemap switches carry it via transformStyle */
  if (m.projection === "globe") {
    map.once("style.load", () => map.setProjection({ type: "globe" }));
  }

  const layers = new LayerManager(map, cfg);
  const highlight = new HighlightManager(map, cfg.theme.primary);
  const basemaps = new BasemapManager(
    map,
    cfg.basemaps,
    cfg.defaultBasemapId,
    () => {
      const overlay = layers.overlayIds;
      for (const s of highlight.ids.sources) overlay.sources.add(s);
      for (const l of highlight.ids.layers) overlay.layers.add(l);
      return overlay;
    },
    background,
  );

  const initialView: InitialView = { center: m.center, zoom: m.zoom, bounds: m.bounds };
  applyControls(map, cfg, t, opts.fullscreenTarget, initialView);

  map.once("style.load", () => {
    void (async () => {
      try {
        await layers.mountAll({ map, accent: cfg.theme.primary });
      } catch (e) {
        events.emit("error", { message: String(e) });
      }
      wireFeatureInfo(map, layers, events, highlight);
      if (!initialView.center && !initialView.bounds) {
        initialView.center = [map.getCenter().lng, map.getCenter().lat];
        initialView.zoom = map.getZoom();
      }
      events.emit("ready", {});
    })();
  });

  map.on("error", (e) => {
    /* surface tile/source errors without crashing; adapters track their own status */
    console.warn("[map0]", e.error ?? e);
  });

  /* coordinate readout: right-click (desktop) + long-press (touch), F5.6 */
  if (cfg.controls.coordinates !== false) {
    const crsList = cfg.controls.coordinates.crs;
    const emitAt = (lngLat: { lng: number; lat: number }): void => {
      events.emit("coordinates", {
        lngLat: [lngLat.lng, lngLat.lat],
        entries: formatCoordinates(lngLat.lng, lngLat.lat, crsList),
      });
    };
    map.on("contextmenu", (e) => {
      e.preventDefault();
      emitAt(e.lngLat);
    });
    /* long-press: pointerdown that stays put for 600 ms */
    const canvas = map.getCanvas();
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let pressStart: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      pressStart = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        const rect = canvas.getBoundingClientRect();
        const lngLat = map.unproject([pressStart!.x - rect.left, pressStart!.y - rect.top]);
        emitAt(lngLat);
      }, 600);
    });
    const cancelPress = (e: PointerEvent): void => {
      if (
        e.type === "pointermove" &&
        pressStart &&
        Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) < 8
      ) {
        return;
      }
      clearTimeout(pressTimer);
      pressStart = null;
    };
    canvas.addEventListener("pointermove", cancelPress);
    canvas.addEventListener("pointerup", cancelPress);
    canvas.addEventListener("pointercancel", cancelPress);
  }

  return {
    map,
    config: cfg,
    layers,
    basemaps,
    events,
    t,
    locale,
    setBasemap: (id) => void basemaps.switchTo(id),
    setLayerVisibility: (id, v) => layers.setVisibility(id, v),
    setLayerOpacity: (id, o) => layers.setOpacity(id, o),
    addLayer: (def) => layers.addLayer(def),
    removeLayer: (id) => layers.removeLayer(id),
    zoomToLayer: (id) => layers.zoomTo(id),
    clearHighlight: () => highlight.clear(),
    destroy: () => {
      map.remove();
      events.clear();
    },
  };
}
