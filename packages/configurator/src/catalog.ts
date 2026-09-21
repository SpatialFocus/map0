/**
 * Catalog search as a layer source: a CSW 2.0.2 GetRecords (GeoNetwork and
 * friends) or an OGC API Records collection, searched by text, answered as
 * records with the service links they carry. A link that names a layer
 * becomes a layer definition directly; one that only names a service opens
 * the capabilities picker.
 */
import type { LayerDef } from "@map0/schema";
import { cleanServiceUrl, type ServiceKind } from "./services.js";

export type CatalogKind = "csw" | "records";

export interface CatalogLink {
  kind: ServiceKind;
  url: string;
  /** WMS layer name / WFS type name when the record states it */
  name?: string;
  label?: string;
}

export interface CatalogRecord {
  id: string;
  title: string;
  abstract?: string;
  links: CatalogLink[];
  /** the record's own page (metadata link for layers made from it) */
  landing?: string;
}

const NS = {
  csw: "http://www.opengis.net/cat/csw/2.0.2",
  dc: "http://purl.org/dc/elements/1.1/",
  dct: "http://purl.org/dc/terms/",
};

/** which map0 service a catalog protocol/type string points at, if any */
export function classifyProtocol(protocol: string | undefined, url: string): ServiceKind | null {
  const p = `${protocol ?? ""}`.toLowerCase();
  const u = url.toLowerCase();
  if (p.includes("wmts") || u.includes("wmtscapabilities") || u.includes("service=wmts")) return "wmts";
  if (p.includes("wms") || p.includes("wms_xml") || u.includes("service=wms")) return "wms";
  if (p.includes("wfs") || u.includes("service=wfs")) return "wfs";
  if ((p.includes("ogc") && p.includes("feature")) || p.includes("ogcapi") || (u.includes("/collections/") && !u.includes("/records")))
    return "ogcapi-features";
  return null;
}

const escapeXml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * GetRecords as a POST body: a full-text `AnyText` search with OGC Filter
 * wildcards, full records, up to `max` hits. XML rather than KVP+CQL on
 * purpose — GeoNetwork chokes on the `%` of a CQL LIKE and pycsw rejects
 * the KVP constraint parameters, while every CSW speaks Filter 1.1.
 */
export function cswGetRecordsBody(query: string, max = 40): string {
  const literal = `*${escapeXml(query.trim().replaceAll("*", ""))}*`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<csw:GetRecords xmlns:csw="${NS.csw}" xmlns:ogc="http://www.opengis.net/ogc" service="CSW" version="2.0.2" ` +
    `resultType="results" outputSchema="${NS.csw}" maxRecords="${max}" startPosition="1">` +
    `<csw:Query typeNames="csw:Record"><csw:ElementSetName>full</csw:ElementSetName>` +
    `<csw:Constraint version="1.1.0"><ogc:Filter>` +
    `<ogc:PropertyIsLike wildCard="*" singleChar="?" escapeChar="\\" matchCase="false">` +
    `<ogc:PropertyName>csw:AnyText</ogc:PropertyName><ogc:Literal>${literal}</ogc:Literal>` +
    `</ogc:PropertyIsLike></ogc:Filter></csw:Constraint></csw:Query></csw:GetRecords>`
  );
}

/** the items request of an OGC API Records collection (a collection or items URL) */
export function recordsItemsUrl(base: string, query: string, limit = 40): string {
  const trimmed = base.trim().replace(/\/$/, "");
  const u = new URL(trimmed.endsWith("/items") ? trimmed : `${trimmed}/items`);
  u.searchParams.set("q", query);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("f", "json");
  return u.toString();
}

const text = (el: Element | null | undefined): string | undefined => el?.textContent?.trim() || undefined;

/** the same service linked three times (view, download, …) is one link here */
function dedupeLinks(links: CatalogLink[]): CatalogLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = `${l.kind}|${l.url.split("?")[0]}|${l.name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** csw:Record elements of a GetRecords response → records with classified links */
export function parseCswRecords(doc: Document): CatalogRecord[] {
  const out: CatalogRecord[] = [];
  for (const rec of Array.from(doc.getElementsByTagNameNS(NS.csw, "Record"))) {
    const links: CatalogLink[] = [];
    for (const uri of Array.from(rec.getElementsByTagNameNS(NS.dc, "URI"))) {
      const url = text(uri);
      if (!url) continue;
      const kind = classifyProtocol(uri.getAttribute("protocol") ?? undefined, url);
      if (!kind) continue;
      /* attribute values arrive with the record's indentation in GeoNetwork exports */
      const attr = (n: string): string | undefined => uri.getAttribute(n)?.replace(/\s+/g, " ").trim() || undefined;
      links.push({ kind, url, name: attr("name"), label: attr("description") });
    }
    const id = text(rec.getElementsByTagNameNS(NS.dc, "identifier")[0]) ?? String(out.length);
    out.push({
      id,
      title: text(rec.getElementsByTagNameNS(NS.dc, "title")[0]) ?? id,
      abstract: text(rec.getElementsByTagNameNS(NS.dct, "abstract")[0]),
      links: dedupeLinks(links),
    });
  }
  return out;
}

interface RecordsFeature {
  id?: string | number;
  properties?: { title?: string; description?: string } | null;
  links?: Array<{ href?: string; rel?: string; type?: string; title?: string }>;
}

/** an OGC API Records items response → records with classified links */
export function parseRecordsJson(json: unknown): CatalogRecord[] {
  const features = ((json as { features?: RecordsFeature[] })?.features ?? []).filter(Boolean);
  return features.map((f, i) => {
    const links: CatalogLink[] = [];
    let landing: string | undefined;
    for (const l of f.links ?? []) {
      if (!l.href) continue;
      if (l.rel === "self" || l.rel === "alternate") {
        if (!landing && (l.type ?? "").includes("html")) landing = l.href;
        continue;
      }
      const kind = classifyProtocol(`${l.type ?? ""} ${l.title ?? ""} ${l.rel ?? ""}`, l.href);
      if (kind) links.push({ kind, url: l.href, label: l.title });
    }
    const id = f.id !== undefined ? String(f.id) : String(i);
    return {
      id,
      title: f.properties?.title ?? id,
      abstract: f.properties?.description,
      links: dedupeLinks(links),
      ...(landing ? { landing } : {}),
    };
  });
}

export async function searchCatalog(kind: CatalogKind, url: string, query: string): Promise<CatalogRecord[]> {
  if (kind === "csw") {
    const res = await fetch(cleanServiceUrl(url), {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: cswGetRecordsBody(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
    const exception = doc.getElementsByTagNameNS("http://www.opengis.net/ows", "ExceptionText")[0];
    if (exception) throw new Error(exception.textContent?.trim() || "OWS exception");
    return parseCswRecords(doc);
  }
  const res = await fetch(recordsItemsUrl(url, query));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRecordsJson(await res.json());
}

/**
 * A layer from a record link that names what to show. Links without a layer
 * name return null — the caller opens the capabilities picker for them.
 */
export function layerFromLink(record: CatalogRecord, link: CatalogLink): LayerDef | null {
  const common = {
    title: record.title,
    ...(record.landing ? { metadata: { url: record.landing, title: record.title } } : {}),
  };
  if (!link.name) return null;
  switch (link.kind) {
    case "wms":
      return { type: "wms", url: cleanServiceUrl(link.url), layers: link.name, info: {}, ...common };
    case "wmts":
      return { type: "wmts", url: link.url, layer: link.name, ...common };
    case "wfs":
      return { type: "wfs", url: cleanServiceUrl(link.url), typeNames: link.name, ...common };
    case "ogcapi-features":
      return { type: "ogcapi-features", url: link.url, ...common };
  }
}
