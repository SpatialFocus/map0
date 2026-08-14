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
import { wireFeatureInfo } from "./featureinfo.js";
import { makeT, maplibreLocale, resolveLocale, type Translate } from "./i18n.js";
import { LayerManager } from "./layers.js";
import { Emitter } from "./signals.js";

export * from "./adapters/types.js";
export { registerAdapter } from "./adapters/registry.js";
export { expandSimpleStyle } from "./adapters/geojson.js";
export { buildGetFeatureInfoUrl, buildLegendUrl, buildWmsTileUrl } from "./adapters/wms.js";
export { basemapStyle, BasemapManager } from "./basemaps.js";
export type { CoreEvents } from "./events.js";
export { makeT, resolveLocale, type Translate } from "./i18n.js";
export { LayerManager, type LayerUIState } from "./layers.js";
export { Emitter, Signal, type Unsubscribe } from "./signals.js";
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
  const locale = resolveLocale(cfg.i18n.locale, cfg.i18n.fallback);
  const t = makeT(locale, cfg.i18n.fallback);
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
  const basemaps = new BasemapManager(
    map,
    cfg.basemaps,
    cfg.defaultBasemapId,
    () => layers.overlayIds,
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
      wireFeatureInfo(map, layers, events);
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
    destroy: () => {
      map.remove();
      events.clear();
    },
  };
}
