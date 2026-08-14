import type { GeoJsonLayerDef, NormalizedLayer, SimpleStyle, StyleLayerSpec } from "@map0/schema";
import { deriveFromStyleLayers, entryFromPaint } from "./legend-derive.js";
import {
  SourceAdapter,
  type FeatureInfoQuery,
  type FeatureInfoResult,
  type LegendEntry,
  type LegendSpec,
} from "./types.js";

type NormalizedGeoJson = GeoJsonLayerDef & NormalizedLayer & { type: "geojson" };

const OPACITY_PROPS: Record<string, string[]> = {
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  circle: ["circle-opacity", "circle-stroke-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
  raster: ["raster-opacity"],
  "fill-extrusion": ["fill-extrusion-opacity"],
  heatmap: ["heatmap-opacity"],
};

interface ExpandedStyle {
  fill?: Record<string, unknown>;
  line?: Record<string, unknown>;
  circle?: Record<string, unknown>;
}

/** Split a flat simple-style object into per-geometry paint objects (with defaults). */
export function expandSimpleStyle(style: SimpleStyle | undefined, accent: string): ExpandedStyle {
  const out: ExpandedStyle = {};
  if (style && !Array.isArray(style)) {
    for (const [key, value] of Object.entries(style)) {
      const kind = key.startsWith("fill-")
        ? "fill"
        : key.startsWith("line-")
          ? "line"
          : key.startsWith("circle-")
            ? "circle"
            : null;
      if (!kind) continue;
      (out[kind] ??= {})[key] = value;
    }
  }
  if (!out.fill && !out.line && !out.circle) {
    out.fill = { "fill-color": accent, "fill-opacity": 0.25 };
    out.line = { "line-color": accent, "line-width": 2 };
    out.circle = {
      "circle-color": accent,
      "circle-radius": 5,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    };
  }
  return out;
}

export class GeoJsonAdapter extends SourceAdapter<NormalizedGeoJson> {
  private srcId = `m0s-${this.def.id}`;
  private ids: string[] = [];
  private interactive: string[] = [];
  private derivedLegend: LegendEntry[] = [];

  get sourceIds(): string[] {
    return [this.srcId];
  }
  get layerIds(): string[] {
    return this.ids;
  }
  override get interactiveLayerIds(): string[] {
    return this.interactive;
  }

  private get clusterOpts(): { enabled: boolean; radius: number; maxZoom: number } {
    const c = this.def.cluster;
    if (c === true) return { enabled: true, radius: 50, maxZoom: 14 };
    if (typeof c === "object")
      return { enabled: c.enabled ?? true, radius: c.radius ?? 50, maxZoom: c.maxZoom ?? 14 };
    return { enabled: false, radius: 50, maxZoom: 14 };
  }

  protected addToMap(): void {
    const { map, accent } = this.ctx;
    const cluster = this.clusterOpts;

    map.addSource(this.srcId, {
      type: "geojson",
      data: this.def.data as never,
      ...(cluster.enabled
        ? { cluster: true, clusterRadius: cluster.radius, clusterMaxZoom: cluster.maxZoom }
        : {}),
      ...(this.def.promoteId ? { promoteId: this.def.promoteId } : {}),
      ...(this.def.attribution ? { attribution: this.def.attribution } : {}),
    });

    const zoomRange = {
      ...(this.def.minZoom !== undefined ? { minzoom: this.def.minZoom } : {}),
      ...(this.def.maxZoom !== undefined ? { maxzoom: this.def.maxZoom } : {}),
    };

    if (Array.isArray(this.def.style)) {
      /* full style-spec layers provided by the config author */
      this.derivedLegend = deriveFromStyleLayers(this.def.style);
      this.def.style.forEach((spec: StyleLayerSpec, i) => {
        const id = `m0l-${this.def.id}-${i}`;
        map.addLayer({ ...(spec as object), id, source: this.srcId, ...zoomRange } as never);
        this.ids.push(id);
        this.registerOpacity(id, spec.type, (spec as { paint?: Record<string, unknown> }).paint);
        if (spec.type !== "symbol") this.interactive.push(id);
      });
    } else {
      const expanded = expandSimpleStyle(this.def.style, accent);
      const notClustered = cluster.enabled ? ["!", ["has", "point_count"]] : null;
      for (const [kind, paint] of Object.entries(expanded)) {
        const entry = entryFromPaint(kind, paint);
        if (entry) this.derivedLegend.push(entry);
      }

      if (expanded.fill) {
        const id = `m0l-${this.def.id}-fill`;
        map.addLayer({
          id,
          type: "fill",
          source: this.srcId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: expanded.fill as never,
          ...zoomRange,
        } as never);
        this.ids.push(id);
        this.interactive.push(id);
        this.registerOpacity(id, "fill", expanded.fill);
      }
      if (expanded.line) {
        const id = `m0l-${this.def.id}-line`;
        map.addLayer({
          id,
          type: "line",
          source: this.srcId,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: expanded.line as never,
          ...zoomRange,
        } as never);
        this.ids.push(id);
        this.interactive.push(id);
        this.registerOpacity(id, "line", expanded.line);
      }
      if (expanded.circle) {
        const id = `m0l-${this.def.id}-circle`;
        const filter = notClustered
          ? ["all", ["==", ["geometry-type"], "Point"], notClustered]
          : ["==", ["geometry-type"], "Point"];
        map.addLayer({
          id,
          type: "circle",
          source: this.srcId,
          filter: filter as never,
          paint: expanded.circle as never,
          ...zoomRange,
        } as never);
        this.ids.push(id);
        this.interactive.push(id);
        this.registerOpacity(id, "circle", expanded.circle);
      }

      if (cluster.enabled) {
        /* cluster bubbles (no count label in v0 — needs glyphs; see docs/06-architecture.md) */
        const id = `m0l-${this.def.id}-cluster`;
        map.addLayer({
          id,
          type: "circle",
          source: this.srcId,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": accent,
            "circle-opacity": 0.75,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              14,
              25,
              20,
              100,
              27,
            ],
          } as never,
        } as never);
        this.ids.push(id);
        this.interactive.push(id);
        this.registerOpacity(id, "circle", { "circle-opacity": 0.75 });
      }
    }
  }

  protected override autoLegend(): LegendSpec | null {
    return this.derivedLegend.length > 0
      ? { kind: "entries", entries: this.derivedLegend }
      : null;
  }

  private registerOpacity(
    layerId: string,
    type: string,
    paint: Record<string, unknown> | undefined,
  ): void {
    for (const prop of OPACITY_PROPS[type] ?? []) {
      const base = typeof paint?.[prop] === "number" ? (paint[prop] as number) : 1;
      this.opacityEntries.push([layerId, prop, base]);
    }
  }

  override async featureInfo(query: FeatureInfoQuery): Promise<FeatureInfoResult | null> {
    if (this.def.popup === false) return null;
    const { map } = this.ctx;
    const pad = 4;
    const box: [[number, number], [number, number]] = [
      [query.point.x - pad, query.point.y - pad],
      [query.point.x + pad, query.point.y + pad],
    ];
    const hits = map.queryRenderedFeatures(box, { layers: this.interactive.filter((id) => map.getLayer(id)) });
    const features = hits
      .filter((f) => !(f.properties && "point_count" in f.properties))
      .map((f) => (f.properties ?? {}) as Record<string, unknown>);
    if (features.length === 0) return null;
    /* de-duplicate (tiled sources can return a feature multiple times) */
    const seen = new Set<string>();
    const unique = features.filter((p) => {
      const key = JSON.stringify(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      layerId: this.def.id,
      layerTitle: this.def.title,
      popup: this.def.popup,
      features: unique.slice(0, 10),
    };
  }
}
