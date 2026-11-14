/**
 * Reading single vector tiles for a host page (api.layers.getTile). A chunk of
 * its own, loaded on the first call: the decoder (@mapbox/vector-tile + pbf) is
 * nothing drawing a map needs — MapLibre decodes in its worker.
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { TileFeature, TileQuery } from "../api.js";

/** the latitude where the Web Mercator tile pyramid ends */
const MAX_LAT = 85.0511287798066;

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** the zoom level to read: rounded down, then held inside the source's zoom range */
export function tileZoom(zoom: number, minzoom?: number, maxzoom?: number): number {
  let z = Math.floor(zoom);
  if (maxzoom !== undefined) z = Math.min(z, maxzoom);
  if (minzoom !== undefined) z = Math.max(z, minzoom);
  return Math.max(0, z);
}

/** the tile of zoom level `z` that contains a position; longitudes wrap, latitudes clamp */
export function tileAt(lngLat: TileQuery["lngLat"], z: number): { x: number; y: number } {
  const [lng, lat] = "lng" in lngLat ? [lngLat.lng, lngLat.lat] : lngLat;
  /* NaN would travel on as tile NaN/NaN, and the answer would look like an empty tile */
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new RangeError(`getTile: lngLat must be two numbers, got ${lng}, ${lat}`);
  }
  const n = 2 ** z;
  const fx = ((((lng + 180) % 360) + 360) % 360) / 360;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const fy = (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2;
  const cell = (f: number): number => Math.max(0, Math.min(n - 1, Math.floor(f * n)));
  return { x: cell(fx), y: cell(fy) };
}

/** half the extent of Web Mercator in metres */
const MERCATOR_HALF = Math.PI * 6378137;

/**
 * The URL of one tile, built the way MapLibre builds it (CanonicalTileID.url):
 * the same pick among several templates — `(x + y) % n` — and the same
 * placeholders, `{quadkey}`, `{bbox-epsg-3857}`, `{prefix}` and `{ratio}`
 * included, with `y` counted from the south for `scheme: "tms"`. So the host
 * gets the tile the map draws, and from the HTTP cache when the map drew it.
 */
export function tileUrl(
  templates: readonly string[],
  z: number,
  x: number,
  y: number,
  scheme?: "xyz" | "tms",
): string {
  const template = templates[(x + y) % templates.length]!;
  const n = 2 ** z;
  let quadkey = "";
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    quadkey += (x & mask ? 1 : 0) + (y & mask ? 2 : 0);
  }
  const merc = (cell: number): number => (cell / n) * 2 * MERCATOR_HALF - MERCATOR_HALF;
  const bbox = [merc(x), merc(n - y - 1), merc(x + 1), merc(n - y)].join(",");
  return template
    .replace(/\{prefix\}/g, (x % 16).toString(16) + (y % 16).toString(16))
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(scheme === "tms" ? n - y - 1 : y))
    .replace(/\{ratio\}/g, (globalThis.devicePixelRatio ?? 1) > 1 ? "@2x" : "")
    .replace(/\{quadkey\}/g, quadkey)
    .replace(/\{bbox-epsg-3857\}/g, bbox);
}

/**
 * Fetch one tile's bytes; null for a tile the server does not have (404/204).
 * A body still gzip-compressed (stored compressed and served without a
 * Content-Encoding header) is unpacked here.
 */
export async function fetchTile(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (res.status === 404 || res.status === 204) return null;
  if (!res.ok) throw new Error(`getTile: fetching ${url} failed: ${res.status} ${res.statusText}`);
  return gunzipIfNeeded(new Uint8Array(await res.arrayBuffer()));
}

async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decode a Mapbox Vector Tile into GeoJSON features with WGS84 coordinates,
 * each tagged with the source layer it came from.
 */
export function decodeTile(
  data: Uint8Array,
  { z, x, y }: TileCoord,
  { sourceLayer, geometry = true }: Pick<TileQuery, "sourceLayer" | "geometry"> = {},
): TileFeature[] {
  const tile = new VectorTile(new PbfReader(data));
  const names = sourceLayer === undefined ? Object.keys(tile.layers) : [sourceLayer];
  const features: TileFeature[] = [];
  for (const name of names) {
    const layer = tile.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      /* type 0 is "unknown" in the MVT spec: there is no geometry to convert */
      if (geometry && feature.type !== 0) {
        features.push({ ...feature.toGeoJSON(x, y, z), sourceLayer: name });
      } else {
        features.push({
          type: "Feature",
          ...(feature.id !== undefined ? { id: feature.id } : {}),
          geometry: null,
          properties: feature.properties,
          sourceLayer: name,
        });
      }
    }
  }
  return features;
}
