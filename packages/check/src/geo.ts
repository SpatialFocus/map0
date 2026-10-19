/**
 * Geometry helpers for the probes: tile arithmetic and axis-order checks. The
 * Web Mercator rules themselves (isMercatorCrs, scaleDenominatorToZoom, bbox
 * coercion) come from @map0/core, so the checker can never disagree with map0.
 */
import { asBbox, type Bbox } from "@map0/core";

export type LonLat = [number, number];
export type BBox = Bbox;

/** EPSG:4326 in any of its spellings, or CRS84 */
export function isWgs84Crs(code: string): boolean {
  return /(^|\D)4326($|\D)|CRS:?84$/i.test(code);
}

/** OGC standard pixel size in metres (WMS 1.3 / WMTS scale denominators) */
export const OGC_PIXEL_M = 0.00028;
/** half-width of the EPSG:3857 world square in metres */
export const MERC_MAX = 20037508.342789244;
/** a sensible probe location when a layer advertises no bounds */
export const AUSTRIA_CENTER: LonLat = [13.35, 47.6];

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function isLonLatBbox(b: unknown): b is BBox {
  if (!Array.isArray(b) || b.length !== 4) return false;
  const [w, s, e, n] = b as unknown[];
  if (![w, s, e, n].every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  const [W, S, E, N] = [w, s, e, n] as number[];
  return W! >= -180 && E! <= 180 && S! >= -90 && N! <= 90 && W! <= E! && S! <= N!;
}

/** a WGS84 bbox from whatever a capabilities parser hands over, or undefined */
export function lonLatBbox(value: unknown): BBox | undefined {
  const b = asBbox(value);
  return b && isLonLatBbox(b) ? b : undefined;
}

export function bboxCenter(b: BBox): LonLat {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

export function inBbox([lon, lat]: LonLat, b: BBox): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** the coordinate misses the bbox but its swapped twin hits it — the classic lat/lon axis-order slip */
export function looksAxisSwapped(c: LonLat, b: BBox): boolean {
  return !inBbox(c, b) && inBbox([c[1], c[0]], b);
}

export function lonLatToMercator([lon, lat]: LonLat): [number, number] {
  const x = (lon / 180) * MERC_MAX;
  const clamped = clamp(lat, -85.05112878, 85.05112878);
  const y = (Math.log(Math.tan(((90 + clamped) * Math.PI) / 360)) / (Math.PI / 180) / 180) * MERC_MAX;
  return [x, y];
}

/** XYZ tile that contains a lon/lat at zoom z */
export function lonLatToTile([lon, lat]: LonLat, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: clamp(x, 0, n - 1), y: clamp(y, 0, n - 1) };
}

/** EPSG:3857 extent of an XYZ tile, as WMS BBOX [minx, miny, maxx, maxy] */
export function tileBbox3857(z: number, x: number, y: number): BBox {
  const size = (2 * MERC_MAX) / 2 ** z;
  const minx = -MERC_MAX + x * size;
  const maxy = MERC_MAX - y * size;
  return [minx, maxy - size, minx + size, maxy];
}

/** a probe zoom inside the layer's advertised range, preferring `preferred` */
export function chooseZoom(minZoom?: number, maxZoom?: number, preferred = 8): number {
  let z = preferred;
  if (minZoom !== undefined) z = Math.max(z, minZoom);
  if (maxZoom !== undefined) z = Math.min(z, maxZoom);
  return clamp(Math.round(z), 0, 22);
}

export interface TileMatrixLike {
  identifier: string;
  scaleDenominator: number;
  topLeft: [number, number];
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
}

/**
 * WMTS tile indices for a lon/lat in a WebMercator TileMatrix (OGC 07-057 Annex H).
 * The top-left corner is normalised by sign: some servers publish it as "x y",
 * others (URN axis order) as "y x" — for Mercator both values have the same
 * magnitude, so the negative one is x and the positive one is y.
 */
export function wmtsTileIndex(ll: LonLat, tm: TileMatrixLike): { col: number; row: number } {
  const [x, y] = lonLatToMercator(ll);
  const res = tm.scaleDenominator * OGC_PIXEL_M;
  const tlx = Math.min(tm.topLeft[0], tm.topLeft[1]);
  const tly = Math.max(tm.topLeft[0], tm.topLeft[1]);
  const col = clamp(Math.floor((x - tlx) / (res * tm.tileWidth)), 0, Math.max(0, tm.matrixWidth - 1));
  const row = clamp(Math.floor((tly - y) / (res * tm.tileHeight)), 0, Math.max(0, tm.matrixHeight - 1));
  return { col, row };
}

/** first position of any GeoJSON geometry, or undefined */
export function firstCoordinate(geometry: unknown): LonLat | undefined {
  if (!geometry || typeof geometry !== "object") return undefined;
  const g = geometry as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  if (g.type === "GeometryCollection") {
    for (const child of g.geometries ?? []) {
      const c = firstCoordinate(child);
      if (c) return c;
    }
    return undefined;
  }
  let cur: unknown = g.coordinates;
  while (Array.isArray(cur) && Array.isArray(cur[0])) cur = cur[0];
  if (Array.isArray(cur) && cur.length >= 2 && typeof cur[0] === "number" && typeof cur[1] === "number") {
    return [cur[0], cur[1]];
  }
  return undefined;
}

/** union of WGS84 bboxes, or undefined when none is usable */
export function unionBbox(boxes: Array<BBox | undefined>): BBox | undefined {
  let out: BBox | undefined;
  for (const b of boxes) {
    if (!b || !isLonLatBbox(b)) continue;
    out = out
      ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])]
      : [b[0], b[1], b[2], b[3]];
  }
  return out;
}

/** round bbox values for readable snippets */
export function roundBbox(b: BBox, digits = 4): BBox {
  const f = 10 ** digits;
  const r = (v: number): number => Math.round(v * f) / f;
  return [r(b[0]), r(b[1]), r(b[2]), r(b[3])];
}
