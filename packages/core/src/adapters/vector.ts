import type { NormalizedLayer, StyleLayerSpec, VectorLayerDef } from "@map0/schema";
import { deriveFromStyleLayers } from "./legend-derive.js";
import {
  SourceAdapter,
  type FeatureInfoQuery,
  type FeatureInfoResult,
  type LegendSpec,
} from "./types.js";

type NormalizedVector = VectorLayerDef & NormalizedLayer & { type: "vector" };

let pmtilesRegistered = false;

/** Register the pmtiles:// protocol once, lazily (pmtiles is only loaded when needed). */
export async function ensurePmtilesProtocol(): Promise<void> {
  if (pmtilesRegistered) return;
  const [{ addProtocol }, { Protocol }] = await Promise.all([
    import("maplibre-gl"),
    import("pmtiles"),
  ]);
  addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

const OPACITY_PROPS: Record<string, string[]> = {
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  circle: ["circle-opacity", "circle-stroke-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
  "fill-extrusion": ["fill-extrusion-opacity"],
};

export class VectorAdapter extends SourceAdapter<NormalizedVector> {
  private srcId = `m0s-${this.def.id}`;
  private ids: string[] = [];
  private interactive: string[] = [];

  get sourceIds(): string[] {
    return [this.srcId];
  }
  get layerIds(): string[] {
    return this.ids;
  }
  override get interactiveLayerIds(): string[] {
    return this.interactive;
  }

  protected override async addToMap(): Promise<void> {
    const { map } = this.ctx;
    const url = this.def.url;
    let source: Record<string, unknown> = { type: "vector", url };
    if (url.includes("{z}")) {
      source = { type: "vector", tiles: [url] };
    } else if (!url.startsWith("pmtiles://")) {
      /* Inline the TileJSON: some services (basemap.at / ArcGIS VectorTileServer)
         declare RELATIVE tile templates that MapLibre does not resolve, and the
         inlined zoom range prevents 404-storms from overzoom requests. */
      const { fetchTileJson } = await import("../basemaps.js");
      const tj = await fetchTileJson(url).catch(() => null);
      if (tj) {
        source = {
          type: "vector",
          tiles: tj.tiles,
          ...(tj.minzoom !== undefined ? { minzoom: tj.minzoom } : {}),
          ...(tj.maxzoom !== undefined ? { maxzoom: tj.maxzoom } : {}),
          ...(tj.attribution ? { attribution: tj.attribution } : {}),
        };
        if (!this.def.bounds && tj.bounds) this.def.bounds = tj.bounds;
      }
    }
    map.addSource(this.srcId, {
      ...source,
      ...(this.def.attribution ? { attribution: this.def.attribution } : {}),
    } as never);

    this.def.style.forEach((spec: StyleLayerSpec, i) => {
      const id = `m0l-${this.def.id}-${i}`;
      const specObj = spec as Record<string, unknown>;
      map.addLayer({
        ...specObj,
        id,
        source: this.srcId,
        "source-layer": (specObj["source-layer"] as string | undefined) ?? this.def.sourceLayer,
        ...(this.def.minZoom !== undefined ? { minzoom: this.def.minZoom } : {}),
        ...(this.def.maxZoom !== undefined ? { maxzoom: this.def.maxZoom } : {}),
      } as never);
      this.ids.push(id);
      if (spec.type !== "symbol") this.interactive.push(id);
      const paint = specObj.paint as Record<string, unknown> | undefined;
      for (const prop of OPACITY_PROPS[spec.type] ?? []) {
        const base = typeof paint?.[prop] === "number" ? (paint[prop] as number) : 1;
        this.opacityEntries.push([id, prop, base]);
      }
    });
  }

  protected override autoLegend(): LegendSpec | null {
    const entries = deriveFromStyleLayers(this.def.style);
    return entries.length > 0 ? { kind: "entries", entries } : null;
  }

  override async featureInfo(query: FeatureInfoQuery): Promise<FeatureInfoResult | null> {
    if (this.def.popup === false) return null;
    const { map } = this.ctx;
    const pad = 4;
    const hits = map.queryRenderedFeatures(
      [
        [query.point.x - pad, query.point.y - pad],
        [query.point.x + pad, query.point.y + pad],
      ],
      { layers: this.interactive.filter((id) => map.getLayer(id)) },
    );
    if (hits.length === 0) return null;
    return {
      layerId: this.def.id,
      layerTitle: this.def.title,
      popup: this.def.popup,
      features: hits.slice(0, 10).map((f) => (f.properties ?? {}) as Record<string, unknown>),
      highlightFeatures: hits.slice(0, 10).map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: {},
      })),
    };
  }
}
