import type { NormalizedLayer, WmsLayerDef } from "@map0/schema";
import { lngLatToMercator } from "../mercator.js";
import { SourceAdapter, type FeatureInfoQuery, type FeatureInfoResult } from "./types.js";

type NormalizedWms = WmsLayerDef & NormalizedLayer & { type: "wms" };

interface WmsParams {
  url: string;
  layers: string;
  styles?: string;
  format?: string;
  version?: "1.1.1" | "1.3.0";
  transparent?: boolean;
  tileSize?: number;
  params?: Record<string, string>;
}

/** Merge base-URL query params (kept — MapServer `map=` etc.) with WMS params. */
function baseAndParams(def: WmsParams, extra: Record<string, string>): string {
  const url = new URL(def.url, typeof location !== "undefined" ? location.href : "http://localhost/");
  const search = new URLSearchParams(url.search);
  const version = def.version ?? "1.3.0";
  const merged: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: version,
    ...extra,
    ...(def.params ?? {}),
  };
  for (const [k, v] of Object.entries(merged)) search.set(k, v);
  url.search = search.toString();
  return url.toString();
}

/** GetMap tile URL template for a MapLibre raster source ({bbox-epsg-3857} stays literal). */
export function buildWmsTileUrl(def: WmsParams): string {
  const version = def.version ?? "1.3.0";
  const size = String(def.tileSize ?? 256);
  const url = baseAndParams(def, {
    REQUEST: "GetMap",
    LAYERS: def.layers,
    STYLES: def.styles ?? "",
    FORMAT: def.format ?? "image/png",
    TRANSPARENT: (def.transparent ?? true) ? "TRUE" : "FALSE",
    WIDTH: size,
    HEIGHT: size,
    [version === "1.3.0" ? "CRS" : "SRS"]: "EPSG:3857",
  });
  // BBOX must remain un-encoded so MapLibre substitutes it per tile.
  return `${url}&BBOX={bbox-epsg-3857}`;
}

/** GetFeatureInfo URL for a click, using a window of `size` px centered on the click. */
export function buildGetFeatureInfoUrl(
  def: WmsParams,
  opts: {
    bbox3857: [number, number, number, number];
    size: number;
    i: number;
    j: number;
    infoFormat: string;
    featureCount?: number;
  },
): string {
  const version = def.version ?? "1.3.0";
  const px: Record<string, string> =
    version === "1.3.0"
      ? { I: String(opts.i), J: String(opts.j) }
      : { X: String(opts.i), Y: String(opts.j) };
  return baseAndParams(def, {
    REQUEST: "GetFeatureInfo",
    LAYERS: def.layers,
    QUERY_LAYERS: def.layers,
    STYLES: def.styles ?? "",
    [version === "1.3.0" ? "CRS" : "SRS"]: "EPSG:3857",
    BBOX: opts.bbox3857.join(","),
    WIDTH: String(opts.size),
    HEIGHT: String(opts.size),
    INFO_FORMAT: opts.infoFormat,
    FEATURE_COUNT: String(opts.featureCount ?? 10),
    ...px,
  });
}

/** GetLegendGraphic URL (used by the TOC/legend from M1; built here so the schema key works). */
export function buildLegendUrl(def: WmsParams): string {
  return baseAndParams(def, {
    REQUEST: "GetLegendGraphic",
    FORMAT: "image/png",
    LAYER: def.layers.split(",")[0] ?? def.layers,
    SLD_VERSION: "1.1.0",
  });
}

export class WmsAdapter extends SourceAdapter<NormalizedWms> {
  private srcId = `m0s-${this.def.id}`;
  private lyrId = `m0l-${this.def.id}`;

  get sourceIds(): string[] {
    return [this.srcId];
  }
  get layerIds(): string[] {
    return [this.lyrId];
  }

  protected addToMap(): void {
    const { map } = this.ctx;
    const tileSize = this.def.tileSize ?? 256;
    map.addSource(this.srcId, {
      type: "raster",
      tiles: [buildWmsTileUrl(this.def)],
      tileSize,
      ...(this.def.attribution ? { attribution: this.def.attribution } : {}),
    });
    map.addLayer({
      id: this.lyrId,
      type: "raster",
      source: this.srcId,
      ...(this.def.minZoom !== undefined ? { minzoom: this.def.minZoom } : {}),
      ...(this.def.maxZoom !== undefined ? { maxzoom: this.def.maxZoom } : {}),
      paint: { "raster-opacity": 1 },
    });
    this.opacityEntries = [[this.lyrId, "raster-opacity", 1]];
  }

  override async featureInfo(query: FeatureInfoQuery): Promise<FeatureInfoResult | null> {
    const info = this.def.info;
    if (!info || info === undefined) return null;
    const { map } = this.ctx;

    const SIZE = 101;
    const HALF = (SIZE - 1) / 2;
    const { point } = query;
    const sw = map.unproject([point.x - HALF, point.y + HALF]);
    const ne = map.unproject([point.x + HALF, point.y - HALF]);
    const [minx, miny] = lngLatToMercator(sw.lng, sw.lat);
    const [maxx, maxy] = lngLatToMercator(ne.lng, ne.lat);

    const infoFormat = info.format ?? "application/json";
    const url = buildGetFeatureInfoUrl(this.def, {
      bbox3857: [minx, miny, maxx, maxy],
      size: SIZE,
      i: HALF,
      j: HALF,
      infoFormat,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`GetFeatureInfo HTTP ${res.status}`);
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        const body = (await res.json()) as {
          features?: Array<{ properties?: Record<string, unknown> }>;
        };
        const features = (body.features ?? [])
          .map((f) => f.properties ?? {})
          .filter((p) => Object.keys(p).length > 0);
        if (features.length === 0) return null;
        return { layerId: this.def.id, layerTitle: this.def.title, popup: info, features };
      }
      const text = await res.text();
      if (!text.trim()) return null;
      return { layerId: this.def.id, layerTitle: this.def.title, popup: info, features: [], html: text };
    } finally {
      clearTimeout(timeout);
    }
  }
}
