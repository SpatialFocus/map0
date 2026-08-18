import type { NormalizedLayer, WmtsLayerDef } from "@map0/schema";
import { mercatorToLngLat } from "../mercator.js";
import { loadOgcClient } from "../ogc.js";
import { SourceAdapter, type LegendSpec } from "./types.js";

interface ResourceLinkLike {
  url: string;
  encoding: "REST" | "KVP";
  format: string;
}

/** capabilities URL → origin that answered a probe tile (per session) */
const liveOrigins = new Map<string, string>();

/** slippy-tile coordinates for a lon/lat at zoom z */
export function tileAt(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.min(Math.max(x, 0), n - 1), y: Math.min(Math.max(y, 0), n - 1) };
}

type NormalizedWmts = WmtsLayerDef & NormalizedLayer & { type: "wmts" };

/** WMTS capabilities express CRS codes in many spellings — match the Mercator family. */
export function isMercatorCrs(code: string): boolean {
  return /(^|\D)(3857|900913|102100|102113)($|\D)/.test(code);
}

/**
 * Can the browser decode this tile format into an image?
 *
 * A WMTS layer commonly advertises more than pictures — GeoServer/GWC lists
 * `application/vnd.mapbox-vector-tile` **first** for every vector-backed layer.
 * Feeding that to a MapLibre `raster` source yields a silent decode failure, so
 * the adapter must pick an image format explicitly instead of trusting the
 * capabilities order. Loose prefix match on purpose: GeoServer ships variants
 * like `image/png8` and `image/vnd.jpeg-png`.
 */
export function isRasterTileFormat(format: string | undefined): boolean {
  return /^image\/(png|jpe?g|webp|avif|gif|vnd\.jpeg-png)/i.test(format ?? "");
}

/**
 * Narrow capabilities resource links to the usable image-tile candidates.
 * A requested format wins if advertised; capabilities that omit it may still
 * serve it, so an unmatched request falls back to the other image formats
 * instead of failing. Returns `[]` when the layer is vector-only.
 */
export function pickRasterLinks<T extends { format: string }>(links: T[], wanted?: string): T[] {
  const raster = links.filter((r) => isRasterTileFormat(r.format));
  const exact = wanted ? raster.filter((r) => r.format === wanted) : [];
  return exact.length > 0 ? exact : raster;
}

export interface MatrixSetLimitLike {
  tileMatrix: string;
  minTileRow: number;
  maxTileRow: number;
  minTileCol: number;
  maxTileCol: number;
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

export interface WmtsCoverage {
  /** [west, south, east, north] of the served tile rectangle */
  bounds?: [number, number, number, number];
  /** first / last zoom level the server has tiles for */
  minzoom?: number;
  maxzoom?: number;
}

/** OGC standardized rendering pixel size: scaleDenominator × this = resolution in m/px */
const OGC_PIXEL_M = 0.00028;

/** half-width of the EPSG:3857 world square in metres */
const MERC_MAX = 20037508.342789244;

/**
 * TopLeftCorner axis order is a coin flip in the wild: one GeoServer document
 * publishes EPSG:900913 as "x y" and WebMercatorQuad as "y x" (URN axis
 * rules). A real top-left corner keeps the whole matrix inside the world
 * square, so try both readings and keep the one that fits; as-given wins a
 * tie. Wrong pick would mean a degenerate clip — an empty map, not a 400.
 */
function orientTopLeft(m: TileMatrixLike, spanX: number, spanY: number): [number, number] {
  const LIMIT = MERC_MAX * 1.01;
  const fits = (x: number, y: number): boolean =>
    Math.abs(x) <= LIMIT &&
    Math.abs(y) <= LIMIT &&
    x + m.matrixWidth * spanX <= LIMIT &&
    y - m.matrixHeight * spanY >= -LIMIT;
  const [a, b] = m.topLeft;
  if (!fits(a, b) && fits(b, a)) return [b, a];
  return [a, b];
}

/**
 * What the server will actually serve, from the layer's TileMatrixSetLimits.
 *
 * GeoWebCache answers any tile outside a regional layer's per-level row/column
 * range with **400 TileOutOfRange** instead of an empty tile, so the source
 * must not request them in the first place. MapLibre can't express per-level
 * limits, but for a quadtree pyramid it doesn't need to: the geographic
 * footprint of the *deepest* level's limits (the layer extent snapped outward
 * to the finest tile grid) lies within every coarser level's footprint, so a
 * source `bounds` derived from it never produces an out-of-range request.
 *
 * The zoom range comes from which levels are listed at all — a level missing
 * from the limits is TileOutOfRange territory too (GWC zoomStart/zoomStop).
 *
 * `matrices` must be sorted by zoom (index = {z}, largest scale denominator
 * first), same as the template mapping. Returns `{}` when no usable limit
 * matches a known matrix identifier.
 */
export function coverageFromLimits(
  limits: MatrixSetLimitLike[],
  matrices: TileMatrixLike[],
): WmtsCoverage {
  const zOf = new Map(matrices.map((m, z) => [m.identifier, z]));
  let minzoom: number | undefined;
  let maxzoom: number | undefined;
  let deepest: { z: number; limit: MatrixSetLimitLike } | undefined;
  for (const limit of limits) {
    const z = zOf.get(limit.tileMatrix);
    /* tolerate garbage entries (NaN from empty elements, inverted ranges) */
    if (z === undefined) continue;
    if (!(limit.minTileCol <= limit.maxTileCol) || !(limit.minTileRow <= limit.maxTileRow)) continue;
    if (minzoom === undefined || z < minzoom) minzoom = z;
    if (maxzoom === undefined || z > maxzoom) maxzoom = z;
    if (!deepest || z > deepest.z) deepest = { z, limit };
  }
  if (!deepest) return {};

  const m = matrices[deepest.z]!;
  const { limit } = deepest;
  const spanX = m.tileWidth * m.scaleDenominator * OGC_PIXEL_M;
  const spanY = m.tileHeight * m.scaleDenominator * OGC_PIXEL_M;
  const [originX, originY] = orientTopLeft(m, spanX, spanY);
  /* The edges land exactly on tile boundaries, where MapLibre's floor/ceil
     tile cover would request a neighbouring out-of-range tile over float
     noise — or over the ~5 mm print rounding of capabilities coordinates
     (GeoServer emits "2.003750834E7"). Pull the edges in by 1% of a tile,
     at least 2 cm: invisible on the ground, and the cover equals the
     server's range at every level. */
  const insetX = Math.max(spanX / 100, 0.02);
  const insetY = Math.max(spanY / 100, 0.02);
  const [west, south] = mercatorToLngLat(
    originX + limit.minTileCol * spanX + insetX,
    originY - (limit.maxTileRow + 1) * spanY + insetY,
  );
  const [east, north] = mercatorToLngLat(
    originX + (limit.maxTileCol + 1) * spanX - insetX,
    originY - limit.minTileRow * spanY - insetY,
  );
  /* a clip that is wrong is far worse than no clip (it blanks the layer) —
     refuse anything degenerate and let the caller fall back to the bbox.
     The zoom range stays: it never depends on the corner coordinates. */
  if (!(west < east && south < north)) return { minzoom, maxzoom };
  return { bounds: [west, south, east, north], minzoom, maxzoom };
}

export interface WmtsTemplateParts {
  encoding: "REST" | "KVP";
  resourceUrl: string;
  layer: string;
  style: string;
  matrixSet: string;
  format: string;
  /** tile matrix identifiers indexed by zoom level (sorted large→small scale denominator) */
  matrixIds: string[];
}

/**
 * Turn WMTS resource info into a MapLibre {z}/{x}/{y} raster template.
 * Handles plain-numeric matrix ids ("0".."19") and prefixed ones ("EPSG:3857:0").
 */
export function buildWmtsTemplate(parts: WmtsTemplateParts): string {
  /* map {z} onto the matrix identifiers */
  const plain = parts.matrixIds.every((id, i) => id === String(i));
  let matrixToken: string;
  if (plain) {
    matrixToken = "{z}";
  } else {
    const suffixOk = parts.matrixIds.every((id, i) => id.endsWith(`:${i}`));
    const prefixes = new Set(parts.matrixIds.map((id) => id.slice(0, id.lastIndexOf(":"))));
    if (suffixOk && prefixes.size === 1) {
      matrixToken = `${[...prefixes][0]}:{z}`;
    } else {
      throw new Error(
        `unsupported WMTS tile matrix identifiers (e.g. "${parts.matrixIds[0]}") — cannot map to {z}`,
      );
    }
  }

  if (parts.encoding === "REST") {
    return parts.resourceUrl
      .replace(/\{style\}/gi, parts.style)
      .replace(/\{tilematrixset\}/gi, parts.matrixSet)
      .replace(/\{tilematrix\}/gi, matrixToken)
      .replace(/\{tilerow\}/gi, "{y}")
      .replace(/\{tilecol\}/gi, "{x}");
  }

  /* KVP GetTile template */
  const sep = parts.resourceUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    SERVICE: "WMTS",
    REQUEST: "GetTile",
    VERSION: "1.0.0",
    LAYER: parts.layer,
    STYLE: parts.style,
    TILEMATRIXSET: parts.matrixSet,
    FORMAT: parts.format,
  });
  return `${parts.resourceUrl}${sep}${params.toString()}&TILEMATRIX=${matrixToken}&TILEROW={y}&TILECOL={x}`;
}

export class WmtsAdapter extends SourceAdapter<NormalizedWmts> {
  private srcId = `m0s-${this.def.id}`;
  private lyrId = `m0l-${this.def.id}`;
  private legendUrl: string | null = null;

  get sourceIds(): string[] {
    return [this.srcId];
  }
  get layerIds(): string[] {
    return [this.lyrId];
  }

  protected override async addToMap(): Promise<void> {
    const { map } = this.ctx;
    const { WmtsEndpoint } = await loadOgcClient();
    const endpoint = new WmtsEndpoint(this.def.url);
    await endpoint.isReady();

    const layer = endpoint.getLayerByName(this.def.layer);
    if (!layer) throw new Error(`WMTS layer "${this.def.layer}" not found in capabilities`);

    const link = this.def.matrixSet
      ? layer.matrixSets.find((m) => m.identifier === this.def.matrixSet)
      : layer.matrixSets.find((m) => isMercatorCrs(m.crs));
    if (!link) {
      throw new Error(
        `WMTS layer "${this.def.layer}" offers no WebMercator tile matrix set (D-02)`,
      );
    }
    const matrixSet = endpoint.getMatrixSetByIdentifier(link.identifier);
    const matrices = [...matrixSet.tileMatrices].sort(
      (a, b) => b.scaleDenominator - a.scaleDenominator,
    );

    const style = this.def.style ?? layer.defaultStyle;
    const matrixIds = matrices.map((m) => m.identifier);
    const makeTemplate = (resource: ResourceLinkLike): string =>
      buildWmtsTemplate({
        encoding: resource.encoding,
        resourceUrl: resource.url,
        layer: this.def.layer,
        style,
        matrixSet: link.identifier,
        format: resource.format ?? this.def.format ?? "image/png",
        matrixIds,
      });

    /* A raster source can only show pictures, so drop MVT/UTFGrid/JSON links —
       GWC advertises the vector tile first, which used to win by position. */
    const all = layer.resourceLinks as ResourceLinkLike[];
    if (this.def.format && !isRasterTileFormat(this.def.format)) {
      throw new Error(
        `WMTS format "${this.def.format}" is not a raster image format — ` +
          `a "wmts" layer renders image tiles (use type "vector" for vector tiles)`,
      );
    }
    const links = pickRasterLinks(all, this.def.format);
    if (links.length === 0) {
      const advertised = [...new Set(all.map((r) => r.format))].join(", ") || "none";
      throw new Error(
        `WMTS layer "${this.def.layer}" offers no image tile format (advertised: ${advertised})`,
      );
    }

    /* Capabilities may list stale mirror hosts (seen in the wild: basemap.at's
       maps1-4.wien.gv.at are DNS-dead). Probe candidates with one real tile and
       take the first host that answers; 404 still means "host alive". The winning
       origin is cached per service so further layers skip the probe entirely. */
    const originOf = (link: ResourceLinkLike): string => {
      try {
        return new URL(link.url).origin;
      } catch {
        return "";
      }
    };
    /* One candidate per host: the probe decides *which host is alive*, and racing
       several formats of the same host would settle the format by network luck. */
    const byOrigin = new Map<string, ResourceLinkLike>();
    for (const link of links) {
      const origin = originOf(link);
      if (!byOrigin.has(origin)) byOrigin.set(origin, link);
    }
    const hosts = [...byOrigin.values()];
    const cached = liveOrigins.get(this.def.url);
    let chosen = (cached ? byOrigin.get(cached) : undefined) ?? hosts[0]!;

    if (!cached && hosts.length > 1) {
      const z = Math.min(Math.max(Math.round(map.getZoom()), 0), matrices.length - 1);
      const c = map.getCenter();
      const { x, y } = tileAt(c.lng, c.lat, z);
      const probe = async (link: ResourceLinkLike): Promise<ResourceLinkLike> => {
        const url = makeTemplate(link)
          .replace("{z}", String(z))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
        await fetch(url, { signal: AbortSignal.timeout(5000) });
        return link; // any HTTP response means the host is reachable
      };
      chosen = await Promise.any(hosts.map(probe)).catch(() => hosts[0]!);
      const origin = originOf(chosen);
      if (origin) liveOrigins.set(this.def.url, origin);
    }
    const template = makeTemplate(chosen);

    const styleInfo = layer.styles.find((s) => s.name === style);
    this.legendUrl = (styleInfo as { legendUrl?: string } | undefined)?.legendUrl ?? null;

    /* Clip requests to what the server serves: outside a regional layer's
       TileMatrixSetLimits GWC answers 400 TileOutOfRange, not an empty tile.
       The WGS84 bbox stands in for services that publish no limits. */
    const coverage = coverageFromLimits(link.limits ?? [], matrices);
    const capsBounds = layer.latLonBoundingBox as [number, number, number, number] | undefined;
    if (!this.def.bounds) this.def.bounds = capsBounds ?? coverage.bounds;
    const clip = coverage.bounds ?? capsBounds;

    const tileSize =
      (matrices[0] as { tileWidth?: number } | undefined)?.tileWidth === 512 ? 512 : 256;
    map.addSource(this.srcId, {
      type: "raster",
      tiles: [template],
      tileSize,
      ...(clip ? { bounds: clip } : {}),
      ...(coverage.minzoom ? { minzoom: coverage.minzoom } : {}),
      maxzoom: coverage.maxzoom ?? matrices.length - 1,
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

  protected override autoLegend(): LegendSpec | null {
    return this.legendUrl ? { kind: "image", url: this.legendUrl } : null;
  }
}
