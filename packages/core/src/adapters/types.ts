import type { Map as MapLibreMap, LngLat, Point } from "maplibre-gl";
import type { NormalizedLayer, PopupConfig } from "@map0/schema";
import { Signal } from "../signals.js";

export type LayerStatus = "loading" | "ready" | "error";

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

  mount(ctx: AdapterContext): void {
    this.ctx = ctx;
    this.addToMap();
    this.applyVisibility(this.def.visible);
    if (this.def.opacity !== 1) this.applyOpacity(this.def.opacity);
    this.trackStatus();
  }

  protected abstract addToMap(): void;

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
