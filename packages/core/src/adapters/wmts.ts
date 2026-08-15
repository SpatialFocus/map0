import type { NormalizedLayer, WmtsLayerDef } from "@map0/schema";
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
    const { WmtsEndpoint } = await import("@camptocamp/ogc-client");
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

    /* Capabilities may list stale mirror hosts (seen in the wild: basemap.at's
       maps1-4.wien.gv.at are DNS-dead). Probe candidates with one real tile and
       take the first host that answers; 404 still means "host alive". The winning
       origin is cached per service so further layers skip the probe entirely. */
    const candidates = (layer.resourceLinks as ResourceLinkLike[]).filter(
      (r) => !this.def.format || r.format === this.def.format,
    );
    const links = candidates.length > 0 ? candidates : (layer.resourceLinks as ResourceLinkLike[]);
    const originOf = (link: ResourceLinkLike): string => {
      try {
        return new URL(link.url).origin;
      } catch {
        return "";
      }
    };
    const cached = liveOrigins.get(this.def.url);
    let chosen = (cached && links.find((l) => originOf(l) === cached)) || links[0]!;

    if (!cached && links.length > 1) {
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
      chosen = await Promise.any(links.map(probe)).catch(() => links[0]!);
      const origin = originOf(chosen);
      if (origin) liveOrigins.set(this.def.url, origin);
    }
    const template = makeTemplate(chosen);

    const styleInfo = layer.styles.find((s) => s.name === style);
    this.legendUrl = (styleInfo as { legendUrl?: string } | undefined)?.legendUrl ?? null;
    if (!this.def.bounds && layer.latLonBoundingBox) {
      this.def.bounds = layer.latLonBoundingBox as [number, number, number, number];
    }

    const tileSize =
      (matrices[0] as { tileWidth?: number } | undefined)?.tileWidth === 512 ? 512 : 256;
    map.addSource(this.srcId, {
      type: "raster",
      tiles: [template],
      tileSize,
      maxzoom: matrices.length - 1,
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
