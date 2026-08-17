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

/**
 * Mounting order for the configured tree: bottom-most first, because MapLibre
 * appends every new layer on top. Reversing here is what makes the config
 * contract "top of the list = top of the map" (F2.1) true on the map.
 */
export function drawOrder(configured: readonly NormalizedLayer[]): NormalizedLayer[] {
  return [...configured].reverse();
}

/**
 * All layers, top-most on the map first. Runtime-added layers (F3) go above the
 * configured tree — MapLibre puts each new one on top — and the most recently
 * added one is the top-most of those. This is the order the TOC, the legend and
 * the feature-info hit test all read.
 */
export function stackOrder(
  configured: readonly NormalizedLayer[],
  extra: readonly NormalizedLayer[],
): NormalizedLayer[] {
  return [...[...extra].reverse(), ...configured];
}

export class LayerManager {
  readonly state = new Signal<LayerUIState[]>([]);
  private readonly adapters = new Map<string, SourceAdapter>();
  private readonly runtime = new Map<string, { visible: boolean; opacity: number }>();
  /** unsubscribe handles for the adapters' status signals, by layer id */
  private readonly statusSubs = new Map<string, () => void>();
  /** layers added at runtime (F3) — above the configured tree, top-most on the map */
  private readonly extra: NormalizedLayer[] = [];
  private ctx?: AdapterContext;
  private readonly onZoom: () => void;

  constructor(
    private readonly map: MapLibreMap,
    private readonly cfg: NormalizedConfig,
  ) {
    /* re-evaluate zoom-range hints; only refresh when a layer enters/leaves its range */
    let rangeSignature = "";
    this.onZoom = () => {
      const sig = this.allDefs.map((d) => this.inZoomRange(d)).join(",");
      if (sig !== rangeSignature) {
        rangeSignature = sig;
        this.refresh();
      }
    };
    this.map.on("zoom", this.onZoom);
  }

  /** every layer, top-most first */
  private get allDefs(): NormalizedLayer[] {
    return stackOrder(this.cfg.layers, this.extra);
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
    return this.allDefs
      .map((def) => this.adapters.get(def.id))
      .filter(
        (a): a is SourceAdapter =>
          !!a?.featureInfo && (this.runtime.get(a.def.id)?.visible ?? a.def.visible),
      );
  }

  async mountAll(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    /* bottom-up: MapLibre appends on top, so the first configured layer lands last */
    const defs = drawOrder(this.cfg.layers);
    const needsPmtiles = defs.some(
      (d) => d.type === "vector" && typeof d.url === "string" && d.url.startsWith("pmtiles://"),
    );
    if (needsPmtiles) await ensurePmtilesProtocol();

    for (const def of defs) {
      const adapter = createAdapter(def);
      if (!adapter) continue; // validator prevents unknown types; belt & braces
      try {
        await adapter.mount(ctx); // sequential keeps the stack deterministic
      } catch (e) {
        adapter.status.value = "error";
        console.error(`[map0] failed to mount layer "${def.id}"`, e);
      }
      this.adapters.set(def.id, adapter);
      this.runtime.set(def.id, { visible: def.visible, opacity: def.opacity });
      this.statusSubs.set(
        def.id,
        adapter.status.subscribe(() => this.refresh()),
      );
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
    this.statusSubs.set(
      norm.id,
      adapter.status.subscribe(() => this.refresh()),
    );
    this.refresh();
    return norm.id;
  }

  /** Remove a runtime-added layer (configured layers stay; F3.3). */
  removeLayer(id: string): boolean {
    const idx = this.extra.findIndex((l) => l.id === id);
    const adapter = this.adapters.get(id);
    if (idx === -1 || !adapter) return false;
    adapter.unmount();
    this.statusSubs.get(id)?.();
    this.statusSubs.delete(id);
    this.extra.splice(idx, 1);
    this.adapters.delete(id);
    this.runtime.delete(id);
    this.refresh();
    return true;
  }

  /** detach everything this manager registered on the map (the map itself may outlive it) */
  destroy(): void {
    this.map.off("zoom", this.onZoom);
    for (const unsub of this.statusSubs.values()) unsub();
    this.statusSubs.clear();
    for (const adapter of this.adapters.values()) adapter.unmount();
    this.adapters.clear();
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
        /* no adapter yet = still mounting (async adapters register after their
           await); a real failure sets the adapter's own status to "error" */
        status: adapter?.status.value ?? "loading",
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
