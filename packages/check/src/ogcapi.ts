import { buildItemsUrl, loadOgcClient, parseItemsResponse } from "@map0/core";
import type { Detection } from "./detect.js";
import { firstCoordinate, inBbox, isWgs84Crs, lonLatBbox, looksAxisSwapped, roundBbox, type BBox } from "./geo.js";
import { corsFinding, describeResponse, exceptionText, httpsFinding, shortType, timedFetch, withParams } from "./http.js";
import {
  finding,
  probeTargets,
  verdictOf,
  type Finding,
  type LayerReport,
  type Options,
  type ProbeResult,
  type ServiceReport,
} from "./types.js";
import { sizeFinding } from "./wfs.js";

/** root of the API and, when the URL points into one, the collection id */
export function splitCollectionUrl(url: string): { root: string; collectionId?: string } {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  const m = /^(.*?)\/collections\/([^/]+)(?:\/.*)?$/.exec(u.pathname);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    u.pathname = m[1];
    return { root: u.toString().replace(/\/+$/, ""), collectionId: decodeURIComponent(m[2]) };
  }
  u.pathname = u.pathname.replace(/\/(collections|conformance)\/?$/, "").replace(/\/+$/, "");
  return { root: u.toString().replace(/\/+$/, "") };
}

export function collectionUrl(root: string, id: string): string {
  return `${root}/collections/${encodeURIComponent(id)}`;
}

export function ogcApiSnippet(url: string, title: string, bounds: BBox | undefined): Record<string, unknown> {
  return {
    type: "ogcapi-features",
    url,
    title,
    ...(bounds ? { bounds: roundBbox(bounds) } : {}),
  };
}

/** the collection document, as the spec shapes it */
interface CollectionDoc {
  title?: string;
  itemType?: string;
  extent?: { spatial?: { bbox?: number[][] } };
  crs?: string[];
  storageCrs?: string;
}

/** WGS84 bbox from a collection's spatial extent (2D or 3D) */
export function extentBbox(doc: CollectionDoc): BBox | undefined {
  const b = doc.extent?.spatial?.bbox?.[0];
  if (!Array.isArray(b)) return undefined;
  return lonLatBbox(b.length === 6 ? [b[0], b[1], b[3], b[4]] : b);
}

const CONFORMANCE = {
  core: "ogcapi-features-1/1.0/conf/core",
  geojson: "ogcapi-features-1/1.0/conf/geojson",
  crs: "ogcapi-features-2/1.0/conf/crs",
  filter: "ogcapi-features-3/1.0/conf/",
  cql2: "cql2/1.0/conf/",
} as const;

export async function analyzeOgcApi(det: Detection, opts: Options): Promise<ServiceReport> {
  const { root, collectionId } = splitCollectionUrl(det.baseUrl);
  const ogc = await loadOgcClient();
  const endpoint = new ogc.OgcApiEndpoint(root);
  const info = await endpoint.info;
  const conformance = await endpoint.conformanceClasses;
  const hasFeatures = await endpoint.hasFeatures;
  const featureIds = await endpoint.featureCollections;

  const findings: Finding[] = [
    httpsFinding(det.baseUrl),
    finding(det.response.ok ? "ok" : "fail", "reachable", `landing/collection document ${describeResponse(det.response)}`),
    corsFinding(det.response, "landing document", opts.origin),
  ];
  const has = (frag: string): boolean => conformance.some((c) => c.includes(frag));
  findings.push(
    has(CONFORMANCE.core)
      ? finding("ok", "conformance", "OGC API Features Part 1 core declared")
      : finding("warn", "conformance", "Part 1 core conformance class not declared — the server may not be a Features API"),
  );
  findings.push(
    has(CONFORMANCE.geojson)
      ? finding("ok", "geojson", "GeoJSON conformance declared")
      : finding("warn", "geojson", "GeoJSON conformance class not declared — checked live per collection"),
  );
  if (has(CONFORMANCE.crs)) {
    findings.push(finding("info", "crs", "Part 2 CRS extension available — map0 takes the default WGS84 answer"));
  }
  if (has(CONFORMANCE.filter) || has(CONFORMANCE.cql2)) {
    findings.push(finding("info", "filter", 'CQL2 filtering available — use "params": { "filter": "…" }'));
  }
  if (!hasFeatures) findings.push(finding("fail", "features", "no feature collections — nothing for a map0 ogcapi-features layer"));

  const ids = collectionId ? [collectionId] : featureIds;
  if (collectionId && !featureIds.includes(collectionId)) {
    findings.push(
      finding("warn", "collection", `"${collectionId}" is not listed among the API's feature collections — checked anyway`),
    );
  }
  const { targets, missing } = probeTargets(ids, opts);
  for (const m of missing) findings.push(finding("fail", "layer", `--layer "${m}" is not a collection of this API`));

  /* collection documents cost one request each: read the probed ones plus a bounded head of the list */
  const describeCap = opts.all ? ids.length : Math.max(opts.probeLimit, 25);
  const layers: LayerReport[] = [];
  for (const [index, id] of ids.entries()) {
    const lf: Finding[] = [];
    const facts: string[] = [];
    const url = collectionUrl(root, id);
    let title = id;
    let bounds: BBox | undefined;
    if (targets.has(id) || index < describeCap) {
      const res = await timedFetch(withParams(url, { f: "json" }), {
        origin: opts.origin,
        timeoutMs: opts.timeoutMs,
        accept: "application/json",
      });
      let doc: CollectionDoc | undefined;
      if (res.ok && res.text) {
        try {
          doc = JSON.parse(res.text) as CollectionDoc;
        } catch {
          doc = undefined;
        }
      }
      if (!doc) {
        lf.push(
          finding(
            "warn",
            "collection",
            `collection document could not be read: ${res.error ?? exceptionText(res.text) ?? `${res.status} ${shortType(res.contentType)}`}`,
          ),
        );
      } else {
        title = doc.title || id;
        bounds = extentBbox(doc);
        if (doc.itemType && doc.itemType !== "feature") {
          lf.push(finding("fail", "itemtype", `collection holds ${doc.itemType}s, not features`));
        }
        if (doc.crs?.length && !doc.crs.some(isWgs84Crs)) {
          lf.push(
            finding("warn", "crs", `CRS list has no WGS84/CRS84 (${doc.crs.slice(0, 3).join(", ")}) — items may not be lon/lat`),
          );
        }
        if (doc.storageCrs && !isWgs84Crs(doc.storageCrs)) {
          facts.push(`stored in ${doc.storageCrs.replace(/^.*\/EPSG\/\d+\/(\d+)$/, "EPSG:$1")}`);
        }
        if (!bounds) lf.push(finding("info", "bounds", "no spatial extent — no zoom-to-layer"));
      }
    }
    const report: LayerReport = {
      name: id,
      title,
      verdict: "ok",
      facts,
      findings: lf,
      probed: false,
      snippet: ogcApiSnippet(url, title, bounds),
    };
    if (targets.has(id)) {
      report.probed = true;
      report.probe = await probeItems(url, bounds, opts, lf, facts);
    }
    report.verdict = verdictOf(lf);
    layers.push(report);
  }

  return {
    kind: "ogcapi-features",
    title: info.title,
    provider: undefined,
    url: collectionId ? collectionUrl(root, collectionId) : root,
    capabilitiesUrl: det.capabilitiesUrl,
    summary: [
      `${featureIds.length} feature collections · ${conformance.length} conformance classes`,
      ...(info.description ? [info.description.replace(/\s+/g, " ").slice(0, 120)] : []),
    ],
    findings,
    layerCount: ids.length,
    layers,
  };
}

/** the first items page exactly as map0 asks for it (core/adapters/ogcapi-features.ts): f=json, limit=1 */
async function probeItems(
  collUrl: string,
  bounds: BBox | undefined,
  opts: Options,
  lf: Finding[],
  facts: string[],
): Promise<ProbeResult> {
  const url = buildItemsUrl({ url: collUrl }, 1);
  const res = await timedFetch(url, {
    origin: opts.origin,
    timeoutMs: opts.timeoutMs,
    accept: "application/geo+json, application/json",
  });
  const probe: ProbeResult = {
    url,
    status: res.status,
    ms: res.ms,
    bytes: res.bytes,
    contentType: shortType(res.contentType),
    cors: res.cors,
    ...(res.error ? { error: res.error } : {}),
  };
  if (res.error) {
    lf.push(finding("fail", "items", `items: ${res.error}`));
    return probe;
  }
  /* map0's own parser, so its error text is what the user would see in the viewer */
  let page: { features: Array<{ geometry?: unknown }>; next?: string };
  try {
    if (!res.ok) throw new Error(exceptionText(res.text) ?? `${res.status} ${shortType(res.contentType)}`);
    page = parseItemsResponse(res.text ?? "", url);
  } catch (e) {
    lf.push(finding("fail", "items", `items?f=json: ${e instanceof Error ? e.message : String(e)}`));
    return probe;
  }
  lf.push(finding("ok", "items", `items ${describeResponse(res)} — GeoJSON FeatureCollection`));
  lf.push(corsFinding(res, "items", opts.origin));

  let count: number | undefined;
  try {
    const n = (JSON.parse(res.text ?? "") as { numberMatched?: unknown }).numberMatched;
    if (typeof n === "number") count = n;
  } catch {
    /* parsed fine a moment ago */
  }
  const size = sizeFinding(count, "items");
  if (size && count !== undefined) {
    lf.push(size);
    facts.push(`${count.toLocaleString("en")} items`);
  } else {
    lf.push(finding("info", "size", "numberMatched not reported — map0 pages by next links until its limit"));
  }
  lf.push(
    page.next
      ? finding("ok", "paging", "next link present — paging works")
      : count !== undefined && count > 1
        ? finding("warn", "paging", "no next link on a page with limit=1 — map0 would stop after the first page")
        : finding("info", "paging", "no next link (single page)"),
  );
  const coord = firstCoordinate(page.features[0]?.geometry);
  if (coord && bounds) {
    if (looksAxisSwapped(coord, bounds)) {
      lf.push(
        finding("warn", "axis", `first coordinate ${coord.join(", ")} fits the extent only as lat/lon — the server answers in lat/lon order`),
      );
    } else if (!inBbox(coord, bounds)) {
      lf.push(
        finding("warn", "axis", `first coordinate ${coord.join(", ")} lies outside the collection extent — check the CRS of the answer`),
      );
    } else {
      lf.push(finding("ok", "axis", "coordinates are lon/lat inside the extent"));
    }
  }
  return probe;
}
