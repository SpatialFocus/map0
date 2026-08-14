import type { Map as MapLibreMap } from "maplibre-gl";
import {
  normalizeSingleLayer,
  type GroupLayerDef,
  type LayerDef,
  type NormalizedConfig,
  type NormalizedLayer,
} from "@map0/schema";
import type { OverlayIds } from "./basemaps.js";
import { createAdapter } from "./adapters/registry.js";
import { ensurePmtilesProtocol } from "./adapters/vector.js";
import type { AdapterContext, LayerStatus, LegendSpec, SourceAdapter } from "./adapters/types.js";
import { Signal } from "./signals.js";

export interface LayerUIState {
  id: string;
  title: string;
  groupPath: string[];
  visible: boolean;
  opacity: number;
  status: LayerStatus;
  minZoom?: number;
  maxZoom?: number;
  /** false when the layer is configured with a zoom range the map is currently outside of (F2.5) */
  inZoomRange: boolean;
  legend: LegendSpec | null;
  /** "zoom to layer" available (F2.2) */
  canZoom: boolean;
  /** true for layers added at runtime via the add-layer dialog (removable) */
  userAdded: boolean;
  metadataUrl?: string;
  metadataTitle?: string;
  attribution?: string;
}

export class LayerManager {
  readonly state = new Signal<LayerUIState[]>([]);
  private readonly adapters = new Map<string, SourceAdapter>();
  private readonly runtime = new Map<string, { visible: boolean; opacity: number }>();
  /** layers added at runtime (F3) — rendered after the configured tree, top-most on the map */
  private readonly extra: NormalizedLayer[] = [];
  private ctx?: AdapterContext;

  constructor(
    private readonly map: MapLibreMap,
    private readonly cfg: NormalizedConfig,
  ) {
    /* re-evaluate zoom-range hints; only refresh when a layer enters/leaves its range */
    let rangeSignature = "";
    this.map.on("zoom", () => {
      const sig = this.allDefs.map((d) => this.inZoomRange(d)).join(",");
      if (sig !== rangeSignature) {
        rangeSignature = sig;
        this.refresh();
      }
    });
  }

  private get allDefs(): NormalizedLayer[] {
    return [...this.cfg.layers, ...this.extra];
  }

  private inZoomRange(def: NormalizedLayer): boolean {
    const z = this.map.getZoom();
    if (def.minZoom !== undefined && z < def.minZoom) return false;
    if (def.maxZoom !== undefined && z >= def.maxZoom) return false;
    return true;
  }

  get overlayIds(): OverlayIds {
    const sources = new Set<string>();
    const layers = new Set<string>();
    for (const a of this.adapters.values()) {
      a.sourceIds.forEach((s) => sources.add(s));
      a.layerIds.forEach((l) => layers.add(l));
    }
    return { sources, layers };
  }

  get all(): SourceAdapter[] {
    return [...this.adapters.values()];
  }

  /** runtime-added layer definitions (for share/permalink state, F3.5) */
  get userLayerDefs(): NormalizedLayer[] {
    return [...this.extra];
  }

  /** adapter owning a given MapLibre layer id (for hit → layer-config lookups) */
  adapterForMapLayer(mapLayerId: string): SourceAdapter | undefined {
    for (const a of this.adapters.values()) {
      if (a.layerIds.includes(mapLayerId)) return a;
    }
    return undefined;
  }

  /** fit the map to a layer's extent; false when no bounds are known (F2.2) */
  async zoomTo(id: string): Promise<boolean> {
    const adapter = this.adapters.get(id);
    const bounds = await adapter?.bounds();
    if (!bounds) return false;
    this.map.fitBounds(bounds, { padding: 40, maxZoom: 17 });
    return true;
  }

  /** adapters that can answer clicks, top-most first, only when visible */
  get queryable(): SourceAdapter[] {
    return [...this.adapters.values()]
      .filter((a) => a.featureInfo && (this.runtime.get(a.def.id)?.visible ?? a.def.visible))
      .reverse();
  }

  async mountAll(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const defs: NormalizedLayer[] = this.cfg.layers;
    const needsPmtiles = defs.some(
      (d) => d.type === "vector" && typeof d.url === "string" && d.url.startsWith("pmtiles://"),
    );
    if (needsPmtiles) await ensurePmtilesProtocol();

    for (const def of defs) {
      const adapter = createAdapter(def);
      if (!adapter) continue; // validator prevents unknown types; belt & braces
      try {
        await adapter.mount(ctx); // sequential keeps config order = drawing order
      } catch (e) {
        adapter.status.value = "error";
        console.error(`[map0] failed to mount layer "${def.id}"`, e);
      }
      this.adapters.set(def.id, adapter);
      this.runtime.set(def.id, { visible: def.visible, opacity: def.opacity });
      adapter.status.subscribe(() => this.refresh());
    }
    this.refresh();
  }

  /** Add a (non-group) layer at runtime; returns its id or null on failure (F3.1). */
  async addLayer(def: Exclude<LayerDef, GroupLayerDef>): Promise<string | null> {
    if (!this.ctx) return null;
    const norm = normalizeSingleLayer(def, this.adapters.keys());
    if (norm.type === "vector" && norm.url.startsWith("pmtiles://")) {
      const { ensurePmtilesProtocol: ensure } = await import("./adapters/vector.js");
      await ensure();
    }
    const adapter = createAdapter(norm);
    if (!adapter) return null;
    try {
      await adapter.mount(this.ctx);
    } catch (e) {
      console.error(`[map0] failed to add layer "${norm.id}"`, e);
      return null;
    }
    this.extra.push(norm);
    this.adapters.set(norm.id, adapter);
    this.runtime.set(norm.id, { visible: norm.visible, opacity: norm.opacity });
    adapter.status.subscribe(() => this.refresh());
    this.refresh();
    return norm.id;
  }

  /** Remove a runtime-added layer (configured layers stay; F3.3). */
  removeLayer(id: string): boolean {
    const idx = this.extra.findIndex((l) => l.id === id);
    const adapter = this.adapters.get(id);
    if (idx === -1 || !adapter) return false;
    adapter.unmount();
    this.extra.splice(idx, 1);
    this.adapters.delete(id);
    this.runtime.delete(id);
    this.refresh();
    return true;
  }

  setVisibility(id: string, visible: boolean): void {
    const adapter = this.adapters.get(id);
    const rt = this.runtime.get(id);
    if (!adapter || !rt) return;
    rt.visible = visible;
    adapter.applyVisibility(visible);
    this.refresh();
  }

  setOpacity(id: string, opacity: number): void {
    const adapter = this.adapters.get(id);
    const rt = this.runtime.get(id);
    if (!adapter || !rt) return;
    rt.opacity = opacity;
    adapter.applyOpacity(opacity);
    this.refresh();
  }

  private refresh(): void {
    const extraIds = new Set(this.extra.map((l) => l.id));
    this.state.value = this.allDefs.map((def) => {
      const rt = this.runtime.get(def.id);
      const adapter = this.adapters.get(def.id);
      return {
        userAdded: extraIds.has(def.id),
        id: def.id,
        title: def.title,
        groupPath: def.groupPath,
        visible: rt?.visible ?? def.visible,
        opacity: rt?.opacity ?? def.opacity,
        status: adapter?.status.value ?? "error",
        minZoom: def.minZoom,
        maxZoom: def.maxZoom,
        inZoomRange: this.inZoomRange(def),
        legend: adapter?.legend() ?? null,
        canZoom: adapter?.zoomable ?? false,
        metadataUrl: def.metadata?.url,
        metadataTitle: def.metadata?.title,
        attribution: def.attribution,
      };
    });
  }
}
