import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { NormalizedBasemap } from "@map0/schema";
import { Signal } from "./signals.js";

/**
 * Resolve a relative URL against the style URL WITHOUT the URL constructor —
 * templates like "{fontstack}/{range}.pbf" must keep their braces un-encoded.
 * Real-world need: basemap.at styles ship relative sprite/glyph paths, which
 * MapLibre v6 rejects ("Invalid sprite URL … must be absolute").
 */
function absolutizeUrl(value: string, styleUrl: string): string {
  if (/^(https?:|data:|pmtiles:|mapbox:)/i.test(value)) return value;
  const base = new URL(styleUrl);
  if (value.startsWith("//")) return base.protocol + value;
  if (value.startsWith("/")) return base.origin + value;
  const segs = base.pathname.split("/");
  segs.pop(); // drop the style file name
  for (const part of value.split("/")) {
    if (part === "..") segs.pop();
    else if (part !== ".") segs.push(part);
  }
  return base.origin + segs.join("/");
}

function absolutizeStyle(style: StyleSpecification, styleUrl: string): void {
  if (typeof style.sprite === "string") {
    style.sprite = absolutizeUrl(style.sprite, styleUrl);
  } else if (Array.isArray(style.sprite)) {
    for (const s of style.sprite) s.url = absolutizeUrl(s.url, styleUrl);
  }
  if (typeof style.glyphs === "string") {
    style.glyphs = absolutizeUrl(style.glyphs, styleUrl);
  }
  for (const source of Object.values(style.sources ?? {})) {
    const s = source as { url?: string; tiles?: string[] };
    if (typeof s.url === "string") s.url = absolutizeUrl(s.url, styleUrl);
    if (Array.isArray(s.tiles)) s.tiles = s.tiles.map((tpl) => absolutizeUrl(tpl, styleUrl));
  }
}

/**
 * Inline TileJSON sources referenced by `url`. Two real-world reasons:
 * (a) some TileJSON responses (e.g. basemap.at / ArcGIS VectorTileServer) declare
 *     RELATIVE `tiles` templates, which MapLibre v6 does not resolve — the map
 *     silently loads no tiles; (b) inlining lets us keep one style object.
 * Style-level source keys win over TileJSON keys (per TileJSON merge semantics).
 */
async function inlineTileJsonSources(style: StyleSpecification, styleUrl: string): Promise<void> {
  const jobs = Object.values(style.sources ?? {}).map(async (source) => {
    const s = source as {
      type?: string;
      url?: string;
      tiles?: string[];
      [k: string]: unknown;
    };
    if (!s.url || s.tiles) return;
    if (s.type !== "vector" && s.type !== "raster" && s.type !== "raster-dem") return;
    try {
      const res = await fetch(s.url);
      if (!res.ok) return; // leave the source untouched; MapLibre will report it
      const tj = (await res.json()) as { tiles?: string[]; [k: string]: unknown };
      if (!Array.isArray(tj.tiles)) return;
      const base = res.url || s.url;
      for (const [key, value] of Object.entries(tj)) {
        if (!(key in s)) (s as Record<string, unknown>)[key] = value;
      }
      s.tiles = tj.tiles.map((t) => absolutizeUrl(t, base));
      delete s.url;
    } catch {
      /* network hiccup — keep the original source */
    }
  });
  await Promise.all(jobs);
  void styleUrl;
}

const styleCache = new Map<string, StyleSpecification>();

/** Fetch + fix a style-URL basemap; raster/empty basemaps resolve synchronously. */
export async function resolveBasemapStyle(
  bm: NormalizedBasemap,
  background: string,
): Promise<string | StyleSpecification> {
  if (bm.type !== "style") return basemapStyle(bm, background);
  const url = bm.url!;
  const cached = styleCache.get(url);
  if (cached) return structuredClone(cached);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`basemap style fetch failed: HTTP ${res.status} (${url})`);
  const style = (await res.json()) as StyleSpecification;
  absolutizeStyle(style, res.url || url);
  await inlineTileJsonSources(style, res.url || url);
  styleCache.set(url, style);
  return structuredClone(style);
}

/** Build the MapLibre style (URL or synthetic) for a basemap definition. */
export function basemapStyle(
  bm: NormalizedBasemap,
  background: string,
): string | StyleSpecification {
  if (bm.type === "style") return bm.url!;
  if (bm.type === "raster") {
    return {
      version: 8,
      name: `map0-basemap-${bm.id}`,
      sources: {
        "m0-basemap": {
          type: "raster",
          tiles: [bm.url!],
          tileSize: bm.tileSize ?? 256,
          ...(bm.maxZoom !== undefined ? { maxzoom: bm.maxZoom } : {}),
          ...(bm.attribution ? { attribution: bm.attribution } : {}),
        },
      },
      layers: [
        { id: "m0-background", type: "background", paint: { "background-color": background } },
        { id: "m0-basemap", type: "raster", source: "m0-basemap" },
      ],
    };
  }
  /* empty */
  return {
    version: 8,
    name: "map0-empty",
    sources: {},
    layers: [
      { id: "m0-background", type: "background", paint: { "background-color": background } },
    ],
  };
}

export interface OverlayIds {
  sources: Set<string>;
  layers: Set<string>;
}

/**
 * Switches basemaps without losing overlays: MapLibre's setStyle() drops runtime
 * sources/layers, so we re-inject them via transformStyle (docs/06-architecture.md).
 */
export class BasemapManager {
  readonly current: Signal<string>;

  constructor(
    private readonly map: MapLibreMap,
    private readonly basemaps: NormalizedBasemap[],
    initialId: string,
    private readonly getOverlays: () => OverlayIds,
    private readonly background: string,
  ) {
    this.current = new Signal(initialId);
  }

  get all(): NormalizedBasemap[] {
    return this.basemaps;
  }

  private switchSeq = 0;

  async switchTo(id: string): Promise<void> {
    if (id === this.current.value) return;
    const bm = this.basemaps.find((b) => b.id === id);
    if (!bm) return;
    const seq = ++this.switchSeq;
    const style = await resolveBasemapStyle(bm, this.background);
    if (seq !== this.switchSeq) return; // a newer switch superseded this one
    const overlays = this.getOverlays();
    this.map.setStyle(style as never, {
      diff: false,
      transformStyle: (prev, next) => {
        if (!prev) return next;
        const sources = { ...next.sources };
        for (const sid of overlays.sources) {
          const s = prev.sources?.[sid];
          if (s) sources[sid] = s;
        }
        const keep = (prev.layers ?? []).filter((l) => overlays.layers.has(l.id));
        return {
          ...next,
          ...(prev.projection ? { projection: prev.projection } : {}),
          sources,
          layers: [...(next.layers ?? []), ...keep],
        };
      },
    });
    this.current.value = id;
  }
}
