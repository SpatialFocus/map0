import { cleanServiceUrl } from "@map0/core";
import { exceptionText, timedFetch, withParams, withoutParams, type FetchOptions, type HttpResult } from "./http.js";
import type { ServiceKind } from "./types.js";

export interface Detection {
  kind: ServiceKind;
  /** the URL that answered with the capabilities / landing document */
  capabilitiesUrl: string;
  /** the URL a map0 layer definition should carry */
  baseUrl: string;
  response: HttpResult;
  attempts: string[];
}

export interface DetectionFailure {
  error: string;
  attempts: string[];
}

const ACCEPT = "application/json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5";

/** what the URL itself suggests, before any request */
export function hintFromUrl(url: string): ServiceKind | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  for (const [k, v] of u.searchParams) {
    if (k.toLowerCase() === "service") {
      const s = v.toLowerCase();
      if (s === "wms") return "wms";
      if (s === "wmts") return "wmts";
      if (s === "wfs") return "wfs";
    }
  }
  const path = u.pathname.toLowerCase();
  if (path.includes("/collections") || path.endsWith("/conformance")) return "ogcapi-features";
  if (path.includes("wmts")) return "wmts";
  if (path.includes("wfs")) return "wfs";
  if (path.includes("wms")) return "wms";
  return undefined;
}

/** classify a response body */
export function sniff(res: HttpResult): ServiceKind | "exception" | undefined {
  if (res.error || !res.text) return undefined;
  const text = res.text.trimStart();
  if (text.startsWith("{") || /json/i.test(res.contentType)) {
    return sniffJson(text);
  }
  if (!text.startsWith("<")) return undefined;
  const root = rootTag(text);
  if (!root) return undefined;
  if (/^(WMS_Capabilities|WMT_MS_Capabilities)$/.test(root)) return "wms";
  if (root === "WFS_Capabilities") return "wfs";
  if (root === "Capabilities" && /opengis\.net\/wmts/i.test(text.slice(0, 4000))) return "wmts";
  if (/^(ServiceExceptionReport|ExceptionReport)$/.test(root)) return "exception";
  return undefined;
}

function sniffJson(text: string): ServiceKind | undefined {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!o || typeof o !== "object") return undefined;
  const doc = o as {
    type?: string;
    links?: unknown;
    conformsTo?: unknown;
    collections?: unknown;
    extent?: unknown;
    id?: unknown;
  };
  if (doc.type === "FeatureCollection") return "ogcapi-features";
  if (Array.isArray(doc.links)) {
    if (doc.conformsTo || doc.collections || doc.extent || typeof doc.id === "string") return "ogcapi-features";
    const rels = (doc.links as Array<{ rel?: string }>).map((l) => String(l.rel ?? ""));
    if (rels.some((r) => /^(data|conformance|items|collections|service-desc)$/.test(r) || r.includes("ogc/rel"))) {
      return "ogcapi-features";
    }
  }
  return undefined;
}

/** local name of the document element, skipping prolog, comments and doctype */
export function rootTag(xml: string): string | undefined {
  const m = /<((?:[\w.-]+:)?)([A-Za-z_][\w.-]*)[\s>/]/.exec(xml.slice(0, 20000));
  return m?.[2];
}

function candidate(kind: ServiceKind, input: string, base: string): string {
  switch (kind) {
    case "wms":
      return withParams(base, { service: "WMS", request: "GetCapabilities" });
    case "wmts":
      return withParams(base, { service: "WMTS", request: "GetCapabilities", version: "1.0.0" });
    case "wfs":
      return withParams(base, { service: "WFS", request: "GetCapabilities" });
    case "ogcapi-features":
      return withParams(input, { f: "json" });
  }
}

function build(kind: ServiceKind, capabilitiesUrl: string, res: HttpResult, attempts: string[]): Detection {
  const answered = res.finalUrl || capabilitiesUrl;
  let baseUrl: string;
  switch (kind) {
    case "wms":
    case "wfs":
      baseUrl = cleanServiceUrl(answered);
      break;
    case "wmts":
      baseUrl = answered;
      break;
    case "ogcapi-features": {
      const u = new URL(withoutParams(answered, ["f"]));
      u.pathname = u.pathname.replace(/\/items\/?$/, "").replace(/\/+$/, "");
      baseUrl = u.toString();
      break;
    }
  }
  return { kind, capabilitiesUrl, baseUrl, response: res, attempts };
}

/**
 * Find out what kind of service a URL is: first the URL as given (a pasted
 * GetCapabilities, a WMTS REST capabilities file, an OGC API landing page or
 * collection), then GetCapabilities candidates, the URL's own hint first.
 */
export async function detectService(input: string, opts: FetchOptions): Promise<Detection | DetectionFailure> {
  const attempts: string[] = [];
  const fetchOpts = { ...opts, accept: ACCEPT };
  let exception: string | undefined;

  const direct = await timedFetch(input, fetchOpts);
  attempts.push(input);
  const directKind = sniff(direct);
  if (directKind && directKind !== "exception") return build(directKind, input, direct, attempts);
  if (directKind === "exception") exception = exceptionText(direct.text);

  const hint = hintFromUrl(input);
  const order: ServiceKind[] = [];
  for (const k of [hint, "wms", "wmts", "wfs", "ogcapi-features"] as Array<ServiceKind | undefined>) {
    if (k && !order.includes(k)) order.push(k);
  }
  const base = cleanServiceUrl(input);
  for (const kind of order) {
    const url = candidate(kind, input, base);
    if (attempts.includes(url)) continue;
    const res = await timedFetch(url, fetchOpts);
    attempts.push(url);
    const found = sniff(res);
    if (found === kind) return build(kind, url, res, attempts);
    if (found === "exception" && !exception) exception = exceptionText(res.text);
  }

  const why = direct.error
    ? direct.error
    : exception
      ? `the server answered with an exception: ${exception}`
      : `no WMS, WMTS, WFS or OGC API document found (first answer: ${direct.status} ${
          direct.contentType.split(";")[0] || "no content-type"
        })`;
  return { error: why, attempts };
}
