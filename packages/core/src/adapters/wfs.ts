import type { Feature, FeatureCollection } from "geojson";
import type { NormalizedLayer, WfsLayerDef } from "@map0/schema";
import { GeoJsonAdapter, type NormalizedGeoJson } from "./geojson.js";

type NormalizedWfs = WfsLayerDef & NormalizedLayer & { type: "wfs" };

const DEFAULT_LIMIT = 10000;
const DEFAULT_PAGE_SIZE = 5000;

/** the request-shaping subset of a wfs layer definition */
export interface WfsRequest {
  url: string;
  typeNames: string;
  version?: "1.1.0" | "2.0.0";
  outputFormat?: string;
  limit?: number;
  pageSize?: number;
  params?: Record<string, string>;
}

/**
 * GetFeature URL. Base-URL query params are kept (MapServer `map=` etc.);
 * vendor `params` are merged last, so they can override anything — including
 * SRSNAME for a server that insists on the urn: form. The GeoJSON output of a
 * WFS is lon/lat WGS84, exactly what MapLibre's geojson source expects.
 */
export function buildGetFeatureUrl(
  def: WfsRequest,
  opts: { count: number; startIndex?: number },
): string {
  const version = def.version ?? "2.0.0";
  const url = new URL(def.url, typeof location !== "undefined" ? location.href : "http://localhost/");
  const search = new URLSearchParams(url.search);
  const merged: Record<string, string> = {
    SERVICE: "WFS",
    VERSION: version,
    REQUEST: "GetFeature",
    /* the parameter was renamed between the versions */
    [version === "2.0.0" ? "TYPENAMES" : "TYPENAME"]: def.typeNames,
    SRSNAME: "EPSG:4326",
    OUTPUTFORMAT: def.outputFormat ?? "application/json",
    [version === "2.0.0" ? "COUNT" : "MAXFEATURES"]: String(opts.count),
    ...(version === "2.0.0" && opts.startIndex ? { STARTINDEX: String(opts.startIndex) } : {}),
    ...(def.params ?? {}),
  };
  for (const [k, v] of Object.entries(merged)) search.set(k, v);
  url.search = search.toString();
  return url.toString();
}

/**
 * One GetFeature answer → features + the server's total, when it names one
 * (GeoServer: "totalFeatures" and/or "numberMatched"). A WFS reports errors as
 * OWS exception XML with HTTP 200, so a non-JSON body is unwrapped into its
 * exception text instead of surfacing as a bare JSON parse error.
 */
export function parseWfsResponse(
  text: string,
  url: string,
): { features: Feature[]; numberMatched?: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m =
      /<(?:\w+:)?(?:ExceptionText|ServiceException)[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:ExceptionText|ServiceException)>/.exec(
        text,
      );
    const reason = m?.[1]?.trim();
    throw new Error(
      reason
        ? `the WFS answered with an exception: ${reason}`
        : `${url} did not answer GeoJSON — check "outputFormat" (GeoServer/deegree take the ` +
          `default "application/json", MapServer wants "geojson")`,
    );
  }
  const fc = parsed as { features?: Feature[]; numberMatched?: unknown; totalFeatures?: unknown };
  if (!Array.isArray(fc.features)) {
    throw new Error(`${url} answered JSON without a "features" array`);
  }
  const matched =
    typeof fc.numberMatched === "number"
      ? fc.numberMatched
      : typeof fc.totalFeatures === "number"
        ? fc.totalFeatures
        : undefined;
  return { features: fc.features, numberMatched: matched };
}

/**
 * Fetch up to `limit` features. WFS 2.0.0 pages with count/startIndex, which
 * also recovers from servers that silently cap a request below the asked-for
 * count (the next page continues where the answer actually ended, as long as
 * the server reports a total). 1.1.0 has no paging — one maxFeatures request.
 * `fetchText` is injectable for tests.
 */
export async function loadWfsFeatures(
  def: WfsRequest,
  fetchText: (url: string) => Promise<string> = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetching ${url} failed: ${res.status} ${res.statusText}`);
    return res.text();
  },
): Promise<FeatureCollection> {
  const limit = def.limit ?? DEFAULT_LIMIT;
  const features: Feature[] = [];

  if ((def.version ?? "2.0.0") === "1.1.0") {
    const page = parseWfsResponse(await fetchText(buildGetFeatureUrl(def, { count: limit })), def.url);
    /* slice defensively — a server may ignore maxFeatures */
    features.push(...page.features.slice(0, limit));
    return { type: "FeatureCollection", features };
  }

  const pageSize = def.pageSize ?? DEFAULT_PAGE_SIZE;
  let matched: number | undefined;
  let previousFirstId: unknown;
  while (features.length < limit) {
    const count = Math.min(pageSize, limit - features.length);
    const url = buildGetFeatureUrl(def, { count, startIndex: features.length });
    const page = parseWfsResponse(await fetchText(url), def.url);
    if (page.features.length === 0) break;
    /* a server that ignores STARTINDEX serves the same page forever — detect it
       by the first feature id instead of collecting duplicates up to the limit */
    const firstId = page.features[0]?.id;
    if (firstId !== undefined && firstId === previousFirstId) break;
    previousFirstId = firstId;
    matched ??= page.numberMatched;
    features.push(...page.features.slice(0, limit - features.length));
    if (matched !== undefined && features.length >= matched) break;
    if (matched === undefined && page.features.length < count) break; // short page, no total to say otherwise
  }
  return { type: "FeatureCollection", features };
}

/**
 * WFS layer: GetFeature as GeoJSON (paged), then everything — styling,
 * clustering, popups, hover, legend, zoom-to-layer — is the geojson pipeline.
 * The formalization of the "outputFormat=json&srsName=EPSG:4326" trick the
 * GeoJSON demo used to recommend, plus paging and friendly errors.
 */
export class WfsAdapter extends GeoJsonAdapter {
  private readonly wfs: NormalizedWfs;

  constructor(def: NormalizedWfs) {
    const { url, typeNames, version, outputFormat, limit, pageSize, params, ...common } = def;
    super({
      ...common,
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    } as NormalizedGeoJson);
    this.wfs = def;
  }

  protected override async addToMap(): Promise<void> {
    const fc = await loadWfsFeatures(this.wfs);
    (this.def as { data: unknown }).data = fc;
    await super.addToMap();
  }
}
