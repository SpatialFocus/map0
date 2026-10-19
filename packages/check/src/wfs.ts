import { buildGetFeatureUrl, loadOgcClient, parseWfsResponse } from "@map0/core";
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

type WfsVersion = "1.1.0" | "2.0.0";

/** map0's default `limit` for wfs and ogcapi-features layers */
export const FEATURE_LIMIT = 10000;

/**
 * The GeoJSON output format a server advertises, in map0's spelling. GeoServer
 * and deegree take "application/json" (map0's default); MapServer wants
 * "geojson"; some list "application/json; subtype=geojson" or vnd.geo+json.
 */
export function pickJsonFormat(formats: readonly string[]): string | undefined {
  const exact = formats.find((f) => /^application\/json$/i.test(f.trim()));
  if (exact) return "application/json";
  return formats.find((f) => /json/i.test(f));
}

export function wfsSnippet(
  name: string,
  title: string,
  url: string,
  version: WfsVersion,
  outputFormat: string | undefined,
  bounds: BBox | undefined,
  metadataUrl: string | undefined,
): Record<string, unknown> {
  return {
    type: "wfs",
    url,
    typeNames: name,
    title,
    ...(version === "1.1.0" ? { version: "1.1.0" } : {}),
    ...(outputFormat && outputFormat !== "application/json" ? { outputFormat } : {}),
    ...(bounds ? { bounds: roundBbox(bounds) } : {}),
    ...(metadataUrl ? { metadata: { url: metadataUrl } } : {}),
  };
}

/** feature-count wording for the size checks shared with OGC API Features */
export function sizeFinding(count: number | undefined, what: string): Finding | undefined {
  if (count === undefined) return undefined;
  if (count > 250000) {
    return finding(
      "warn",
      "size",
      `${count.toLocaleString("en")} ${what} — far beyond what a browser should load at once; prefer a WMS of the same data or filter with params (cql_filter, bbox)`,
    );
  }
  if (count > FEATURE_LIMIT) {
    return finding(
      "warn",
      "size",
      `${count.toLocaleString("en")} ${what} — above map0's default limit of ${FEATURE_LIMIT.toLocaleString("en")}; raise "limit" or filter`,
    );
  }
  return finding("ok", "size", `${count.toLocaleString("en")} ${what}`);
}

/** map0's own GetFeature request (core/adapters/wfs.ts), limited to one feature */
export function sampleUrl(base: string, version: WfsVersion, typeNames: string, outputFormat: string): string {
  return buildGetFeatureUrl({ url: base, typeNames, version, outputFormat }, { count: 1 });
}

export async function analyzeWfs(det: Detection, opts: Options): Promise<ServiceReport> {
  const ogc = await loadOgcClient();
  const endpoint = await new ogc.WfsEndpoint(det.capabilitiesUrl).isReady();
  const info = endpoint.getServiceInfo();
  const serverVersion = endpoint.getVersion();
  const version: WfsVersion = serverVersion === "1.1.0" ? "1.1.0" : "2.0.0";
  const types = endpoint.getFeatureTypes();

  const findings: Finding[] = [
    httpsFinding(det.baseUrl),
    finding(det.response.ok ? "ok" : "fail", "reachable", `GetCapabilities ${describeResponse(det.response)}`),
    corsFinding(det.response, "GetCapabilities", opts.origin),
  ];
  if (serverVersion === "2.0.0") {
    findings.push(finding("ok", "version", "WFS 2.0.0 — map0 pages with count/startIndex"));
    if (!endpoint.supportsStartIndex()) {
      findings.push(
        finding(
          "warn",
          "paging",
          "ImplementsResultPaging is not declared — paging may be ignored; keep pageSize ≥ the expected feature count",
        ),
      );
    }
  } else if (serverVersion === "1.1.0") {
    findings.push(
      finding("warn", "version", 'WFS 1.1.0 only — one maxFeatures request, no paging; the snippet sets "version": "1.1.0"'),
    );
  } else {
    findings.push(finding("fail", "version", `WFS ${serverVersion} — map0 supports 1.1.0 and 2.0.0 only`));
  }
  const serviceJson = pickJsonFormat(info.outputFormats ?? []);
  findings.push(
    serviceJson
      ? finding("ok", "geojson", `GeoJSON output: ${serviceJson}`)
      : finding("info", "geojson", "no GeoJSON format at service level — checked per feature type"),
  );

  const { targets, missing } = probeTargets(types.map((t) => t.name), opts);
  for (const m of missing) findings.push(finding("fail", "layer", `--layer "${m}" is not a feature type of this service`));

  const layers: LayerReport[] = [];
  for (const brief of types) {
    const lf: Finding[] = [];
    const facts: string[] = [];
    const summary = endpoint.getFeatureTypeSummary(brief.name);
    const formats = summary.outputFormats?.length ? summary.outputFormats : (info.outputFormats ?? []);
    const jsonFormat = pickJsonFormat(formats);
    const crsList = [summary.defaultCrs, ...(summary.otherCrs ?? [])].filter(Boolean);
    const bounds = lonLatBbox(summary.boundingBox);
    const title = summary.title ?? brief.name;

    if (jsonFormat) {
      facts.push(jsonFormat === "application/json" ? "GeoJSON" : `GeoJSON as ${jsonFormat}`);
    } else {
      lf.push(
        finding("fail", "geojson", `no GeoJSON output format (has ${formats.slice(0, 4).join(", ") || "none listed"}) — map0 reads GeoJSON only`),
      );
    }
    if (crsList.some(isWgs84Crs)) {
      facts.push("WGS84");
    } else {
      lf.push(
        finding(
          "info",
          "crs",
          `EPSG:4326 not listed (default ${summary.defaultCrs}) — map0 asks for SRSNAME=EPSG:4326; GeoServer reprojects regardless, other servers may refuse — the GetFeature probe verifies`,
        ),
      );
    }
    if (!bounds) lf.push(finding("info", "bounds", "no WGS84 bounding box — no zoom-to-layer"));

    const report: LayerReport = {
      name: brief.name,
      title,
      verdict: "ok",
      facts,
      findings: lf,
      probed: false,
      snippet: wfsSnippet(brief.name, title, det.baseUrl, version, jsonFormat, bounds, summary.metadata?.[0]?.url),
    };
    if (targets.has(brief.name)) {
      report.probed = true;
      if (jsonFormat && serverVersion !== "1.0.0") {
        report.probe = await probeFeatureType(det.baseUrl, version, brief.name, jsonFormat, bounds, opts, lf, facts);
      }
    }
    report.verdict = verdictOf(lf);
    layers.push(report);
  }

  return {
    kind: "wfs",
    version: serverVersion,
    title: info.title || info.name,
    provider: info.provider?.name,
    url: det.baseUrl,
    capabilitiesUrl: det.capabilitiesUrl,
    summary: [
      `${types.length} feature types · output ${
        (info.outputFormats ?? []).filter((f) => /json|gml/i.test(f)).slice(0, 4).join(", ") || "—"
      }`,
    ],
    findings,
    layerCount: types.length,
    layers,
  };
}

/** feature count via resultType=hits, then one real feature as GeoJSON the way map0 asks for it */
async function probeFeatureType(
  base: string,
  version: WfsVersion,
  name: string,
  outputFormat: string,
  bounds: BBox | undefined,
  opts: Options,
  lf: Finding[],
  facts: string[],
): Promise<ProbeResult> {
  const fetchOpts = { origin: opts.origin, timeoutMs: opts.timeoutMs };
  const url = sampleUrl(base, version, name, outputFormat);

  const hitsUrl = withParams(url, {
    RESULTTYPE: "hits",
    OUTPUTFORMAT: version === "2.0.0" ? "application/gml+xml; version=3.2" : "text/xml; subtype=gml/3.1.1",
  });
  const hits = await timedFetch(hitsUrl, { ...fetchOpts, accept: "application/xml, text/xml" });
  const countMatch = hits.text ? /number(?:Matched|OfFeatures)="(\d+)"/.exec(hits.text) : null;
  const count = countMatch?.[1] !== undefined ? Number(countMatch[1]) : undefined;
  const size = sizeFinding(count, "features");
  if (size && count !== undefined) {
    lf.push(size);
    facts.push(`${count.toLocaleString("en")} features`);
  } else {
    lf.push(
      finding("info", "size", `feature count unknown (resultType=hits: ${hits.error ?? exceptionText(hits.text) ?? describeResponse(hits)})`),
    );
  }

  const res = await timedFetch(url, { ...fetchOpts, accept: "application/json, application/geo+json, */*;q=0.5" });
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
    lf.push(finding("fail", "getfeature", `GetFeature: ${res.error}`));
    return probe;
  }
  /* map0's own parser, so its error text is what the user would see in the viewer */
  let features: Array<{ geometry?: unknown }>;
  try {
    features = parseWfsResponse(res.text ?? "", base).features;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    lf.push(finding("fail", "getfeature", `GetFeature as ${outputFormat} (${res.status} ${shortType(res.contentType)}): ${why}`));
    return probe;
  }
  lf.push(finding("ok", "getfeature", `GetFeature ${describeResponse(res)} — GeoJSON FeatureCollection`));
  lf.push(corsFinding(res, "GetFeature", opts.origin));

  let crsName: string | undefined;
  try {
    crsName = (JSON.parse(res.text ?? "") as { crs?: { properties?: { name?: string } } }).crs?.properties?.name;
  } catch {
    /* parsed fine a moment ago */
  }
  if (crsName && !isWgs84Crs(crsName)) {
    lf.push(finding("warn", "axis", `GeoJSON carries crs "${crsName}" — coordinates are not WGS84, MapLibre will place them wrongly`));
  }
  const coord = firstCoordinate(features[0]?.geometry);
  if (coord && bounds) {
    if (looksAxisSwapped(coord, bounds)) {
      lf.push(
        finding(
          "warn",
          "axis",
          `first coordinate ${coord.join(", ")} fits the bounds only as lat/lon — the server answers EPSG:4326 in lat/lon order; set "params": { "SRSNAME": "urn:ogc:def:crs:OGC:1.3:CRS84" }`,
        ),
      );
    } else if (!inBbox(coord, bounds)) {
      lf.push(
        finding("warn", "axis", `first coordinate ${coord.join(", ")} lies outside the advertised WGS84 bounds — check the CRS of the answer`),
      );
    } else {
      lf.push(finding("ok", "axis", "coordinates are lon/lat inside the advertised bounds"));
    }
  } else if (!coord) {
    lf.push(finding("info", "axis", "the sample feature has no geometry — axis order not checked"));
  }
  return probe;
}
