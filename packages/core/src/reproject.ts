/**
 * Client-side reprojection of feature data on load — the `crs` key of geojson
 * and geoparquet layers. MapLibre only takes WGS84 input, so a document in a
 * projected CRS is transformed once, position by position, with proj4 (the
 * registry the coordinate readout uses). Rendering stays Web Mercator (D-02):
 * this widens what can be *loaded*, not what can be drawn.
 */
import type { LayerCrs } from "@map0/schema";
import { ensureCrs, loadProj4 } from "./coordinates.js";

/** forward transform: a position in the source CRS → [lng, lat] */
export type Projector = (xy: [number, number]) => [number, number];

export interface CrsSource {
  code: string;
  /** proj4 string or PROJJSON object for a code the built-in registry does not know */
  def?: string | object;
}

const CRS84 =
  /^(?:urn:(?:x-)?ogc:def:crs:OGC(?::[\d.]*)?:CRS84|OGC:CRS84|CRS:?84|https?:\/\/www\.opengis\.net\/def\/crs\/OGC\/[\d.]+\/CRS84)$/i;

/**
 * The spellings a CRS turns up in — GeoJSON `crs` members, WFS/OGC API
 * responses, PROJJSON ids — folded to "EPSG:31256" / "OGC:CRS84".
 */
export function normalizeCrsCode(name: string): string {
  const s = name.trim();
  if (CRS84.test(s)) return "OGC:CRS84";
  const m =
    /^urn:(?:x-)?ogc:def:crs:([A-Za-z]+):[\d.]*:(\w+)$/i.exec(s) ??
    /^https?:\/\/www\.opengis\.net\/def\/crs\/([A-Za-z]+)\/[\d.]+\/(\w+)$/i.exec(s) ??
    /^https?:\/\/www\.opengis\.net\/gml\/srs\/([A-Za-z]+)\.xml#(\w+)$/i.exec(s) ??
    /^([A-Za-z]+):(?:[\d.]+:)?(\w+)$/.exec(s);
  if (m) return `${m[1]!.toUpperCase()}:${m[2]!.toUpperCase()}`;
  if (/^\d+$/.test(s)) return `EPSG:${s}`;
  return s;
}

/**
 * Coordinates MapLibre can take as they are. ETRS89 (EPSG:4258) is included
 * on purpose: it differs from WGS84 by well under a metre, and proj4 without
 * datum parameters would return the identical numbers anyway.
 */
export function isWgs84Code(code: string): boolean {
  const c = normalizeCrsCode(code);
  return c === "OGC:CRS84" || c === "EPSG:4326" || c === "EPSG:4258";
}

/** layer `crs` config → source description (null when there is none) */
export function layerCrs(crs: LayerCrs | undefined): CrsSource | null {
  if (!crs) return null;
  if (typeof crs === "string") return { code: normalizeCrsCode(crs) };
  return { code: normalizeCrsCode(crs.code), def: crs.def };
}

/**
 * The `crs` member of the 2008 GeoJSON spec — dropped by RFC 7946 but still
 * written by GeoServer and friends when a GetFeature asks for a projected
 * srsName. Returns the normalized code, or null when there is no such member.
 */
export function declaredGeoJsonCrs(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const crs = (data as { crs?: unknown }).crs;
  if (typeof crs !== "object" || crs === null) return null;
  const { type, properties } = crs as { type?: unknown; properties?: Record<string, unknown> };
  if (type === "name" && typeof properties?.name === "string") {
    return normalizeCrsCode(properties.name);
  }
  if (type === "EPSG" && (typeof properties?.code === "number" || typeof properties?.code === "string")) {
    return `EPSG:${properties.code}`;
  }
  return null;
}

/**
 * Forward transform CRS → WGS84 lon/lat, or null when the coordinates already
 * are WGS84 (nothing to do). Throws for a CRS neither the built-in registry nor
 * proj4 can resolve — the message says what the config needs.
 */
export async function projectorToWgs84(crs: CrsSource): Promise<Projector | null> {
  if (isWgs84Code(crs.code)) return null;
  const p = await loadProj4();
  if (!ensureCrs(p, crs.code, crs.def)) {
    throw new Error(
      `unknown CRS "${crs.code}" — add a proj4 definition to the layer: ` +
        `"crs": { "code": "${crs.code}", "def": "+proj=…" }`,
    );
  }
  let converter: { forward: (xy: [number, number]) => [number, number] };
  try {
    converter = p(crs.code, "EPSG:4326") as typeof converter;
  } catch (e) {
    throw new Error(
      `the definition of "${crs.code}" is not usable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return (xy) => converter.forward(xy);
}

/**
 * A copy of any GeoJSON value with every position transformed. The input is
 * left untouched — inline data *is* the config object, which is normalized
 * again when the element reconnects. Stale `bbox` members and the legacy `crs`
 * member are dropped; properties are shared by reference (never mutated).
 */
export function reprojectGeoJson<T>(data: T, project: Projector): T {
  const positions = (coords: unknown): unknown => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") {
      const [x, y, ...rest] = coords as number[];
      const [lng, lat] = project([x!, y!]);
      return rest.length > 0 ? [lng, lat, ...rest] : [lng, lat];
    }
    return coords.map(positions);
  };
  const walk = (node: unknown): unknown => {
    if (typeof node !== "object" || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "bbox" || key === "crs") continue;
      if (key === "coordinates") out[key] = positions(value);
      else if (key === "features" || key === "geometries")
        out[key] = Array.isArray(value) ? value.map(walk) : value;
      else if (key === "geometry") out[key] = walk(value);
      else out[key] = value;
    }
    return out;
  };
  return walk(data) as T;
}
