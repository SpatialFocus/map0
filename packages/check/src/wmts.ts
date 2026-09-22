import type { WmtsLayer } from "@camptocamp/ogc-client";
import { isMercatorCrs, loadOgcClient, wmtsLayerFromCandidate } from "@map0/core";
import type { Detection } from "./detect.js";
import { AUSTRIA_CENTER, bboxCenter, lonLatBbox, roundBbox, wmtsTileIndex, type BBox } from "./geo.js";
import {
  corsFinding,
  describeResponse,
  exceptionText,
  httpsFinding,
  isImageType,
  shortType,
  timedFetch,
  type HttpResult,
} from "./http.js";
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

/** browser-decodable tile formats, best first */
export function imageFormats(formats: string[]): string[] {
  const imgs = formats.filter((f) => /^image\/(png|jpeg|jpg|webp|gif)/i.test(f));
  return [...new Set(imgs)].sort((a, b) => rank(a) - rank(b));
}

function rank(f: string): number {
  if (/png/i.test(f)) return 0;
  if (/webp/i.test(f)) return 1;
  return 2;
}

/** fill a WMTS REST template; placeholder names are matched case-insensitively, unknown ones stay */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  const lookup = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  return template.replace(/\{([^}]+)\}/g, (whole, key: string) => lookup.get(key.toLowerCase()) ?? whole);
}

/** the snippet map0's dialogs build for a WMTS layer */
export function wmtsSnippet(url: string, name: string, has3857: boolean, bounds: BBox | undefined): Record<string, unknown> {
  const def = wmtsLayerFromCandidate({ url }, { name, title: name, queryable: false, has3857, ...(bounds ? { bounds } : {}) });
  const out = def as unknown as Record<string, unknown>;
  if (Array.isArray(out.bounds)) out.bounds = roundBbox(out.bounds as BBox);
  return out;
}

export async function analyzeWmts(det: Detection, opts: Options): Promise<ServiceReport> {
  const ogc = await loadOgcClient();
  const endpoint = await new ogc.WmtsEndpoint(det.capabilitiesUrl).isReady();
  const info = endpoint.getServiceInfo();
  const matrixSets = endpoint.getMatrixSets();
  const mercatorSets = matrixSets.filter((m) => isMercatorCrs(m.crs));

  const findings: Finding[] = [
    httpsFinding(det.baseUrl),
    finding(det.response.ok ? "ok" : "fail", "reachable", `GetCapabilities ${describeResponse(det.response)}`),
    corsFinding(det.response, "GetCapabilities", opts.origin),
  ];
  const encodings = [info.getTileUrls?.rest ? "REST" : "", info.getTileUrls?.kvp ? "KVP" : ""].filter(Boolean);
  findings.push(finding("info", "encoding", `GetTile via ${encodings.join(" and ") || "resource URLs only"}`));
  if (mercatorSets.length === 0) {
    findings.push(
      finding(
        "fail",
        "matrixsets",
        `no WebMercator tile matrix set (has ${matrixSets.map((m) => `${m.identifier} [${m.crs}]`).join(", ") || "none"}) — map0 needs EPSG:3857 tiles (decision D-02)`,
      ),
    );
  } else {
    findings.push(
      finding(
        "ok",
        "matrixsets",
        `WebMercator tile matrix set${mercatorSets.length > 1 ? "s" : ""}: ${mercatorSets.map((m) => m.identifier).join(", ")}`,
      ),
    );
  }

  const all = endpoint.getLayers();
  const { targets, missing } = probeTargets(all.map((l) => l.name), opts);
  for (const m of missing) findings.push(finding("fail", "layer", `--layer "${m}" is not a layer of this service`));

  const layers: LayerReport[] = [];
  for (const layer of all) {
    const lf: Finding[] = [];
    const facts: string[] = [];
    const merc = layer.matrixSets.filter((m) => isMercatorCrs(m.crs));
    const formats = [...new Set(layer.resourceLinks.map((r) => r.format))];
    const imgs = imageFormats(formats);
    const bounds = lonLatBbox(layer.latLonBoundingBox);

    if (merc.length) facts.push(merc.map((m) => m.identifier).join("/"));
    else {
      lf.push(
        finding(
          "fail",
          "crs-3857",
          `no WebMercator matrix set on this layer (has ${layer.matrixSets.map((m) => m.identifier).join(", ") || "none"}) — decision D-02`,
        ),
      );
    }

    const bestFormat = imgs[0];
    if (bestFormat) {
      facts.push(bestFormat.replace(/^image\//, ""));
    } else if (formats.some((f) => /mapbox-vector-tile|mvt|pbf/i.test(f))) {
      lf.push(
        finding(
          "fail",
          "format",
          `vector tiles only (${formats.join(", ")}) — map0's wmts layer needs image tiles; publish the layer as a "vector" source instead`,
        ),
      );
    } else {
      lf.push(finding("warn", "format", `no browser image format advertised (${formats.join(", ") || "none"})`));
    }
    if (layer.dimensions?.length) {
      facts.push(`dimensions: ${layer.dimensions.map((d) => `${d.identifier}=${d.defaultValue}`).join(", ")}`);
      lf.push(finding("info", "dimensions", "layer has dimensions — map0 requests the default values"));
    }
    if (!bounds) lf.push(finding("info", "bounds", "no WGS84 bounding box — no zoom-to-layer, probe uses the Austrian centre"));
    if (layer.styles.length > 1) facts.push(`${layer.styles.length} styles`);

    const report: LayerReport = {
      name: layer.name,
      title: layer.name,
      verdict: "ok",
      facts,
      findings: lf,
      probed: false,
      snippet: wmtsSnippet(det.baseUrl, layer.name, merc.length > 0, bounds),
    };
    const firstMerc = merc[0];
    if (targets.has(layer.name)) {
      report.probed = true;
      if (firstMerc && bestFormat) {
        report.probe = await probeTile(endpoint, layer, firstMerc, bestFormat, bounds, opts, lf);
      }
    }
    report.verdict = verdictOf(lf);
    layers.push(report);
  }

  return {
    kind: "wmts",
    version: "1.0.0",
    title: info.title || info.name,
    provider: info.provider?.name,
    url: det.baseUrl,
    capabilitiesUrl: det.capabilitiesUrl,
    summary: [`${all.length} layers · ${matrixSets.length} tile matrix sets`],
    findings,
    layerCount: all.length,
    layers,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function tileOk(r: HttpResult): boolean {
  return r.ok && isImageType(r.contentType);
}

function failReason(r: HttpResult): string {
  return r.error ?? exceptionText(r.text) ?? `${r.status} ${shortType(r.contentType)}`;
}

type Endpoint = Awaited<ReturnType<InstanceType<Awaited<ReturnType<typeof loadOgcClient>>["WmtsEndpoint"]>["isReady"]>>;

/**
 * One tile from a WebMercator matrix set near zoom 7, inside the layer's
 * TileMatrixSetLimits when given. Every distinct host among the layer's REST
 * ResourceURLs is tried, because capabilities routinely keep advertising
 * retired mirror hosts — map0's adapter probes them the same way.
 */
async function probeTile(
  endpoint: Endpoint,
  layer: WmtsLayer,
  link: WmtsLayer["matrixSets"][number],
  format: string,
  bounds: BBox | undefined,
  opts: Options,
  lf: Finding[],
): Promise<ProbeResult | undefined> {
  const set = endpoint.getMatrixSetByIdentifier(link.identifier);
  const matrices = [...set.tileMatrices].sort((a, b) => b.scaleDenominator - a.scaleDenominator);
  const limited = link.limits?.length
    ? matrices.filter((m) => link.limits.some((l) => l.tileMatrix === m.identifier))
    : matrices;
  const pool = limited.length ? limited : matrices;
  const tm = pool[Math.min(7, pool.length - 1)];
  if (!tm) {
    lf.push(finding("warn", "tile", `matrix set ${link.identifier} has no tile matrices`));
    return undefined;
  }
  const centre = bounds ? bboxCenter(bounds) : AUSTRIA_CENTER;
  let { col, row } = wmtsTileIndex(centre, tm);
  const limit = link.limits?.find((l) => l.tileMatrix === tm.identifier);
  if (limit) {
    col = Math.min(limit.maxTileCol, Math.max(limit.minTileCol, col));
    row = Math.min(limit.maxTileRow, Math.max(limit.minTileRow, row));
  }

  let dims: Record<string, string> = {};
  try {
    dims = endpoint.getDefaultDimensions(layer.name);
  } catch {
    /* no dimensions */
  }
  const rest = layer.resourceLinks.filter((r) => r.encoding === "REST" && r.format === format);
  let urls: string[];
  if (rest.length) {
    urls = rest.map((r) =>
      fillTemplate(r.url, {
        TileMatrixSet: link.identifier,
        TileMatrix: tm.identifier,
        TileRow: String(row),
        TileCol: String(col),
        Style: layer.defaultStyle,
        ...dims,
      }),
    );
  } else {
    try {
      urls = [endpoint.getTileUrl(layer.name, layer.defaultStyle, link.identifier, tm.identifier, row, col, format)];
    } catch (e) {
      lf.push(finding("warn", "tile", `could not build a tile URL: ${e instanceof Error ? e.message : e}`));
      return undefined;
    }
  }
  const byHost = new Map<string, string>();
  for (const u of urls) if (!byHost.has(hostOf(u))) byHost.set(hostOf(u), u);
  const results = await Promise.all(
    [...byHost.values()].map((u) =>
      timedFetch(u, { origin: opts.origin, timeoutMs: opts.timeoutMs, accept: "image/*,*/*;q=0.5" }),
    ),
  );
  const good = results.filter(tileOk);
  const bad = results.filter((r) => !tileOk(r));
  const where = `tile ${tm.identifier}/${row}/${col}`;
  const first = good[0];

  if (first) {
    lf.push(
      finding("ok", "tile", `${where}: ${describeResponse(first)}${results.length > 1 ? ` from ${hostOf(first.url)}` : ""}`),
    );
    lf.push(corsFinding(first, "GetTile", opts.origin));
  }
  if (bad.length) {
    const list = bad.map((r) => `${hostOf(r.url)} (${failReason(r)})`).join(", ");
    if (first) {
      lf.push(
        finding(
          "warn",
          "tile-hosts",
          `${bad.length} of ${results.length} advertised tile hosts fail: ${list} — map0 probes the hosts and skips dead ones, plain clients that take the first ResourceURL break`,
        ),
      );
    } else if (results.length === 1 && bad[0]?.status === 404 && !limit) {
      lf.push(
        finding("warn", "tile", `${where}: 404 — probably outside the layer's data (no TileMatrixSetLimits to steer the probe)`),
      );
    } else {
      lf.push(finding("fail", "tile", `${where} failed on every advertised host: ${list}`));
    }
  }
  const shown = first ?? results[0];
  if (!shown) return undefined;
  return {
    url: shown.url,
    status: shown.status,
    ms: shown.ms,
    bytes: shown.bytes,
    contentType: shortType(shown.contentType),
    cors: shown.cors,
    ...(shown.error ? { error: shown.error } : {}),
  };
}
