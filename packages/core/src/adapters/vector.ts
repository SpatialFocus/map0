import type { NormalizedLayer, StyleLayerSpec, VectorLayerDef } from "@map0/schema";
import type { PMTiles, Protocol } from "pmtiles";
import type { TileQuery, TileResult } from "../api.js";
import { deriveFromStyleLayers } from "./legend-derive.js";
import {
  SourceAdapter,
  type FeatureInfoQuery,
  type FeatureInfoResult,
  type LegendSpec,
} from "./types.js";

type NormalizedVector = VectorLayerDef & NormalizedLayer & { type: "vector" };

const PMTILES_PREFIX = "pmtiles://";

let pmtilesProtocol: Promise<Protocol> | undefined;

/**
 * Register the pmtiles:// protocol once, lazily (pmtiles is only loaded when
 * needed). The protocol keeps one PMTiles instance per archive URL, and with it
 * the archive's header and directories; getTile() reads through the same
 * instances, which is why the protocol object is kept rather than just its
 * handler.
 */
export function ensurePmtilesProtocol(): Promise<Protocol> {
  pmtilesProtocol ??= Promise.all([import("maplibre-gl"), import("pmtiles")]).then(
    ([{ addProtocol }, { Protocol }]) => {
      const protocol = new Protocol();
      addProtocol("pmtiles", protocol.tile);
      return protocol;
    },
    (e: unknown) => {
      pmtilesProtocol = undefined; // a failed chunk load may succeed on the next layer
      throw e;
    },
  );
  return pmtilesProtocol;
}

/**
 * The archive behind a pmtiles:// URL: the instance the map's protocol reads
 * from, created and handed to the protocol when the map has not asked for it
 * yet (a hidden layer), so map and host never open an archive twice.
 */
async function pmtilesArchive(url: string): Promise<PMTiles> {
  const [protocol, { PMTiles }] = await Promise.all([ensurePmtilesProtocol(), import("pmtiles")]);
  /* the protocol's own key: the URL without the scheme prefix */
  const key = url.slice(PMTILES_PREFIX.length);
  let archive = protocol.get(key);
  if (!archive) {
    archive = new PMTiles(key);
    protocol.add(archive);
  }
  return archive;
}

/** where the tiles of a non-PMTiles source come from, as MapLibre was given it */
interface TileSource {
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
  scheme?: "xyz" | "tms";
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
  /** set in addToMap for template and TileJSON sources; PMTiles read their header instead */
  private tileSource?: TileSource;

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
      this.tileSource = { tiles: [url] };
    } else if (!url.startsWith(PMTILES_PREFIX)) {
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
          /* inlining must not drop it: MapLibre would read a TMS pyramid upside down */
          ...(tj.scheme ? { scheme: tj.scheme } : {}),
        };
        this.tileSource = { tiles: tj.tiles, minzoom: tj.minzoom, maxzoom: tj.maxzoom, scheme: tj.scheme };
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
      this.filterable.push({ layerId: id, name: spec.id, own: specObj.filter });
      if (spec.type !== "symbol") this.interactive.push(id);
      const paint = specObj.paint as Record<string, unknown> | undefined;
      for (const prop of OPACITY_PROPS[spec.type] ?? []) {
        const value = paint?.[prop];
        const base = typeof value === "number" || Array.isArray(value) ? value : 1;
        this.opacityEntries.push([id, prop, base]);
      }
    });
  }

  protected override autoLegend(): LegendSpec | null {
    const entries = deriveFromStyleLayers(this.def.style);
    return entries.length > 0 ? { kind: "entries", entries } : null;
  }

  override async readTile(query: TileQuery): Promise<TileResult> {
    if (!Number.isFinite(query.zoom)) throw new RangeError(`getTile: zoom must be a number, got ${query.zoom}`);
    const { decodeTile, fetchTile, tileAt, tileZoom, tileUrl } = await import("./vector-tile.js");

    if (this.def.url.startsWith(PMTILES_PREFIX)) {
      const archive = await pmtilesArchive(this.def.url);
      const [header, { TileType }] = await Promise.all([archive.getHeader(), import("pmtiles")]);
      if (header.tileType !== TileType.Mvt) {
        throw new Error(
          `getTile: layer "${this.def.id}" holds tiles of type ${TileType[header.tileType] ?? header.tileType}, not Mapbox Vector Tiles`,
        );
      }
      const z = tileZoom(query.zoom, header.minZoom, header.maxZoom);
      const { x, y } = tileAt(query.lngLat, z);
      const tile = await archive.getZxy(z, x, y);
      return { z, x, y, features: tile ? decodeTile(new Uint8Array(tile.data), { z, x, y }, query) : [] };
    }

    const source = this.tileSource ?? this.loadedSource();
    if (!source?.tiles.length) {
      throw new Error(`getTile: the tile URLs of layer "${this.def.id}" are not known (yet)`);
    }
    const z = tileZoom(query.zoom, source.minzoom, source.maxzoom);
    const { x, y } = tileAt(query.lngLat, z);
    const data = await fetchTile(tileUrl(source.tiles, z, x, y, source.scheme));
    return { z, x, y, features: data ? decodeTile(data, { z, x, y }, query) : [] };
  }

  /** a TileJSON map0 could not read itself, as MapLibre resolved it */
  private loadedSource(): TileSource | undefined {
    const src = this.ctx.map.getSource(this.srcId) as Partial<TileSource> | undefined;
    return src?.tiles
      ? { tiles: src.tiles, minzoom: src.minzoom, maxzoom: src.maxzoom, scheme: src.scheme }
      : undefined;
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
