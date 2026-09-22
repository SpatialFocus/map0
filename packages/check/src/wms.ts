import {
  buildWmsTileUrl,
  isMercatorCrs,
  loadOgcClient,
  pickInfoFormat,
  readWmsCapabilities,
  scaleDenominatorToZoom,
  wmsLayerFromCandidate,
  type ServiceLayerCandidate,
} from "@map0/core";
import type { Detection } from "./detect.js";
import { AUSTRIA_CENTER, bboxCenter, chooseZoom, lonLatToTile, roundBbox, tileBbox3857, type BBox } from "./geo.js";
import { corsFinding, describeResponse, exceptionText, httpsFinding, isImageType, shortType, timedFetch } from "./http.js";
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

type WmsVersion = "1.1.1" | "1.3.0";

const BROWSER_IMAGE = /^image\/(png|jpeg|jpg|webp|gif)(;|$)/i;

/** what ogc-client knows about a named layer beyond the shared candidate */
interface LayerExtras {
  ownCrs: readonly string[];
  maxZoom?: number;
  hasLegend: boolean;
}

/** the GetMap request map0's wms adapter sends, for one 256 px tile in EPSG:3857 */
export function getMapUrl(base: string, version: WmsVersion, layer: string, bbox3857: BBox): string {
  const template = buildWmsTileUrl({ url: base, layers: layer, version });
  return template.replace("{bbox-epsg-3857}", bbox3857.join(","));
}

/** the snippet map0's dialogs build, plus the protocol version when the server is not on 1.3.0 */
export function wmsSnippet(
  service: { url: string; infoFormat?: string },
  c: ServiceLayerCandidate,
  version: WmsVersion,
): Record<string, unknown> {
  const def = wmsLayerFromCandidate(service, c) as unknown as Record<string, unknown>;
  if (version !== "1.3.0") def.version = version;
  if (Array.isArray(def.bounds)) def.bounds = roundBbox(def.bounds as BBox);
  return def;
}

export async function analyzeWms(det: Detection, opts: Options): Promise<ServiceReport> {
  /* the shared reading (CRS inherited additively, bounds coerced) and, for the
     details the report adds, the endpoint itself — ogc-client caches the parse */
  const ogc = await loadOgcClient();
  const [caps, endpoint] = await Promise.all([
    readWmsCapabilities(det.capabilitiesUrl),
    new ogc.WmsEndpoint(det.capabilitiesUrl).isReady(),
  ]);
  const info = endpoint.getServiceInfo();
  const version: WmsVersion = endpoint.getVersion() === "1.3.0" ? "1.3.0" : "1.1.1";
  const formats = info.outputFormats ?? [];
  const imageFormats = formats.filter((f) => BROWSER_IMAGE.test(f));
  const infoFormats = info.infoFormats ?? [];
  const infoFormat = pickInfoFormat(infoFormats);
  const service = { url: det.baseUrl, ...(infoFormat ? { infoFormat } : {}) };

  const findings: Finding[] = [
    httpsFinding(det.baseUrl),
    finding(det.response.ok ? "ok" : "fail", "reachable", `GetCapabilities ${describeResponse(det.response)}`),
    corsFinding(det.response, "GetCapabilities", opts.origin),
  ];
  if (formats.includes("image/png")) {
    findings.push(finding("ok", "getmap", "GetMap offers image/png"));
  } else if (imageFormats.length) {
    findings.push(
      finding("warn", "getmap", `no image/png — only ${imageFormats.join(", ")}: overlays cannot be transparent`),
    );
  } else {
    findings.push(
      finding("fail", "getmap", `no browser image format among GetMap formats (${formats.join(", ") || "none listed"})`),
    );
  }
  if (infoFormat) {
    findings.push(
      finding(
        infoFormat === "application/json" ? "ok" : "info",
        "featureinfo",
        infoFormat === "application/json"
          ? "GetFeatureInfo as application/json — popups get structured attributes"
          : `GetFeatureInfo only as ${infoFormat} (no JSON) — popups show the raw response`,
      ),
    );
  } else {
    findings.push(
      finding("info", "featureinfo", "no GetFeatureInfo format map0 can read (JSON or HTML) — click popups stay off"),
    );
  }
  findings.push(
    finding("info", "version", `WMS ${endpoint.getVersion()}; map0 requests tiles in EPSG:3857 with ${version === "1.3.0" ? "CRS" : "SRS"}`),
  );
  let getMapOperation = "";
  try {
    getMapOperation = endpoint.getOperationUrl("GetMap");
  } catch {
    /* no DCPType — map0 uses the config URL anyway */
  }
  if (getMapOperation) {
    const advertised = new URL(getMapOperation);
    const configured = new URL(det.baseUrl);
    if (advertised.protocol !== configured.protocol || advertised.host !== configured.host) {
      findings.push(
        finding(
          "info",
          "operation-url",
          `capabilities advertise GetMap at ${advertised.origin} — map0 ignores that and uses the config URL (${configured.origin}); generic clients may follow the advertised one`,
        ),
      );
    }
  }

  const { targets, missing } = probeTargets(caps.candidates.map((c) => c.name), opts);
  for (const m of missing) {
    const hint = caps.candidates.find(
      (c) => c.name.toLowerCase() === m.toLowerCase() || c.name.endsWith(`:${m}`) || m.endsWith(`:${c.name}`),
    );
    findings.push(
      finding("fail", "layer", `--layer "${m}" is not a named leaf layer of this service${hint ? ` — did you mean "${hint.name}"?` : ""}`),
    );
  }

  const layers: LayerReport[] = [];
  for (const c of caps.candidates) {
    const lf: Finding[] = [];
    const facts: string[] = [];
    const extras = layerExtras(endpoint, c.name);
    const ownHas3857 = extras.ownCrs.some(isMercatorCrs);
    if (c.has3857 && ownHas3857) {
      facts.push("EPSG:3857");
    } else if (c.has3857 && extras.ownCrs.length > 0) {
      facts.push("EPSG:3857 (inherited)");
      lf.push(finding("info", "crs-3857", "EPSG:3857 comes from a parent layer, not the layer's own CRS list — map0 reads the inheritance, plain capabilities readers may not"));
    } else if (c.has3857) {
      facts.push("CRS unknown");
      lf.push(finding("warn", "crs-3857", "no CRS declared anywhere for this layer — the GetMap probe decides"));
    } else {
      lf.push(
        finding(
          "fail",
          "crs-3857",
          `EPSG:3857 not offered (has ${extras.ownCrs.slice(0, 4).join(", ")}${extras.ownCrs.length > 4 ? `, … ${extras.ownCrs.length} total` : ""}) — map0 shows Web Mercator only (decision D-02)`,
        ),
      );
    }
    if (c.queryable) facts.push("queryable");
    if (c.minZoom !== undefined && c.minZoom > 0) facts.push(`zoom ≥ ${c.minZoom}`);
    if (extras.maxZoom !== undefined) facts.push(`zoom ≤ ${extras.maxZoom}`);
    if (!c.bounds) lf.push(finding("info", "bounds", "no WGS84 bounding box — no zoom-to-layer, probe uses the Austrian centre"));
    if (!extras.hasLegend) lf.push(finding("info", "legend", "no LegendURL in the capabilities — map0 asks GetLegendGraphic instead"));

    const report: LayerReport = {
      name: c.name,
      title: c.title,
      verdict: "ok",
      facts,
      findings: lf,
      probed: false,
      snippet: wmsSnippet(service, c, version),
    };
    if (targets.has(c.name)) {
      report.probed = true;
      const { probe, image } = await probeGetMap(det.baseUrl, version, c, extras.maxZoom, opts, lf);
      report.probe = probe;
      if (image && !c.has3857) {
        const crs = lf.find((f) => f.code === "crs-3857");
        if (crs) {
          crs.level = "warn";
          crs.message = "EPSG:3857 is not declared, yet GetMap in EPSG:3857 answered with an image — it works, but the capabilities should say so";
        }
      }
    }
    report.verdict = verdictOf(lf);
    layers.push(report);
  }

  return {
    kind: "wms",
    version: endpoint.getVersion(),
    title: caps.title ?? info.name,
    provider: info.provider?.name,
    url: det.baseUrl,
    capabilitiesUrl: det.capabilitiesUrl,
    summary: [
      `${caps.candidates.length} named layers · GetMap ${imageFormats.map((f) => f.replace(/^image\//, "")).join(", ") || "no image format"}`,
      `GetFeatureInfo ${infoFormats.filter((f) => /json|html|plain/i.test(f)).join(", ") || "—"}`,
    ],
    findings,
    layerCount: caps.candidates.length,
    layers,
  };
}

function layerExtras(endpoint: { getLayerByName(name: string): unknown }, name: string): LayerExtras {
  const full = endpoint.getLayerByName(name) as {
    availableCrs?: readonly string[];
    minScaleDenominator?: number;
    styles?: ReadonlyArray<{ legendUrl?: string }>;
  };
  return {
    ownCrs: full.availableCrs ?? [],
    ...(full.minScaleDenominator ? { maxZoom: scaleDenominatorToZoom(full.minScaleDenominator) } : {}),
    hasLegend: (full.styles ?? []).some((s) => Boolean(s.legendUrl)),
  };
}

/**
 * One 256 px GetMap tile in EPSG:3857 around the layer's centre, at a zoom
 * inside its scale range — the request map0's adapter builds, against the
 * config URL rather than the operation URL the capabilities advertise.
 */
async function probeGetMap(
  base: string,
  version: WmsVersion,
  c: ServiceLayerCandidate,
  maxZoom: number | undefined,
  opts: Options,
  lf: Finding[],
): Promise<{ probe: ProbeResult; image: boolean }> {
  const z = chooseZoom(c.minZoom, maxZoom, 8);
  const centre = c.bounds ? bboxCenter(c.bounds) : AUSTRIA_CENTER;
  const t = lonLatToTile(centre, z);
  const url = getMapUrl(base, version, c.name, tileBbox3857(z, t.x, t.y));
  const res = await timedFetch(url, { origin: opts.origin, timeoutMs: opts.timeoutMs, accept: "image/*,*/*;q=0.5" });
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
    lf.push(finding("fail", "getmap", `GetMap z${z}: ${res.error}`));
    return { probe, image: false };
  }
  if (res.ok && isImageType(res.contentType)) {
    lf.push(finding("ok", "getmap", `GetMap z${z} in EPSG:3857: ${describeResponse(res)}`));
    lf.push(corsFinding(res, "GetMap", opts.origin));
    return { probe, image: true };
  }
  const why = exceptionText(res.text) ?? `${res.status} ${shortType(res.contentType)}`;
  lf.push(finding("fail", "getmap", `GetMap z${z} in EPSG:3857 failed: ${why}`));
  return { probe, image: false };
}
