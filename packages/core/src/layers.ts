import type { Map as MapLibreMap } from "maplibre-gl";
import type { NormalizedConfig, NormalizedLayer } from "@map0/schema";
import type { OverlayIds } from "./basemaps.js";
import { createAdapter } from "./adapters/registry.js";
import { ensurePmtilesProtocol } from "./adapters/vector.js";
import type { AdapterContext, LayerStatus, SourceAdapter } from "./adapters/types.js";
import { Signal } from "./signals.js";

export interface LayerUIState {
  id: string;
  title: string;
  groupPath: string[];
  visible: boolean;
  opacity: number;
  status: LayerStatus;
  metadataUrl?: string;
  metadataTitle?: string;
  attribution?: string;
}

export class LayerManager {
  readonly state = new Signal<LayerUIState[]>([]);
  private readonly adapters = new Map<string, SourceAdapter>();
  private readonly runtime = new Map<string, { visible: boolean; opacity: number }>();

  constructor(
    private readonly map: MapLibreMap,
    private readonly cfg: NormalizedConfig,
  ) {}

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

  /** adapters that can answer clicks, top-most first, only when visible */
  get queryable(): SourceAdapter[] {
    return [...this.adapters.values()]
      .filter((a) => a.featureInfo && (this.runtime.get(a.def.id)?.visible ?? a.def.visible))
      .reverse();
  }

  async mountAll(ctx: AdapterContext): Promise<void> {
    const defs: NormalizedLayer[] = this.cfg.layers;
    const needsPmtiles = defs.some(
      (d) => d.type === "vector" && typeof d.url === "string" && d.url.startsWith("pmtiles://"),
    );
    if (needsPmtiles) await ensurePmtilesProtocol();

    for (const def of defs) {
      const adapter = createAdapter(def);
      if (!adapter) continue; // validator prevents unknown types; belt & braces
      try {
        adapter.mount(ctx);
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
    this.state.value = this.cfg.layers.map((def) => {
      const rt = this.runtime.get(def.id);
      const adapter = this.adapters.get(def.id);
      return {
        id: def.id,
        title: def.title,
        groupPath: def.groupPath,
        visible: rt?.visible ?? def.visible,
        opacity: rt?.opacity ?? def.opacity,
        status: adapter?.status.value ?? "error",
        metadataUrl: def.metadata?.url,
        metadataTitle: def.metadata?.title,
        attribution: def.attribution,
      };
    });
  }
}
