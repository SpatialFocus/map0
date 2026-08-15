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
import { formatCoordinatesAsync } from "./coordinates.js";
import { wireFeatureInfo } from "./featureinfo.js";
import { HighlightManager } from "./highlight.js";
import { makeT, maplibreLocale, resolveLocale, type Translate } from "./i18n.js";
import { LayerManager } from "./layers.js";
import {
  decodeShareState,
  encodeShareState,
  readShareParam,
  writeShareParam,
  type ShareState,
} from "./permalink.js";
import { Emitter } from "./signals.js";

/* re-exported so the UI can reach MapLibre through the lazily loaded engine
   instead of importing it statically (see map0-viewer's loadEngine) */
export { Popup } from "maplibre-gl";

export * from "./adapters/types.js";
export { deriveFromStyleLayers, entryFromPaint } from "./adapters/legend-derive.js";
export { registerAdapter } from "./adapters/registry.js";
export { expandSimpleStyle } from "./adapters/geojson.js";
export { buildGetFeatureInfoUrl, buildLegendUrl, buildWmsTileUrl } from "./adapters/wms.js";
export { buildWmtsTemplate, isMercatorCrs, type WmtsTemplateParts } from "./adapters/wmts.js";
export { absolutizeUrl, basemapStyle, BasemapManager, fetchTileJson } from "./basemaps.js";
export { geojsonBounds } from "./bbox.js";
export {
  autoGkCode,
  autoUtmCode,
  formatCoordinates,
  formatCoordinatesAsync,
  loadProj4,
  type CoordinateEntry,
} from "./coordinates.js";
export { HighlightManager };
export type { CoreEvents } from "./events.js";
export { makeT, resolveLocale, type Translate } from "./i18n.js";
export { LayerManager, type LayerUIState } from "./layers.js";
export { loadOgcClient, type OgcClient } from "./ogc.js";
export {
  decodeShareState,
  encodeShareState,
  readShareParam,
  writeShareParam,
  type ShareState,
} from "./permalink.js";
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
  /** current shareable URL (null when `permalink` is not enabled) */
  getShareUrl(): string | null;
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

  /* shared state from the URL (F10.1) — wins over the configured initial view */
  const shareParam = cfg.permalink === false ? null : cfg.permalink.param;
  let initialShare: ShareState | null = null;
  if (shareParam && typeof location !== "undefined") {
    const raw = readShareParam(location.hash, shareParam);
    if (raw) initialShare = decodeShareState(raw);
  }

  const sharedBasemapId =
    initialShare?.b && cfg.basemaps.some((b) => b.id === initialShare!.b)
      ? initialShare.b
      : cfg.defaultBasemapId;
  const initialBasemap = cfg.basemaps.find((b) => b.id === sharedBasemapId)!;
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
    ...(initialShare
      ? {
          center: [initialShare.v[0]!, initialShare.v[1]!] as [number, number],
          zoom: initialShare.v[2]!,
          bearing: initialShare.v[3] ?? 0,
          pitch: initialShare.v[4] ?? 0,
          bounds: undefined,
        }
      : {}),
    ...(m.minZoom !== undefined ? { minZoom: m.minZoom } : {}),
    ...(m.maxZoom !== undefined ? { maxZoom: m.maxZoom } : {}),
    ...(m.maxBounds ? { maxBounds: m.maxBounds } : {}),
    ...(m.hash && !shareParam ? { hash: "view" } : {}), // permalink supersedes map.hash
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
    sharedBasemapId,
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

  /* ---- share/permalink plumbing (F10.1) ---- */
  const buildShareState = (): ShareState => {
    const c = map.getCenter();
    const v: number[] = [
      Math.round(c.lng * 1e5) / 1e5,
      Math.round(c.lat * 1e5) / 1e5,
      Math.round(map.getZoom() * 100) / 100,
    ];
    if (map.getBearing() !== 0 || map.getPitch() !== 0) {
      v.push(Math.round(map.getBearing()), Math.round(map.getPitch()));
    }
    const state: ShareState = { v };
    if (basemaps.current.value !== cfg.defaultBasemapId) state.b = basemaps.current.value;
    const l: Record<string, [number, number]> = {};
    for (const s of layers.state.value) {
      if (s.userAdded) continue;
      const def = cfg.layers.find((d) => d.id === s.id);
      if (
        s.visible !== (def?.visible ?? true) ||
        Math.abs(s.opacity - (def?.opacity ?? 1)) > 0.005
      ) {
        l[s.id] = [s.visible ? 1 : 0, Math.round(s.opacity * 100)];
      }
    }
    if (Object.keys(l).length > 0) state.l = l;
    if (layers.userLayerDefs.length > 0) state.u = layers.userLayerDefs as never;
    return state;
  };

  const getShareUrl = (): string | null => {
    if (!shareParam || typeof location === "undefined") return null;
    const hash = writeShareParam(location.hash, shareParam, encodeShareState(buildShareState()));
    return `${location.origin}${location.pathname}${location.search}${hash}`;
  };

  map.once("style.load", () => {
    void (async () => {
      try {
        await layers.mountAll({ map, accent: cfg.theme.primary });
      } catch (e) {
        events.emit("error", { message: String(e) });
      }
      /* restore shared layer state + user-added layers */
      if (initialShare?.l) {
        for (const [id, [vis, op]] of Object.entries(initialShare.l)) {
          layers.setVisibility(id, vis === 1);
          layers.setOpacity(id, op / 100);
        }
      }
      if (initialShare?.u) {
        for (const def of initialShare.u) {
          if (def && typeof def === "object" && def.type !== "group") {
            try {
              await layers.addLayer(def as never);
            } catch {
              /* invalid shared layer — skip */
            }
          }
        }
      }
      wireFeatureInfo(map, layers, events, highlight);
      if (!initialView.center && !initialView.bounds) {
        initialView.center = [map.getCenter().lng, map.getCenter().lat];
        initialView.zoom = map.getZoom();
      }
      /* keep the URL in sync (debounced replaceState — no history spam) */
      if (shareParam && typeof history !== "undefined") {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const sync = (): void => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            const url = getShareUrl();
            if (url) history.replaceState(history.state, "", url);
          }, 400);
        };
        map.on("moveend", sync);
        layers.state.subscribe(sync);
        basemaps.current.subscribe(sync);
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
      void formatCoordinatesAsync(lngLat.lng, lngLat.lat, crsList).then((entries) => {
        events.emit("coordinates", { lngLat: [lngLat.lng, lngLat.lat], entries });
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
    getShareUrl,
    destroy: () => {
      map.remove();
      events.clear();
    },
  };
}
