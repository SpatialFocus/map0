/**
 * Turning a service URL into layer definitions: capabilities are fetched and
 * parsed by @camptocamp/ogc-client (through the core's single import site, so
 * the configurator and the viewer's add-layer dialog share one chunk), and
 * each offered layer, feature type or collection becomes a candidate the user
 * ticks. Nothing here touches the config — `candidateToLayer` returns a
 * definition, the caller inserts it.
 */
import { isMercatorCrs, loadOgcClient, type OgcClient } from "@map0/core";
import type { LayerDef } from "@map0/schema";

export type ServiceKind = "wms" | "wmts" | "wfs" | "ogcapi-features";

export const SERVICE_KINDS: ServiceKind[] = ["wms", "wmts", "wfs", "ogcapi-features"];

export interface ServiceCandidate {
  /** WMS layer name, WMTS identifier, WFS type name or OGC API collection id */
  name: string;
  title: string;
  abstract?: string;
  /** WMS: GetFeatureInfo works; WFS/OGC API: always (they are vector) */
  queryable: boolean;
  /** offered in Web Mercator (D-02) — false ones are shown disabled */
  has3857: boolean;
  minZoom?: number;
  bounds?: [number, number, number, number];
  metadataUrl?: string;
  attribution?: string;
  /** WMS named styles; the first one is the server default */
  styles?: Array<{ name: string; title?: string }>;
  /** OGC API Features: the collection's items URL — what the layer points at */
  url?: string;
  /** WFS: a GeoJSON-ish output format the server declared, when it is not the default one */
  outputFormat?: string;
}

export interface ServiceProbe {
  kind: ServiceKind;
  /** the URL layers are built with (operation params stripped for WMS/WFS) */
  url: string;
  serviceTitle?: string;
  candidates: ServiceCandidate[];
  /** WMS: the info format layers with popups request */
  infoFormat?: string;
  /** WFS: the negotiated protocol version */
  wfsVersion?: "1.1.0" | "2.0.0";
}

/** WebMercator zoom for a WMS ScaleDenominator (OGC pixel size, 256px tiles). */
function scaleDenominatorToZoom(sd: number): number {
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

type Bbox = [number, number, number, number];

/** a node of ogc-client's parsed WMS layer tree (the root included, named or not) */
interface FullNode {
  name?: string;
  availableCrs?: string[];
  children?: FullNode[];
}

/** ogc-client hands WMS bounding boxes over as attribute strings, WFS ones as numbers */
const asBbox = (b: unknown): Bbox | undefined => {
  if (!Array.isArray(b) || b.length !== 4) return undefined;
  const nums = b.map((n) => (typeof n === "number" ? n : Number(n)));
  return nums.every((n) => Number.isFinite(n)) ? (nums as Bbox) : undefined;
};

async function probeWms(ogc: OgcClient, url: string): Promise<ServiceProbe> {
  const endpoint = new ogc.WmsEndpoint(url);
  await endpoint.isReady();
  const info = endpoint.getServiceInfo();
  const infoFormats = info?.infoFormats ?? [];
  const infoFormat = infoFormats.includes("application/json")
    ? "application/json"
    : infoFormats.find((f: string) => f.includes("json") || f.includes("html"));

  const candidates: ServiceCandidate[] = [];
  /* CRS inherit ADDITIVELY in WMS (a child supports its own list plus every
     ancestor's), but ogc-client replaces the list when a child declares one —
     GeoServer lists 6000 CRS on the root and only the native one on each layer,
     so every layer would look non-Mercator. The parsed tree keeps the root, so
     the union is computed here from the top down. */
  const tree = (endpoint as unknown as { _layers?: FullNode[] })._layers ?? (endpoint.getLayers() as FullNode[]);
  const walk = (nodes: FullNode[], inherited: string[]): void => {
    for (const node of nodes ?? []) {
      const crs = [...inherited, ...(node.availableCrs ?? [])];
      if (node.name && !node.children?.length) {
        const full = endpoint.getLayerByName(node.name);
        const own = crs.length > 0 ? crs : (full.availableCrs ?? []);
        const bbox = asBbox(full.boundingBoxes?.["EPSG:4326"] ?? full.boundingBoxes?.["CRS:84"]);
        candidates.push({
          name: node.name,
          title: full.title ?? node.name,
          abstract: full.abstract,
          queryable: full.queryable,
          /* unknown CRS list → benefit of the doubt (inheritance quirks) */
          has3857: own.length === 0 || own.some((c: string) => isMercatorCrs(c)),
          minZoom: full.maxScaleDenominator ? scaleDenominatorToZoom(full.maxScaleDenominator) : undefined,
          ...(bbox ? { bounds: bbox } : {}),
          metadataUrl: full.metadata?.[0]?.url,
          attribution: full.attribution?.title,
          styles: (full.styles ?? []).map((st: { name: string; title?: string }) => ({
            name: st.name,
            title: st.title,
          })),
        });
      }
      if (node.children?.length) walk(node.children, crs);
    }
  };
  walk(tree, []);
  return { kind: "wms", url: cleanServiceUrl(url), serviceTitle: info?.title, candidates, infoFormat };
}

async function probeWmts(ogc: OgcClient, url: string): Promise<ServiceProbe> {
  const endpoint = new ogc.WmtsEndpoint(url);
  await endpoint.isReady();
  const candidates = endpoint.getLayers().map((layer) => {
    const bbox = asBbox(layer.latLonBoundingBox);
    return {
      name: layer.name,
      title: layer.name,
      queryable: false,
      has3857: layer.matrixSets.some((m) => isMercatorCrs(m.crs)),
      ...(bbox ? { bounds: bbox } : {}),
    } satisfies ServiceCandidate;
  });
  return { kind: "wmts", url: url.trim(), serviceTitle: endpoint.getServiceInfo()?.title, candidates };
}

/** a GeoJSON output format the server lists, when "application/json" is not among them */
function pickOutputFormat(formats: string[]): string | undefined {
  if (formats.some((f) => f.toLowerCase() === "application/json")) return undefined;
  return formats.find((f) => /json/i.test(f));
}

async function probeWfs(ogc: OgcClient, url: string): Promise<ServiceProbe> {
  const endpoint = new ogc.WfsEndpoint(url);
  await endpoint.isReady();
  const version = endpoint.getVersion();
  const candidates = endpoint.getFeatureTypes().map((brief) => {
    let outputFormat: string | undefined;
    let metadataUrl: string | undefined;
    try {
      const summary = endpoint.getFeatureTypeSummary(brief.name);
      outputFormat = pickOutputFormat(summary.outputFormats ?? []);
      metadataUrl = summary.metadata?.[0]?.url;
    } catch {
      /* a type the capabilities list but do not describe — still offered */
    }
    const bbox = asBbox(brief.boundingBox);
    return {
      name: brief.name,
      title: brief.title ?? brief.name,
      abstract: brief.abstract,
      queryable: true,
      has3857: true, // WFS answers in WGS84/GeoJSON; the geojson pipeline handles it
      ...(bbox ? { bounds: bbox } : {}),
      ...(metadataUrl ? { metadataUrl } : {}),
      ...(outputFormat ? { outputFormat } : {}),
    } satisfies ServiceCandidate;
  });
  return {
    kind: "wfs",
    url: cleanServiceUrl(url),
    serviceTitle: endpoint.getServiceInfo()?.title,
    candidates,
    wfsVersion: version === "2.0.0" ? "2.0.0" : "1.1.0",
  };
}

async function probeOgcApi(ogc: OgcClient, url: string): Promise<ServiceProbe> {
  const endpoint = new ogc.OgcApiEndpoint(url);
  const [info, collections] = await Promise.all([endpoint.info, endpoint.allCollections]);
  const featureCollections = collections.filter((c) => c.hasFeatures !== false);
  const candidates = await Promise.all(
    featureCollections.map(async (c): Promise<ServiceCandidate> => {
      try {
        const details = await endpoint.getCollectionInfo(c.name);
        const itemsUrl = (await endpoint.getCollectionItemsUrl(c.name)).split("?")[0]!;
        const bbox = asBbox(details.extent);
        return {
          name: c.name,
          title: details.title || c.name,
          abstract: details.description,
          queryable: true,
          has3857: true,
          url: itemsUrl,
          ...(bbox ? { bounds: bbox } : {}),
        };
      } catch {
        return { name: c.name, title: c.name, queryable: true, has3857: true };
      }
    }),
  );
  return { kind: "ogcapi-features", url: url.trim(), serviceTitle: info.title, candidates };
}

/** fetch and parse the capabilities of a service, whatever its kind */
export async function probeService(kind: ServiceKind, url: string): Promise<ServiceProbe> {
  const ogc = await loadOgcClient();
  switch (kind) {
    case "wms":
      return probeWms(ogc, url);
    case "wmts":
      return probeWmts(ogc, url);
    case "wfs":
      return probeWfs(ogc, url);
    case "ogcapi-features":
      return probeOgcApi(ogc, url);
  }
}

/** the layer definition for one ticked candidate — with everything the capabilities told us */
export function candidateToLayer(probe: ServiceProbe, c: ServiceCandidate): LayerDef {
  const common = {
    title: c.title,
    ...(c.minZoom !== undefined && c.minZoom > 0 ? { minZoom: c.minZoom } : {}),
    ...(c.bounds ? { bounds: c.bounds } : {}),
    ...(c.metadataUrl ? { metadata: { url: c.metadataUrl } } : {}),
    ...(c.attribution ? { attribution: c.attribution } : {}),
  };
  switch (probe.kind) {
    case "wms":
      return {
        type: "wms",
        url: probe.url,
        layers: c.name,
        ...(c.queryable ? { info: { format: probe.infoFormat ?? "application/json" } } : {}),
        ...common,
      };
    case "wmts":
      return { type: "wmts", url: probe.url, layer: c.name, ...common };
    case "wfs":
      return {
        type: "wfs",
        url: probe.url,
        typeNames: c.name,
        ...(probe.wfsVersion === "1.1.0" ? { version: "1.1.0" } : {}),
        ...(c.outputFormat ? { outputFormat: c.outputFormat } : {}),

        ...common,
      };
    case "ogcapi-features":
      return {
        type: "ogcapi-features",
        url: c.url ?? `${probe.url.replace(/\/$/, "")}/collections/${encodeURIComponent(c.name)}/items`,

        ...common,
      };
  }
}

/* -------------------------- layers from a plain URL -------------------------- */

export type UrlLayerType = "geojson" | "geoparquet" | "cog" | "vector" | "raster";

export const URL_LAYER_TYPES: UrlLayerType[] = ["geojson", "geoparquet", "cog", "vector", "raster"];

/** a title from the file name of a URL — "bezirke.geojson" → "bezirke" */
export function titleFromUrl(url: string): string {
  try {
    const last = new URL(url, "https://x").pathname.split("/").filter(Boolean).pop() ?? "";
    const name = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, "");
    return name || new URL(url, "https://x").hostname;
  } catch {
    return url;
  }
}

/** a layer definition for a data URL: GeoJSON, GeoParquet, COG, vector tiles, XYZ raster */
export function urlLayer(type: UrlLayerType, url: string, title?: string): LayerDef {
  const t = title?.trim() || titleFromUrl(url);
  switch (type) {
    case "geojson":
      return { type: "geojson", title: t, data: url };
    case "geoparquet":
      return { type: "geoparquet", title: t, url };
    case "cog":
      return { type: "cog", title: t, url };
    case "vector":
      return {
        type: "vector",
        title: t,
        url,
        style: [{ type: "line", paint: { "line-color": "#0e7490", "line-width": 1 } }],
      };
    case "raster":
      return { type: "raster", title: t, url };
  }
}
