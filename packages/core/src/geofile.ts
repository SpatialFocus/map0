/**
 * Local feature files → GeoJSON (F3.2): what a dropped or picked GeoJSON, KML
 * or GPX file becomes before a geojson layer gets it as inline data. Loaded on
 * demand through `loadGeoFile()` — the first file brings this module, and only
 * a KML/GPX file brings @tmcw/togeojson on top of it.
 *
 * Pure functions on strings: the File API stays in the UI, where the files
 * come from, so everything here runs in a unit test.
 */
import type { Feature, FeatureCollection, GeoJSON, Geometry } from "geojson";
import type { SimpleStyle } from "@map0/schema";

export type GeoFileFormat = "geojson" | "kml" | "gpx";

/** the extensions the file picker offers and the drop zone reads without sniffing */
export const GEO_FILE_EXTENSIONS = [".geojson", ".json", ".kml", ".gpx"] as const;

export interface ParseGeoFileOptions {
  /** XML parser for KML/GPX — the browser's DOMParser unless given (tests pass @xmldom/xmldom) */
  parseXml?: (text: string) => Document;
}

const GEOJSON_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

/** the format a file extension promises, or null for anything else */
export function formatFromFileName(name: string): GeoFileFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "kml") return "kml";
  if (ext === "gpx") return "gpx";
  if (ext === "geojson" || ext === "json") return "geojson";
  return null;
}

/**
 * Format by extension, or by looking at the first bytes when the extension
 * says nothing (`.xml`, `.txt`, none at all). Content wins over a lying
 * extension only when the extension is unknown — a `.json` full of XML is an
 * error the user should see, not something to guess around.
 */
export function sniffGeoFormat(name: string, head: string): GeoFileFormat | null {
  const byName = formatFromFileName(name);
  if (byName) return byName;
  const s = head.replace(/^\uFEFF/, "").trimStart();
  if (s.startsWith("{")) return "geojson";
  if (s.startsWith("<")) {
    if (/<kml[\s>]/i.test(s)) return "kml";
    if (/<gpx[\s>]/i.test(s)) return "gpx";
  }
  return null;
}

/** "Radweg Donau.kml" → "Radweg Donau" — what the layer is called */
export function titleFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const stem = base.replace(/\.[a-z0-9]+$/i, "").trim();
  return stem || base;
}

/**
 * Parse a file's text into a FeatureCollection. Throws with a message meant
 * for the user when the text is not a feature file at all.
 */
export async function parseGeoFile(
  name: string,
  text: string,
  opts: ParseGeoFileOptions = {},
): Promise<FeatureCollection> {
  const format = sniffGeoFormat(name, text.slice(0, 4096));
  if (!format) throw new Error(`${name} is not a GeoJSON, KML or GPX file`);
  if (format === "geojson") return parseGeoJsonText(name, text);

  const parseXml =
    opts.parseXml ?? ((xml: string) => new DOMParser().parseFromString(xml, "text/xml"));
  const doc = parseXml(text);
  /* browsers report malformed XML as a document containing <parsererror> */
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`${name} is not well-formed XML`);
  }
  const { kml, gpx } = await import("@tmcw/togeojson");
  const converted = format === "kml" ? kml(doc) : gpx(doc);
  return {
    type: "FeatureCollection",
    /* Placemarks without geometry (folders, network links) convert to
       null-geometry features that nothing can draw */
    features: converted.features.filter((f): f is Feature => f.geometry !== null),
  };
}

function parseGeoJsonText(name: string, text: string): FeatureCollection {
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(`${name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const type = (doc as { type?: unknown } | null)?.type;
  if (typeof doc !== "object" || doc === null || typeof type !== "string" || !GEOJSON_TYPES.has(type)) {
    throw new Error(`${name} is not GeoJSON (no FeatureCollection, Feature or geometry)`);
  }
  return toFeatureCollection(doc as GeoJSON);
}

/**
 * Any GeoJSON object as a FeatureCollection. A legacy `crs` member (GeoJSON
 * 2008, still written by GeoServer and QGIS for projected data) is carried
 * over: the geojson adapter reads it and reprojects the document on load.
 */
export function toFeatureCollection(doc: GeoJSON): FeatureCollection {
  const crs = (doc as { crs?: unknown }).crs;
  const withCrs = <T extends object>(fc: T): T =>
    crs !== undefined && !("crs" in fc) ? { ...fc, crs } : fc;
  if (doc.type === "FeatureCollection") return doc;
  if (doc.type === "Feature") return withCrs({ type: "FeatureCollection", features: [doc] });
  return withCrs({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: doc as Geometry }],
  });
}

/**
 * simplestyle-spec properties (`stroke`, `fill`, `marker-color`, …) are what
 * togeojson makes of KML <Style> elements and what geojson.io writes. When any
 * feature carries them, the layer's style reads them per feature — with the
 * default look as fallback — so a file coloured in Google Earth stays coloured.
 * Returns undefined for files without any, which keeps the default style path
 * (and its legend behaviour) untouched.
 */
export function simpleStyleFor(data: FeatureCollection, accent: string): SimpleStyle | undefined {
  const KEYS = ["stroke", "stroke-width", "stroke-opacity", "fill", "fill-opacity", "marker-color"];
  const styled = data.features.some((f) => {
    const props = f.properties;
    return !!props && KEYS.some((k) => props[k] !== undefined && props[k] !== null);
  });
  if (!styled) return undefined;
  /* a feature without the property yields null and `coalesce` moves on to the
     default — so a file that styles only some features is still fully drawn */
  const prop = (key: string, fallback: unknown): unknown => ["coalesce", ["get", key], fallback];
  return {
    "fill-color": prop("fill", accent),
    "fill-opacity": prop("fill-opacity", 0.25),
    "line-color": prop("stroke", accent),
    "line-width": prop("stroke-width", 2),
    "line-opacity": prop("stroke-opacity", 1),
    "circle-color": prop("marker-color", accent),
    "circle-radius": 5,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
  };
}
