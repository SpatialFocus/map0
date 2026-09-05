import type { Feature, FeatureCollection } from "geojson";
import type { NormalizedLayer, OgcApiFeaturesLayerDef } from "@map0/schema";
import { GeoJsonAdapter, type NormalizedGeoJson } from "./geojson.js";

type NormalizedOgcApi = OgcApiFeaturesLayerDef & NormalizedLayer & { type: "ogcapi-features" };

const DEFAULT_LIMIT = 10000;
const DEFAULT_PAGE_SIZE = 1000;

/** the request-shaping subset of an ogcapi-features layer definition */
export interface OgcApiRequest {
  url: string;
  limit?: number;
  pageSize?: number;
  params?: Record<string, string>;
}

/**
 * URL of the first items page. The config takes the collection URL (the thing
 * an API's landing page links to), so "/items" is appended unless the author
 * already wrote it. `f=json` is the conventional format escape every major
 * implementation understands (ldproxy, pygeoapi, GeoServer); `params` merge
 * last and can override anything, including `f`.
 */
export function buildItemsUrl(def: OgcApiRequest, limit: number): string {
  const base = def.url.replace(/\/+$/, "");
  const url = new URL(
    /\/items(\?|$)/.test(base) ? base : `${base}/items`,
    typeof location !== "undefined" ? location.href : "http://localhost/",
  );
  const merged: Record<string, string> = {
    f: "json",
    limit: String(limit),
    ...(def.params ?? {}),
  };
  for (const [k, v] of Object.entries(merged)) url.searchParams.set(k, v);
  return url.toString();
}

interface ItemsPage {
  features: Feature[];
  /** absolute URL of the next page, when the server offers one */
  next?: string;
}

/**
 * One items answer → features + the "next" link. Paging deliberately follows
 * the links instead of counting: `numberMatched` is optional and missing in
 * the wild (OS Zoomstack on ldproxy, for one), while the next link is the
 * spec's own paging mechanism — it also absorbs servers that cap `limit`
 * below the asked-for value. OGC API errors are JSON problem details, so
 * their title/description surface instead of a bare parse error.
 */
export function parseItemsResponse(text: string, url: string): ItemsPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${url} did not answer GeoJSON — is this a Features collection URL (…/collections/{id})?`,
    );
  }
  const obj = parsed as {
    features?: Feature[];
    links?: Array<{ href?: string; rel?: string; type?: string }>;
    title?: string;
    description?: string;
  };
  if (!Array.isArray(obj.features)) {
    const problem = [obj.title, obj.description].filter(Boolean).join(" — ");
    throw new Error(
      problem ? `the API answered: ${problem}` : `${url} answered JSON without a "features" array`,
    );
  }
  const next = obj.links?.find(
    (l) => l.rel === "next" && !!l.href && (!l.type || l.type.includes("json")),
  );
  return {
    features: obj.features,
    /* servers may emit relative hrefs — resolve against the page just fetched */
    next: next?.href ? new URL(next.href, url).toString() : undefined,
  };
}

/**
 * Fetch up to `limit` features, following "next" links. `fetchText` is
 * injectable for tests.
 */
export async function loadOgcApiFeatures(
  def: OgcApiRequest,
  fetchText: (url: string) => Promise<string> = async (url) => {
    const res = await fetch(url, { headers: { Accept: "application/geo+json" } });
    if (!res.ok) throw new Error(`fetching ${url} failed: ${res.status} ${res.statusText}`);
    return res.text();
  },
): Promise<FeatureCollection> {
  const limit = def.limit ?? DEFAULT_LIMIT;
  const pageSize = Math.min(def.pageSize ?? DEFAULT_PAGE_SIZE, limit);
  const features: Feature[] = [];

  let url: string | undefined = buildItemsUrl(def, pageSize);
  const seen = new Set<string>();
  while (url && features.length < limit && !seen.has(url)) {
    seen.add(url); // a next link pointing back at a visited page must not loop
    const page = parseItemsResponse(await fetchText(url), url);
    features.push(...page.features.slice(0, limit - features.length));
    if (page.features.length === 0) break;
    url = page.next;
  }
  return { type: "FeatureCollection", features };
}

/**
 * OGC API Features layer: the collection's items as GeoJSON (WGS84 is the
 * API's default CRS), paged by the response's own next links, then everything
 * — styling, clustering, popups, hover, legend, zoom-to-layer — is the
 * geojson pipeline.
 */
export class OgcApiFeaturesAdapter extends GeoJsonAdapter {
  private readonly ogc: NormalizedOgcApi;

  constructor(def: NormalizedOgcApi) {
    const { url, limit, pageSize, params, ...common } = def;
    super({
      ...common,
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    } as NormalizedGeoJson);
    this.ogc = def;
  }

  protected override async addToMap(): Promise<void> {
    const fc = await loadOgcApiFeatures(this.ogc);
    (this.def as { data: unknown }).data = fc;
    await super.addToMap();
  }
}
