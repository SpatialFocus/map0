/**
 * Capabilities → layer candidates, for WMS and WMTS. Shared by the viewer's
 * add-layer dialog and the configurator, so the two cannot disagree about
 * which layers a service offers in Web Mercator (D-02) or what a picked
 * layer's definition looks like.
 *
 * The parsing itself is @camptocamp/ogc-client's (through the single import
 * site in ogc.ts). Two of its habits are corrected here rather than worked
 * around twice:
 *
 * - CRS inherit ADDITIVELY in WMS — a child layer supports its own list plus
 *   every ancestor's — but ogc-client replaces the list when a child declares
 *   one. GeoServer lists ~6000 CRS (EPSG:3857 among them) on the unnamed root
 *   and only the native one on each leaf, so every leaf looked non-Mercator.
 *   The parsed tree still holds the root, so the union is computed top-down.
 * - WMS bounding boxes arrive as the attribute strings they were parsed from.
 */
import type { WmsLayerDef, WmtsLayerDef } from "@map0/schema";
import { isMercatorCrs } from "./adapters/wmts.js";
import { loadOgcClient } from "./ogc.js";

export type Bbox = [number, number, number, number];

/** one layer a service offers, as far as its capabilities tell */
export interface ServiceLayerCandidate {
  /** WMS layer name / WMTS layer identifier */
  name: string;
  title: string;
  abstract?: string;
  /** WMS: GetFeatureInfo is offered */
  queryable: boolean;
  /** available in Web Mercator — false ones cannot be shown (D-02) */
  has3857: boolean;
  /** WebMercator zoom below which the WMS layer is not rendered (from MaxScaleDenominator) */
  minZoom?: number;
  bounds?: Bbox;
  metadataUrl?: string;
  attribution?: string;
  /** WMS named styles, the server default first */
  styles?: Array<{ name: string; title?: string }>;
}

export interface WmsCapabilities {
  kind: "wms";
  /** the GetMap base URL — operation parameters stripped */
  url: string;
  title?: string;
  /** the info format queryable layers should request, when the service offers a usable one */
  infoFormat?: string;
  candidates: ServiceLayerCandidate[];
}

export interface WmtsCapabilities {
  kind: "wmts";
  /** the capabilities URL as given — WMTS layers point at it */
  url: string;
  title?: string;
  candidates: ServiceLayerCandidate[];
}

/** WebMercator zoom for a WMS ScaleDenominator (OGC pixel size, 256px tiles). */
export function scaleDenominatorToZoom(sd: number): number {
  return Math.max(0, Math.ceil(Math.log2(559082264.028 / sd)));
}

/** base URL without OGC operation params — they are re-added per request */
export function cleanServiceUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (["service", "request", "version"].includes(key.toLowerCase())) u.searchParams.delete(key);
    }
    return u.toString().replace(/\?$/, "");
  } catch {
    return raw.trim();
  }
}

/** a bounding box from numbers or numeric strings, else undefined */
export function asBbox(b: unknown): Bbox | undefined {
  if (!Array.isArray(b) || b.length !== 4) return undefined;
  const nums = b.map((n) => (typeof n === "number" ? n : Number(n)));
  return nums.every((n) => Number.isFinite(n)) ? (nums as Bbox) : undefined;
}

/** JSON when offered, else the first JSON-ish or HTML format; undefined when nothing fits */
export function pickInfoFormat(formats: readonly string[]): string | undefined {
  if (formats.includes("application/json")) return "application/json";
  return formats.find((f) => f.includes("json") || f.includes("html"));
}

/* ---------------------------------- WMS ---------------------------------- */

/** a node of the parsed WMS layer tree — the (possibly unnamed) root included */
export interface WmsTreeNode {
  name?: string;
  availableCrs?: readonly string[];
  children?: readonly WmsTreeNode[];
}

/** what ogc-client knows about one named layer (the fields used here) */
export interface WmsLayerDetails {
  title?: string;
  abstract?: string;
  availableCrs?: readonly string[];
  boundingBoxes?: Record<string, unknown>;
  queryable?: boolean;
  maxScaleDenominator?: number;
  metadata?: ReadonlyArray<{ url?: string }>;
  attribution?: { title?: string };
  styles?: ReadonlyArray<{ name: string; title?: string }>;
}

/**
 * Every leaf of the tree as a candidate, CRS unioned down from the root. Pure,
 * so the inheritance rule is testable without a service.
 */
export function wmsCandidates(
  tree: readonly WmsTreeNode[],
  details: (name: string) => WmsLayerDetails,
): ServiceLayerCandidate[] {
  const out: ServiceLayerCandidate[] = [];
  const walk = (nodes: readonly WmsTreeNode[], inherited: readonly string[]): void => {
    for (const node of nodes) {
      const crs = [...inherited, ...(node.availableCrs ?? [])];
      if (node.name && !node.children?.length) {
        const full = details(node.name);
        const own = crs.length > 0 ? crs : (full.availableCrs ?? []);
        const bbox = asBbox(full.boundingBoxes?.["EPSG:4326"] ?? full.boundingBoxes?.["CRS:84"]);
        const minZoom = full.maxScaleDenominator ? scaleDenominatorToZoom(full.maxScaleDenominator) : undefined;
        out.push({
          name: node.name,
          title: full.title ?? node.name,
          ...(full.abstract ? { abstract: full.abstract } : {}),
          queryable: full.queryable === true,
          /* no CRS anywhere → benefit of the doubt (capabilities quirks) */
          has3857: own.length === 0 || own.some((c) => isMercatorCrs(c)),
          ...(minZoom !== undefined ? { minZoom } : {}),
          ...(bbox ? { bounds: bbox } : {}),
          ...(full.metadata?.[0]?.url ? { metadataUrl: full.metadata[0].url } : {}),
          ...(full.attribution?.title ? { attribution: full.attribution.title } : {}),
          styles: (full.styles ?? []).map((s) => ({ name: s.name, ...(s.title ? { title: s.title } : {}) })),
        });
      }
      if (node.children?.length) walk(node.children, crs);
    }
  };
  walk(tree, []);
  return out;
}

/** fetch and parse a WMS's capabilities */
export async function readWmsCapabilities(url: string): Promise<WmsCapabilities> {
  const ogc = await loadOgcClient();
  const endpoint = new ogc.WmsEndpoint(url);
  await endpoint.isReady();
  const info = endpoint.getServiceInfo();
  /* the parsed tree keeps the root layer with its CRS list; the public
     getLayers() summaries do not, so fall back to them only when it is gone */
  const tree =
    (endpoint as unknown as { _layers?: WmsTreeNode[] })._layers ?? (endpoint.getLayers() as WmsTreeNode[]);
  const candidates = wmsCandidates(tree, (name) => endpoint.getLayerByName(name) as unknown as WmsLayerDetails);
  const infoFormat = pickInfoFormat(info?.infoFormats ?? []);
  return {
    kind: "wms",
    url: cleanServiceUrl(url),
    ...(info?.title ? { title: info.title } : {}),
    ...(infoFormat ? { infoFormat } : {}),
    candidates,
  };
}

/** the layer definition for a picked WMS candidate — everything the capabilities told us */
export function wmsLayerFromCandidate(
  service: { url: string; infoFormat?: string },
  c: ServiceLayerCandidate,
): WmsLayerDef {
  return {
    type: "wms",
    url: service.url,
    layers: c.name,
    ...(c.queryable ? { info: { format: service.infoFormat ?? "application/json" } } : {}),
    ...candidateCommon(c),
  };
}

/* ---------------------------------- WMTS ---------------------------------- */

/** fetch and parse a WMTS's capabilities */
export async function readWmtsCapabilities(url: string): Promise<WmtsCapabilities> {
  const ogc = await loadOgcClient();
  const endpoint = new ogc.WmtsEndpoint(url);
  await endpoint.isReady();
  const candidates = endpoint.getLayers().map((layer): ServiceLayerCandidate => {
    const bbox = asBbox(layer.latLonBoundingBox);
    return {
      name: layer.name,
      title: layer.name,
      queryable: false,
      has3857: layer.matrixSets.some((m) => isMercatorCrs(m.crs)),
      ...(bbox ? { bounds: bbox } : {}),
    };
  });
  const title = endpoint.getServiceInfo()?.title;
  return { kind: "wmts", url: url.trim(), ...(title ? { title } : {}), candidates };
}

export function wmtsLayerFromCandidate(service: { url: string }, c: ServiceLayerCandidate): WmtsLayerDef {
  return { type: "wmts", url: service.url, layer: c.name, ...candidateCommon(c) };
}

/** the keys every candidate contributes to its layer: title, zoom hint, extent, metadata, attribution */
function candidateCommon(c: ServiceLayerCandidate): Pick<
  WmsLayerDef,
  "title" | "minZoom" | "bounds" | "metadata" | "attribution"
> {
  return {
    title: c.title,
    ...(c.minZoom !== undefined && c.minZoom > 0 ? { minZoom: c.minZoom } : {}),
    ...(c.bounds ? { bounds: c.bounds } : {}),
    ...(c.metadataUrl ? { metadata: { url: c.metadataUrl } } : {}),
    ...(c.attribution ? { attribution: c.attribution } : {}),
  };
}
