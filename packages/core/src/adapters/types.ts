import type { Map as MapLibreMap, LngLat, Point } from "maplibre-gl";
import type { LegendEntryDef, NormalizedLayer, PopupConfig } from "@map0/schema";
import { Signal } from "../signals.js";

export type LayerStatus = "loading" | "ready" | "error";

export interface LegendEntry {
  label?: string;
  color?: string;
  shape: "square" | "line" | "circle";
  image?: string;
}

export type LegendSpec =
  | { kind: "image"; url: string }
  | { kind: "entries"; entries: LegendEntry[] };

export interface AdapterContext {
  map: MapLibreMap;
  /** theme primary color, used for default vector styles */
  accent: string;
}

export interface FeatureInfoResult {
  layerId: string;
  layerTitle: string;
  /** popup/info config from the layer definition (false = suppress) */
  popup?: PopupConfig | false;
  /** attribute sets, one per feature */
  features: Array<Record<string, unknown>>;
  /** raw HTML/text response (WMS html/plain GetFeatureInfo) — must be sanitized by the UI */
  html?: string;
}

export interface FeatureInfoQuery {
  lngLat: LngLat;
  point: Point;
}

/** One config layer = one adapter instance managing its MapLibre sources/layers. */
export abstract class SourceAdapter<D extends NormalizedLayer = NormalizedLayer> {
  readonly status = new Signal<LayerStatus>("loading");
  protected ctx!: AdapterContext;
  /** [maplibre layer id, opacity paint property, base value] triplets for opacity control */
  protected opacityEntries: Array<[string, string, number]> = [];

  constructor(readonly def: D) {}

  abstract get sourceIds(): string[];
  abstract get layerIds(): string[];
  /** layer ids that should show a pointer cursor / be clickable */
  get interactiveLayerIds(): string[] {
    return [];
  }

  async mount(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    await this.addToMap();
    this.applyVisibility(this.def.visible);
    if (this.def.opacity !== 1) this.applyOpacity(this.def.opacity);
    this.trackStatus();
  }

  /** remove this layer's MapLibre layers and sources (runtime layer removal, F3.3) */
  unmount(): void {
    const { map } = this.ctx;
    for (const id of this.layerIds) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of this.sourceIds) {
      if (map.getSource(id)) map.removeSource(id);
    }
  }

  /** may be async (e.g. WMTS resolves its capabilities first) */
  protected abstract addToMap(): void | Promise<void>;

  applyVisibility(visible: boolean): void {
    const { map } = this.ctx;
    for (const id of this.layerIds) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
  }

  applyOpacity(opacity: number): void {
    const { map } = this.ctx;
    for (const [layerId, prop, base] of this.opacityEntries) {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, prop as never, (base * opacity) as never);
      }
    }
  }

  /**
   * Legend for this layer (F4): config override wins, otherwise the adapter's
   * auto-legend (WMS GetLegendGraphic, style-derived swatches, …).
   */
  legend(): LegendSpec | null {
    const l = this.def.legend;
    if (l === false) return null;
    if (Array.isArray(l)) {
      return {
        kind: "entries",
        entries: l.map((e: LegendEntryDef) => ({
          label: e.label,
          color: e.color,
          image: e.image,
          shape: e.shape ?? "square",
        })),
      };
    }
    if (typeof l === "string" && l !== "auto") return { kind: "image", url: l };
    return this.autoLegend();
  }

  protected autoLegend(): LegendSpec | null {
    return null;
  }

  /** default status tracking via source events; adapters may override */
  protected trackStatus(): void {
    const { map } = this.ctx;
    const sourceIds = new Set(this.sourceIds);
    const onData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId && sourceIds.has(e.sourceId) && e.isSourceLoaded) {
        this.status.value = "ready";
      }
    };
    const onError = (e: { sourceId?: string }) => {
      if (e.sourceId && sourceIds.has(e.sourceId)) {
        this.status.value = "error";
      }
    };
    map.on("sourcedata", onData);
    map.on("error", onError as never);
  }

  featureInfo?(query: FeatureInfoQuery): Promise<FeatureInfoResult | null>;
}
