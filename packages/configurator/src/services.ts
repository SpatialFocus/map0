/**
 * Turning a service URL into layer definitions. WMS and WMTS come from the
 * core's capabilities reader (shared with the viewer's add-layer dialog); WFS
 * and OGC API Features are parsed here through the same ogc-client instance.
 * Every offered layer, feature type or collection becomes a candidate the
 * user ticks. Nothing here touches the config — `candidateToLayer` returns a
 * definition, the caller inserts it.
 */
import {
  asBbox,
  cleanServiceUrl,
  loadOgcClient,
  readWmsCapabilities,
  readWmtsCapabilities,
  wmsLayerFromCandidate,
  wmtsLayerFromCandidate,
  type OgcClient,
  type ServiceLayerCandidate,
} from "@map0/core";
import type { LayerDef } from "@map0/schema";

export type ServiceKind = "wms" | "wmts" | "wfs" | "ogcapi-features";

export const SERVICE_KINDS: ServiceKind[] = ["wms", "wmts", "wfs", "ogcapi-features"];

/** a candidate of any service kind — the core's WMS/WMTS shape plus what WFS and OGC API add */
export interface ServiceCandidate extends ServiceLayerCandidate {
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

async function probeWms(url: string): Promise<ServiceProbe> {
  const caps = await readWmsCapabilities(url);
  return { kind: "wms", url: caps.url, serviceTitle: caps.title, candidates: caps.candidates, infoFormat: caps.infoFormat };
}

async function probeWmts(url: string): Promise<ServiceProbe> {
  const caps = await readWmtsCapabilities(url);
  return { kind: "wmts", url: caps.url, serviceTitle: caps.title, candidates: caps.candidates };
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
  const candidates = endpoint.getFeatureTypes().map((brief): ServiceCandidate => {
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
  switch (kind) {
    case "wms":
      return probeWms(url);
    case "wmts":
      return probeWmts(url);
    case "wfs":
      return probeWfs(await loadOgcClient(), url);
    case "ogcapi-features":
      return probeOgcApi(await loadOgcClient(), url);
  }
}

/** the layer definition for one ticked candidate — with everything the capabilities told us */
export function candidateToLayer(probe: ServiceProbe, c: ServiceCandidate): LayerDef {
  switch (probe.kind) {
    case "wms":
      return wmsLayerFromCandidate(probe, c);
    case "wmts":
      return wmtsLayerFromCandidate(probe, c);
    case "wfs":
      return {
        type: "wfs",
        url: probe.url,
        typeNames: c.name,
        ...(probe.wfsVersion === "1.1.0" ? { version: "1.1.0" } : {}),
        ...(c.outputFormat ? { outputFormat: c.outputFormat } : {}),
        ...candidateCommon(c),
      };
    case "ogcapi-features":
      return {
        type: "ogcapi-features",
        url: c.url ?? `${probe.url.replace(/\/$/, "")}/collections/${encodeURIComponent(c.name)}/items`,
        ...candidateCommon(c),
      };
  }
}

/** title, extent, metadata and attribution — what every vector candidate contributes */
function candidateCommon(c: ServiceCandidate): { title: string; bounds?: [number, number, number, number]; metadata?: { url: string }; attribution?: string } {
  return {
    title: c.title,
    ...(c.bounds ? { bounds: c.bounds } : {}),
    ...(c.metadataUrl ? { metadata: { url: c.metadataUrl } } : {}),
    ...(c.attribution ? { attribution: c.attribution } : {}),
  };
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
