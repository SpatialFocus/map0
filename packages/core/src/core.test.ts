import { describe, expect, it, vi } from "vitest";
import {
  buildGetFeatureInfoUrl,
  buildLegendUrl,
  buildWmsTileUrl,
  normalizeLegendUrl,
  WmsAdapter,
} from "./adapters/wms.js";
import {
  buildCogUrl,
  classColorFunction,
  classLegendEntries,
  cogLegendEntries,
} from "./adapters/cog.js";
import { expandSimpleStyle, GeoJsonAdapter } from "./adapters/geojson.js";
import { featureCollectionFromRows, geoParquetProjector, type GeoMetadata } from "./adapters/geoparquet.js";
import { buildGetFeatureUrl, loadWfsFeatures, parseWfsResponse } from "./adapters/wfs.js";
import { buildItemsUrl, loadOgcApiFeatures, parseItemsResponse } from "./adapters/ogcapi-features.js";
import { deriveFromStyleLayers, entryFromPaint } from "./adapters/legend-derive.js";
import { escapeHtml, renderFields, renderTemplate } from "./template.js";
import { lngLatToMercator } from "./mercator.js";
import { normalizeConfig, type NormalizedLayer } from "@map0/schema";
import { drawOrder, stackOrder } from "./layers.js";
import { claimShareParam } from "./permalink.js";

describe("buildWmsTileUrl", () => {
  it("builds a 1.3.0 GetMap template with literal bbox placeholder", () => {
    const url = buildWmsTileUrl({ url: "https://sdi.example.gv.at/ows", layers: "laerm" });
    expect(url).toContain("SERVICE=WMS");
    expect(url).toContain("REQUEST=GetMap");
    expect(url).toContain("VERSION=1.3.0");
    expect(url).toContain("CRS=EPSG%3A3857");
    expect(url).toContain("TRANSPARENT=TRUE");
    expect(url).toContain("WIDTH=256");
    expect(url.endsWith("&BBOX={bbox-epsg-3857}")).toBe(true);
  });

  it("uses SRS for 1.1.1 and keeps base-url params (MapServer map=)", () => {
    const url = buildWmsTileUrl({
      url: "https://example.org/cgi-bin/mapserv?map=/maps/at.map",
      layers: "a,b",
      version: "1.1.1",
      tileSize: 512,
    });
    expect(url).toContain("map=%2Fmaps%2Fat.map");
    expect(url).toContain("SRS=EPSG%3A3857");
    expect(url).toContain("WIDTH=512");
    expect(url).not.toContain("CRS=");
  });
});

describe("buildGetFeatureInfoUrl", () => {
  const def = { url: "https://sdi.example.gv.at/ows", layers: "laerm" };
  it("builds a 1.3.0 GFI request with I/J", () => {
    const url = buildGetFeatureInfoUrl(def, {
      bbox3857: [1, 2, 3, 4],
      size: 101,
      i: 50,
      j: 50,
      infoFormat: "application/json",
    });
    expect(url).toContain("REQUEST=GetFeatureInfo");
    expect(url).toContain("QUERY_LAYERS=laerm");
    expect(url).toContain("BBOX=1%2C2%2C3%2C4");
    expect(url).toContain("I=50");
    expect(url).toContain("J=50");
    expect(url).toContain("INFO_FORMAT=application%2Fjson");
  });

  it("uses X/Y for 1.1.1", () => {
    const url = buildGetFeatureInfoUrl(
      { ...def, version: "1.1.1" },
      { bbox3857: [1, 2, 3, 4], size: 101, i: 50, j: 50, infoFormat: "text/html" },
    );
    expect(url).toContain("X=50");
    expect(url).toContain("Y=50");
    expect(url).not.toContain("I=50");
  });
});

describe("expandSimpleStyle", () => {
  it("splits flat keys by prefix", () => {
    const s = expandSimpleStyle(
      { "circle-color": "#f00", "circle-radius": 4, "line-width": 3 },
      "#0e7490",
    );
    expect(s.circle).toEqual({ "circle-color": "#f00", "circle-radius": 4 });
    expect(s.line).toEqual({ "line-width": 3 });
    expect(s.fill).toBeUndefined();
  });

  it("falls back to accent defaults when empty", () => {
    const s = expandSimpleStyle(undefined, "#123456");
    expect(s.fill?.["fill-color"]).toBe("#123456");
    expect(s.line?.["line-color"]).toBe("#123456");
    expect(s.circle?.["circle-color"]).toBe("#123456");
  });
});

describe("cog", () => {
  it("builds a plain cog:// URL for imagery", () => {
    expect(buildCogUrl("https://example.org/ortho.tif")).toBe("cog://https://example.org/ortho.tif");
  });

  it("builds the #color fragment with modifiers", () => {
    expect(
      buildCogUrl("https://example.org/dem.tif", {
        color: { scheme: "BrewerSpectral7", min: 1.7, max: 1.8, continuous: true, reverse: true },
      }),
    ).toBe("cog://https://example.org/dem.tif#color:BrewerSpectral7,1.7,1.8,c-");
    expect(
      buildCogUrl("https://example.org/dem.tif", {
        color: { scheme: "CartoEarth", min: 0, max: 100 },
      }),
    ).toBe("cog://https://example.org/dem.tif#color:CartoEarth,0,100");
  });

  it("builds the #dem fragment for hillshade", () => {
    expect(buildCogUrl("https://example.org/dgm.tif", { dem: true })).toBe(
      "cog://https://example.org/dgm.tif#dem",
    );
  });

  it("derives one legend entry per discrete class, with value ranges", () => {
    /* a 4-class threshold scale over [0, 100], like the protocol's colorScale */
    const palette: Array<[number, number, number]> = [
      [0, 0, 0],
      [80, 80, 80],
      [160, 160, 160],
      [240, 240, 240],
    ];
    const scale = (v: number) => palette[Math.min(3, Math.max(0, Math.floor((v / 100) * 4)))];
    const entries = cogLegendEntries(scale, { min: 0, max: 100, continuous: false });
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({ label: "0 – 25", color: "rgb(0, 0, 0)", shape: "square" });
    expect(entries[3]!.label).toBe("75 – 100");
    expect(entries[3]!.color).toBe("rgb(240, 240, 240)");
  });

  it("samples a continuous ramp with labelled stops", () => {
    const scale = (v: number) => [Math.round(v * 255), 0, 0];
    const entries = cogLegendEntries(scale, { min: 0, max: 1, continuous: true });
    expect(entries).toHaveLength(5);
    expect(entries[0]!.label).toBe("0.00");
    expect(entries[4]!.label).toBe("1.00");
    expect(entries[4]!.color).toBe("rgb(255, 0, 0)");
  });

  it("returns no legend for a degenerate range", () => {
    expect(cogLegendEntries(() => [0, 0, 0], { min: 5, max: 5 })).toEqual([]);
  });

  /* run the per-pixel function the way the protocol does: one pixel at a time */
  const paint = (
    fn: ReturnType<typeof classColorFunction>,
    value: number,
    metadata: { offset: number; scale: number; noData?: number },
  ): number[] => {
    const rgba = new Uint8ClampedArray(4);
    fn(new Float64Array([value]), rgba, { ...metadata, images: [] });
    return [...rgba];
  };
  const identity = { offset: 0, scale: 1 };

  it("classes: colors exact values, leaves everything else transparent", () => {
    const fn = classColorFunction([
      { value: 0, color: "#67a9cf" },
      { value: 1, color: "#ef8a62" },
    ]);
    expect(paint(fn, 0, identity)).toEqual([0x67, 0xa9, 0xcf, 255]);
    expect(paint(fn, 1, identity)).toEqual([0xef, 0x8a, 0x62, 255]);
    expect(paint(fn, 2, identity)).toEqual([0, 0, 0, 0]);
    expect(paint(fn, 0.5, identity)).toEqual([0, 0, 0, 0]);
  });

  it("classes: ranges are [from, to) and the highest to is inclusive", () => {
    const fn = classColorFunction([
      { from: 0, to: 10, color: "#111" },
      { from: 10, to: 20, color: "#222" },
    ]);
    expect(paint(fn, 0, identity)).toEqual([0x11, 0x11, 0x11, 255]);
    expect(paint(fn, 9.99, identity)).toEqual([0x11, 0x11, 0x11, 255]);
    expect(paint(fn, 10, identity)).toEqual([0x22, 0x22, 0x22, 255]); // boundary → upper class
    expect(paint(fn, 20, identity)).toEqual([0x22, 0x22, 0x22, 255]); // data maximum stays styled
    expect(paint(fn, 20.01, identity)).toEqual([0, 0, 0, 0]);
    expect(paint(fn, -1, identity)).toEqual([0, 0, 0, 0]);
  });

  it("classes: exact values win over ranges; gaps stay transparent", () => {
    const fn = classColorFunction([
      { from: 0, to: 10, color: "#111" },
      { value: 5, color: "#fff" },
      { from: 20, to: 30, color: "#333" },
    ]);
    expect(paint(fn, 5, identity)).toEqual([255, 255, 255, 255]);
    expect(paint(fn, 15, identity)).toEqual([0, 0, 0, 0]); // gap between ranges
  });

  it("classes: noData, NaN and fill pixels are transparent; scale/offset apply", () => {
    const fn = classColorFunction([{ value: 0.03, color: "#ff0000cc" }]);
    /* raw 3 with scale 0.01 → 0.03 despite float rounding; alpha from #…cc */
    expect(paint(fn, 3, { offset: 0, scale: 0.01 })).toEqual([255, 0, 0, 0xcc]);
    expect(paint(fn, 255, { ...identity, noData: 255 })).toEqual([0, 0, 0, 0]);
    expect(paint(fn, NaN, identity)).toEqual([0, 0, 0, 0]);
    expect(paint(fn, Infinity, identity)).toEqual([0, 0, 0, 0]);
  });

  it("classes: derives one legend entry per class, labels defaulting to the values", () => {
    expect(
      classLegendEntries([
        { value: 1, color: "#ef8a62", label: "versiegelt" },
        { value: 0, color: "#67a9cf" },
        { from: 2, to: 5, color: "#999999" },
      ]),
    ).toEqual([
      { label: "versiegelt", color: "#ef8a62", shape: "square" },
      { label: "0", color: "#67a9cf", shape: "square" },
      { label: "2 – 5", color: "#999999", shape: "square" },
    ]);
  });
});

describe("wfs", () => {
  const def = { url: "https://data.wien.gv.at/daten/geo", typeNames: "ogdwien:TRINKBRUNNENOGD" };

  it.each(["1.1.0", "2.0.0"] as const)("replaces pasted operation params for WFS %s", (version) => {
    const url = new URL(buildGetFeatureUrl({
      ...def,
      version,
      url: "https://example.org/wfs?service=WFS&Request=GetCapabilities&REQUEST=DescribeFeatureType" +
        "&version=1.0.0&typeName=old&typeNames=older&count=2&maxFeatures=3&startIndex=50" +
        "&srsName=EPSG:3857&outputFormat=GML&map=/maps/at.map&api_key=abc",
    }, { count: 100 }));
    const entries = [...url.searchParams].map(([key, value]) => [key.toUpperCase(), value]);
    expect(entries.filter(([key]) => key === "REQUEST")).toEqual([["REQUEST", "GetFeature"]]);
    expect(entries.filter(([key]) => key === "VERSION")).toEqual([["VERSION", version]]);
    expect(url.searchParams.get("map")).toBe("/maps/at.map");
    expect(url.searchParams.get("api_key")).toBe("abc");
    expect(url.searchParams.get("SRSNAME")).toBe("EPSG:4326");
    expect(url.searchParams.get("OUTPUTFORMAT")).toBe("application/json");
    expect(url.searchParams.has("STARTINDEX")).toBe(false);
    const names = entries.map(([key]) => key);
    expect(new Set(names).size).toBe(names.length);
    expect(url.searchParams.get(version === "2.0.0" ? "COUNT" : "MAXFEATURES")).toBe("100");
    expect(names).not.toContain(version === "2.0.0" ? "MAXFEATURES" : "COUNT");
    expect(names).not.toContain(version === "2.0.0" ? "TYPENAME" : "TYPENAMES");
  });

  it("applies explicit parameters last regardless of their casing", () => {
    const url = new URL(buildGetFeatureUrl({
      ...def,
      url: `${def.url}?CQL_FILTER=old&api_key=abc`,
      params: { srsName: "urn:ogc:def:crs:EPSG::4326", outputFormat: "geojson", cql_filter: "BEZIRK=9" },
    }, { count: 10, startIndex: 20 }));
    const entries = [...url.searchParams].map(([key, value]) => [key.toUpperCase(), value]);
    expect(entries.filter(([key]) => key === "SRSNAME")).toEqual([["SRSNAME", "urn:ogc:def:crs:EPSG::4326"]]);
    expect(entries.filter(([key]) => key === "OUTPUTFORMAT")).toEqual([["OUTPUTFORMAT", "geojson"]]);
    expect(entries.filter(([key]) => key === "CQL_FILTER")).toEqual([["CQL_FILTER", "BEZIRK=9"]]);
    expect(url.searchParams.get("STARTINDEX")).toBe("20");
    expect(url.searchParams.get("api_key")).toBe("abc");
  });

  it("builds a 2.0.0 GetFeature URL with paging and WGS84 GeoJSON output", () => {
    const url = buildGetFeatureUrl(def, { count: 5000, startIndex: 5000 });
    expect(url).toContain("SERVICE=WFS");
    expect(url).toContain("VERSION=2.0.0");
    expect(url).toContain("REQUEST=GetFeature");
    expect(url).toContain("TYPENAMES=ogdwien%3ATRINKBRUNNENOGD");
    expect(url).toContain("SRSNAME=EPSG%3A4326");
    expect(url).toContain("OUTPUTFORMAT=application%2Fjson");
    expect(url).toContain("COUNT=5000");
    expect(url).toContain("STARTINDEX=5000");
  });

  it("uses 1.1.0 parameter names, keeps base-url params, lets vendor params override", () => {
    const url = buildGetFeatureUrl(
      {
        url: "https://example.org/cgi-bin/mapserv?map=/maps/at.map",
        typeNames: "trees",
        version: "1.1.0",
        outputFormat: "geojson",
        params: { CQL_FILTER: "BEZIRK=9", SRSNAME: "urn:ogc:def:crs:EPSG::4326" },
      },
      { count: 100 },
    );
    expect(url).toContain("map=%2Fmaps%2Fat.map");
    expect(url).toContain("TYPENAME=trees");
    expect(url).not.toContain("TYPENAMES=");
    expect(url).toContain("MAXFEATURES=100");
    expect(url).not.toContain("STARTINDEX=");
    expect(url).toContain("OUTPUTFORMAT=geojson");
    expect(url).toContain("CQL_FILTER=BEZIRK%3D9");
    expect(url).toContain("SRSNAME=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A4326");
  });

  it("unwraps OWS exception XML into its message (a WFS reports errors with HTTP 200)", () => {
    const xml =
      '<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"><ows:Exception>' +
      "<ows:ExceptionText>Unknown type name: ogdwien:TYPO</ows:ExceptionText>" +
      "</ows:Exception></ows:ExceptionReport>";
    expect(() => parseWfsResponse(xml, "https://e.org/wfs")).toThrow(/Unknown type name/);
    expect(() => parseWfsResponse("<html>not a wfs</html>", "https://e.org/wfs")).toThrow(/outputFormat/);
    expect(() => parseWfsResponse('{"no":"features"}', "https://e.org/wfs")).toThrow(/"features" array/);
  });

  const feature = (id: number): Record<string, unknown> => ({
    type: "Feature",
    id: `f.${id}`,
    properties: { n: id },
    geometry: { type: "Point", coordinates: [16, 48] },
  });
  const page = (from: number, n: number, matched?: number): string =>
    JSON.stringify({
      type: "FeatureCollection",
      numberMatched: matched,
      features: Array.from({ length: n }, (_, i) => feature(from + i)),
    });

  it("pages with startIndex until the reported total is reached", async () => {
    const urls: string[] = [];
    const fc = await loadWfsFeatures({ ...def, pageSize: 2, limit: 100 }, async (url) => {
      urls.push(url);
      const start = Number(/STARTINDEX=(\d+)/.exec(url)?.[1] ?? 0);
      return page(start, Math.min(2, 5 - start), 5);
    });
    expect(fc.features).toHaveLength(5);
    expect(fc.features.map((f) => f.id)).toEqual(["f.0", "f.1", "f.2", "f.3", "f.4"]);
    expect(urls).toHaveLength(3);
    expect(urls[0]).not.toContain("STARTINDEX=");
  });

  it("continues after a silently capped page when the server names a total", async () => {
    /* asked for 4 per page, server caps at 2 — numberMatched keeps the loop going */
    const fc = await loadWfsFeatures({ ...def, pageSize: 4, limit: 100 }, async (url) => {
      const start = Number(/STARTINDEX=(\d+)/.exec(url)?.[1] ?? 0);
      return page(start, Math.min(2, 6 - start), 6);
    });
    expect(fc.features).toHaveLength(6);
  });

  it("stops at the limit and passes a shrunken count to the last page", async () => {
    const counts: number[] = [];
    const fc = await loadWfsFeatures({ ...def, pageSize: 2, limit: 3 }, async (url) => {
      counts.push(Number(/COUNT=(\d+)/.exec(url)?.[1]));
      const start = Number(/STARTINDEX=(\d+)/.exec(url)?.[1] ?? 0);
      return page(start, Number(/COUNT=(\d+)/.exec(url)?.[1]), 100);
    });
    expect(fc.features).toHaveLength(3);
    expect(counts).toEqual([2, 1]);
  });

  it("does not loop on a server that ignores STARTINDEX", async () => {
    let calls = 0;
    const fc = await loadWfsFeatures({ ...def, pageSize: 2, limit: 100 }, async () => {
      calls++;
      return page(0, 2, 10); // same first page forever
    });
    expect(calls).toBe(2); // second identical page is detected, loop ends
    expect(fc.features).toHaveLength(2);
  });

  it("1.1.0: one maxFeatures request, no paging", async () => {
    const urls: string[] = [];
    const fc = await loadWfsFeatures({ ...def, version: "1.1.0", limit: 3 }, async (url) => {
      urls.push(url);
      return page(0, 3);
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("MAXFEATURES=3");
    expect(fc.features).toHaveLength(3);
  });
});

describe("ogcapi-features", () => {
  const def = { url: "https://demo.ldproxy.net/zoomstack/collections/railway_stations" };

  it.each(["", "/", "/items", "/items/"])("preserves query and fragment with path suffix %j", (suffix) => {
    const url = new URL(buildItemsUrl({
      url: `${def.url}${suffix}?api_key=abc%2F123&bbox=1,2,3,4#details`,
      params: { datetime: "2026-01-01/2026-02-01" },
    }, 100));
    expect(url.pathname).toBe("/zoomstack/collections/railway_stations/items");
    expect(url.searchParams.get("api_key")).toBe("abc/123");
    expect(url.searchParams.get("bbox")).toBe("1,2,3,4");
    expect(url.searchParams.get("datetime")).toBe("2026-01-01/2026-02-01");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.hash).toBe("#details");
  });

  it("appends items to a relative collection URL before its query", () => {
    const url = new URL(buildItemsUrl({ url: "/collections/trees?api_key=abc" }, 10));
    expect(url.pathname).toBe("/collections/trees/items");
    expect(url.searchParams.get("api_key")).toBe("abc");
  });

  it("builds the items URL from a collection URL, params merged last", () => {
    expect(buildItemsUrl(def, 1000)).toBe(
      "https://demo.ldproxy.net/zoomstack/collections/railway_stations/items?f=json&limit=1000",
    );
    /* "/items" already present (with or without query) stays untouched */
    expect(buildItemsUrl({ url: `${def.url}/items` }, 5)).toContain("/items?f=json&limit=5");
    expect(
      buildItemsUrl({ url: def.url, params: { bbox: "-5,50,2,56", f: "geojson" } }, 10),
    ).toContain("f=geojson");
  });

  it("surfaces problem details and non-JSON answers as friendly errors", () => {
    expect(() =>
      parseItemsResponse('{"title":"Not Found","description":"no such collection"}', "https://e.org/x/items"),
    ).toThrow(/Not Found — no such collection/);
    expect(() => parseItemsResponse("<html>landing page</html>", "https://e.org/x/items")).toThrow(
      /collections\{?/,
    );
  });

  const page = (from: number, n: number, next?: string): string =>
    JSON.stringify({
      type: "FeatureCollection",
      features: Array.from({ length: n }, (_, i) => ({
        type: "Feature",
        id: from + i,
        properties: {},
        geometry: { type: "Point", coordinates: [0, 0] },
      })),
      links: next ? [{ href: next, rel: "next", type: "application/geo+json" }] : [],
    });

  it("follows next links (relative ones resolved) until the last page", async () => {
    const urls: string[] = [];
    const fc = await loadOgcApiFeatures({ ...def, pageSize: 2 }, async (url) => {
      urls.push(url);
      const start = Number(new URL(url).searchParams.get("offset") ?? 0);
      const nextStart = start + 2;
      return page(start, Math.min(2, 5 - start), nextStart < 5 ? `items?f=json&limit=2&offset=${nextStart}` : undefined);
    });
    expect(fc.features).toHaveLength(5);
    expect(urls).toHaveLength(3);
    expect(urls[1]).toContain("offset=2"); // relative next href resolved against the page URL
  });

  it("stops at the limit even while the server keeps offering next pages", async () => {
    let calls = 0;
    const fc = await loadOgcApiFeatures({ ...def, pageSize: 2, limit: 3 }, async (url) => {
      calls++;
      const start = Number(new URL(url).searchParams.get("offset") ?? 0);
      return page(start, 2, `${def.url}/items?f=json&limit=2&offset=${start + 2}`);
    });
    expect(fc.features).toHaveLength(3);
    expect(calls).toBe(2);
  });

  it("does not loop when a next link points back at a visited page", async () => {
    let calls = 0;
    const fc = await loadOgcApiFeatures({ ...def, pageSize: 2 }, async (url) => {
      calls++;
      return page(0, 2, url); // broken server: next = self
    });
    expect(calls).toBe(1);
    expect(fc.features).toHaveLength(2);
  });
});

/** PROJJSON of WGS 84 / UTM zone 33N as GDAL writes it — without the id block */
const UTM_33N_PROJJSON = {
  type: "ProjectedCRS",
  name: "WGS 84 / UTM zone 33N",
  base_crs: {
    type: "GeographicCRS",
    name: "WGS 84",
    datum: {
      type: "GeodeticReferenceFrame",
      name: "World Geodetic System 1984",
      ellipsoid: { name: "WGS 84", semi_major_axis: 6378137, inverse_flattening: 298.257223563 },
    },
    coordinate_system: {
      subtype: "ellipsoidal",
      axis: [
        { name: "Geodetic latitude", abbreviation: "Lat", direction: "north", unit: "degree" },
        { name: "Geodetic longitude", abbreviation: "Lon", direction: "east", unit: "degree" },
      ],
    },
  },
  conversion: {
    name: "UTM zone 33N",
    method: { name: "Transverse Mercator", id: { authority: "EPSG", code: 9807 } },
    parameters: [
      { name: "Latitude of natural origin", value: 0, unit: "degree" },
      { name: "Longitude of natural origin", value: 15, unit: "degree" },
      { name: "Scale factor at natural origin", value: 0.9996, unit: "unity" },
      { name: "False easting", value: 500000, unit: "metre" },
      { name: "False northing", value: 0, unit: "metre" },
    ],
  },
  coordinate_system: {
    subtype: "Cartesian",
    axis: [
      { name: "Easting", abbreviation: "E", direction: "east", unit: "metre" },
      { name: "Northing", abbreviation: "N", direction: "north", unit: "metre" },
    ],
  },
} as unknown as NonNullable<NonNullable<GeoMetadata["columns"]>[string]["crs"]>;

describe("geoparquet", () => {
  const geo: GeoMetadata = { primary_column: "geom", columns: { geom: {} } };

  it("preserves int64 and uint64 values without losing precision or merging adjacent IDs", () => {
    const ids = [9007199254740992n, 9007199254740993n, -9007199254740993n,
      -9223372036854775808n, 9223372036854775807n, 18446744073709551615n];
    const fc = featureCollectionFromRows(ids.map(id => ({ geom: null, id })), geo);
    const decoded = JSON.parse(JSON.stringify(fc));
    expect(decoded.features.map((f: { properties: { id: string } }) => f.properties.id))
      .toEqual(ids.map(String));
  });

  it("keeps safe BigInts numeric, including both safe-integer boundaries", () => {
    const values = [0n, 42n, -42n, 9007199254740991n, -9007199254740991n];
    const fc = featureCollectionFromRows(values.map(value => ({ geom: null, value })), geo);
    expect(fc.features.map(f => f.properties?.value)).toEqual(values.map(Number));
  });

  it("turns rows into features, geometry column split from properties", () => {
    const fc = featureCollectionFromRows(
      [
        { name: "A", count: 3n, geom: { type: "Point", coordinates: [16.37, 48.21] } },
        { name: "B", count: 4n, geom: null },
      ],
      geo,
    );
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]?.geometry).toEqual({ type: "Point", coordinates: [16.37, 48.21] });
    /* BigInt is downcast: JSON.stringify (popup de-dup, share state) throws on it */
    expect(fc.features[0]?.properties).toEqual({ name: "A", count: 3 });
    expect(fc.features[1]?.geometry).toBeNull();
    expect(() => JSON.stringify(fc)).not.toThrow();
  });

  it("drops non-primary geometry columns from the properties", () => {
    const fc = featureCollectionFromRows(
      [{ name: "A", geom: { type: "Point", coordinates: [1, 2] }, centroid: { type: "Point", coordinates: [1, 2] } }],
      { primary_column: "geom", columns: { geom: {}, centroid: {} } },
    );
    expect(fc.features[0]?.properties).toEqual({ name: "A" });
  });

  it("needs no projector for WGS84 in its spellings", async () => {
    expect(await geoParquetProjector("geom", geo)).toBeNull(); // no crs = OGC:CRS84 per spec
    expect(
      await geoParquetProjector("geom", { columns: { geom: { crs: { id: { authority: "OGC", code: "CRS84" } } } } }),
    ).toBeNull();
    expect(
      await geoParquetProjector("geom", { columns: { geom: { crs: { id: { authority: "EPSG", code: 4326 } } } } }),
    ).toBeNull();
    expect(await geoParquetProjector("geom", { columns: { geom: { crs: { name: "WGS 84" } } } })).toBeNull();
  });

  it("reprojects a registry CRS named by the metadata, and a nameless one from its PROJJSON", async () => {
    const gk = await geoParquetProjector("geom", {
      columns: { geom: { crs: { name: "MGI / Austria GK East", id: { authority: "EPSG", code: 31256 } } } },
    });
    expect(gk).toBeTypeOf("function");
    const [lng, lat] = gk!([2500, 341000]);
    expect(lng).toBeCloseTo(16.3658, 3);
    expect(lat).toBeCloseTo(48.2074, 3);

    /* no id at all: only the PROJJSON body says what this is — and "WGS 84 / UTM"
       in the name must not pass as plain WGS84 */
    const utm = await geoParquetProjector("geom", { columns: { geom: { crs: UTM_33N_PROJJSON } } });
    expect(utm).toBeTypeOf("function");
    const [ulng, ulat] = utm!([602000, 5340000]);
    expect(ulng).toBeCloseTo(16.3728, 3);
    expect(ulat).toBeCloseTo(48.205, 3);

    /* config wins over the metadata */
    const forced = await geoParquetProjector("geom", { columns: { geom: { crs: UTM_33N_PROJJSON } } }, "EPSG:31256");
    expect(forced!([2500, 341000])[0]).toBeCloseTo(16.3658, 3);
    expect(await geoParquetProjector("geom", { columns: { geom: { crs: UTM_33N_PROJJSON } } }, "EPSG:4326")).toBeNull();
  });

  it("names a CRS nobody can resolve, and the config key that fixes it", async () => {
    await expect(
      geoParquetProjector("geom", {
        columns: { geom: { crs: { name: "Nowhere Grid", id: { authority: "EPSG", code: 99999 } } } },
      }),
    ).rejects.toThrow(/Nowhere Grid.*"crs".*EPSG:99999/);
  });

  /* the shipped demo file, read through the real decoder (node path of hyparquet) */
  it("decodes the demo file: geometry as GeoJSON, geo metadata with bbox", async () => {
    const { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } = await import("hyparquet");
    const { compressors } = await import("hyparquet-compressors");
    const path = new URL("../../../site/public/data/vienna-trees-1010.parquet", import.meta.url);
    const file = await asyncBufferFromFile(path.pathname.replace(/^\/(?=[a-z]:)/i, ""));
    const metadata = await parquetMetadataAsync(file);
    const kv = metadata.key_value_metadata?.find((e) => e.key === "geo");
    expect(kv?.value).toBeTruthy();
    const parsed = JSON.parse(kv!.value!) as GeoMetadata;
    expect(parsed.primary_column).toBe("geom");
    expect(parsed.columns?.geom?.bbox).toHaveLength(4);
    const rows = (await parquetReadObjects({ file, metadata, compressors })) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(4000);
    const fc = featureCollectionFromRows(rows, parsed);
    expect(fc.features[0]?.geometry?.type).toBe("Point");
    expect(typeof fc.features[0]?.properties?.GATTUNG_ART).toBe("string");
    expect(fc.features[0]?.properties).not.toHaveProperty("geom");
  });
});

describe("templates", () => {
  it("escapes property values", () => {
    expect(renderTemplate("<b>{{name}}</b>", { name: '<script>alert("x")</script>' })).toBe(
      "<b>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</b>",
    );
  });

  it("renders missing keys as empty string", () => {
    expect(renderTemplate("a{{missing}}b", {})).toBe("ab");
  });

  it("renders field tables with labels", () => {
    const html = renderFields([{ key: "hoehe_m", label: "Höhe" }], { hoehe_m: 12 });
    expect(html).toContain("<th scope=\"row\">Höhe</th>");
    expect(html).toContain("<td>12</td>");
  });

  it("escapeHtml covers quotes and ampersands", () => {
    expect(escapeHtml(`a&"'<>`)).toBe("a&amp;&quot;&#39;&lt;&gt;");
  });
});

describe("legend", () => {
  const wmsDef = {
    type: "wms",
    id: "x",
    title: "X",
    visible: true,
    opacity: 1,
    groupPath: [],
    url: "https://sdi.example.gv.at/ows",
    layers: "laerm",
  } as never;

  it("WMS auto-legend builds a GetLegendGraphic URL", () => {
    const spec = new WmsAdapter(wmsDef).legend();
    expect(spec?.kind).toBe("image");
    if (spec?.kind === "image") {
      expect(spec.url).toContain("REQUEST=GetLegendGraphic");
      expect(spec.url).toContain("LAYER=laerm");
      /* our standard sizing: 20px icons (GeoServer reads WIDTH/HEIGHT per icon)
         plus font/dpi options for a crisp downscale in the panel */
      expect(spec.url).toContain("WIDTH=20");
      expect(spec.url).toContain("HEIGHT=20");
      expect(spec.url).toContain("fontSize%3A12");
      expect(spec.url).toContain("dpi%3A120");
      expect(spec.url).toBe(buildLegendUrl({ url: "https://sdi.example.gv.at/ows", layers: "laerm" }));
    }
  });

  it("normalizeLegendUrl replaces baked-in width/height with the standard sizing", () => {
    /* real shape of a GeoServer capabilities LegendURL: the advertised numbers
       are the TOTAL image size, but replayed as request params they become the
       per-icon size and the image explodes (282x120 advertised → 544x720 served) */
    const advertised =
      "https://geo.example.at/geoserver/ows?service=WMS&request=GetLegendGraphic" +
      "&format=image%2Fpng&width=282&height=120&layer=oerok%3Afi_ogd_2025_v25";
    const out = normalizeLegendUrl(advertised);
    expect(out).toContain("width=20");
    expect(out).toContain("height=20");
    expect(out).not.toContain("width=282");
    expect(out).not.toContain("height=120");
    expect(out).toContain("legend_options=forceLabels%3Aon");
    expect(out).toContain("dpi%3A120");
    /* untouched: everything that identifies the legend */
    expect(out).toContain("layer=oerok%3Afi_ogd_2025_v25");
    expect(out).toContain("format=image%2Fpng");
  });

  it("normalizeLegendUrl leaves non-GetLegendGraphic and unparseable URLs alone", () => {
    const png = "https://e.org/static/legend.png";
    expect(normalizeLegendUrl(png)).toBe(png);
    const getmap = "https://e.org/ows?request=GetMap&width=256&height=256";
    expect(normalizeLegendUrl(getmap)).toBe(getmap);
    expect(normalizeLegendUrl("not a url")).toBe("not a url");
  });

  it("legend: false suppresses, string overrides, entries pass through", () => {
    const off = new WmsAdapter({ ...wmsDef, legend: false } as never).legend();
    expect(off).toBeNull();
    const img = new WmsAdapter({ ...wmsDef, legend: "https://e.org/l.png" } as never).legend();
    expect(img).toEqual({ kind: "image", url: "https://e.org/l.png" });
    const entries = new WmsAdapter({
      ...wmsDef,
      legend: [{ label: "A", color: "#f00" }],
    } as never).legend();
    expect(entries).toEqual({
      kind: "entries",
      entries: [{ label: "A", color: "#f00", image: undefined, shape: "square" }],
    });
  });

  it("does not invent swatches for a defaulted style", async () => {
    const { GeoJsonAdapter } = await import("./adapters/geojson.js");
    /* no `style` key → fill/line/circle are rendered speculatively (the geometry is
       unknown until the data arrives), so there is nothing honest to summarise */
    const adapter = new GeoJsonAdapter({
      type: "geojson",
      id: "g",
      title: "G",
      visible: true,
      opacity: 1,
      groupPath: [],
      data: "https://e.org/x.geojson",
    } as never);
    expect(adapter.legend()).toBeNull();
  });

  it("derives swatches only from literal colors", () => {
    expect(entryFromPaint("fill", { "fill-color": "#0f0" })).toEqual({
      color: "#0f0",
      shape: "square",
    });
    expect(entryFromPaint("fill", { "fill-color": ["get", "farbe"] })).toBeNull();
    expect(entryFromPaint("symbol", { "text-color": "#000" })).toBeNull();
    const derived = deriveFromStyleLayers([
      { type: "fill", paint: { "fill-color": "#aaa" } },
      { type: "line", paint: { "line-color": "#bbb" } },
      { type: "circle", paint: {} },
    ] as never);
    expect(derived).toEqual([
      { color: "#aaa", shape: "square" },
      { color: "#bbb", shape: "line" },
    ]);
  });
});

describe("permalink", () => {
  it("round-trips share state through base64url", async () => {
    const { encodeShareState, decodeShareState } = await import("./permalink.js");
    const state = {
      v: [16.3725, 48.2083, 13.5],
      b: "ortho",
      l: { widmung: [0, 55] as [number, number] },
      u: [{ type: "wms", url: "https://e.org/ows", layers: "x", title: "Ä layer" }],
    };
    const encoded = encodeShareState(state as never);
    expect(encoded).not.toMatch(/[+/=]/); // url-safe
    expect(decodeShareState(encoded)).toEqual(state);
  });

  it("rejects garbage", async () => {
    const { decodeShareState } = await import("./permalink.js");
    expect(decodeShareState("nicht-base64!!")).toBeNull();
    expect(decodeShareState(btoa('{"x":1}'))).toBeNull();
  });

  it("reads and writes the hash param without clobbering other hash content", async () => {
    const { readShareParam, writeShareParam } = await import("./permalink.js");
    expect(readShareParam("#map0=abc", "map0")).toBe("abc");
    expect(readShareParam("#route=/x&map0=abc", "map0")).toBe("abc");
    expect(readShareParam("#route=/x", "map0")).toBeNull();
    expect(writeShareParam("", "map0", "xyz")).toBe("#map0=xyz");
    expect(writeShareParam("#route=/x&map0=old", "map0", "new")).toBe("#route=/x&map0=new");
  });
});

describe("print layout", () => {
  it("converts paper millimetres to pixels at a resolution", async () => {
    const { mmToPx, PAPER } = await import("./print.js");
    expect(mmToPx(210)).toBe(794); // A4 width at 96 dpi
    expect(mmToPx(297)).toBe(1123);
    expect(mmToPx(210, 300)).toBe(2480); // and at print resolution
    expect(PAPER["A4-landscape"]).toEqual([297, 210]);
  });

  it("fits a sheet inside the page margins, centred, keeping its aspect", async () => {
    const { fitOnPage } = await import("./print.js");
    /* a sheet taller than A4 landscape must be limited by height, not width */
    const tall = fitOnPage({ width: 1123, height: 950 }, { width: 297, height: 210 }, 10);
    expect(tall.height).toBeCloseTo(190, 5);
    expect(tall.width / tall.height).toBeCloseTo(1123 / 950, 5);
    expect(tall.y).toBeCloseTo(10, 5);
    expect(tall.x).toBeGreaterThan(10); // centred horizontally in the leftover space

    /* a wide sheet is limited by width instead */
    const wide = fitOnPage({ width: 2000, height: 500 }, { width: 297, height: 210 }, 10);
    expect(wide.width).toBeCloseTo(277, 5);
    expect(wide.x).toBeCloseTo(10, 5);
    expect(wide.y).toBeGreaterThan(10);

    /* no margin means the image fills the page exactly */
    const full = fitOnPage({ width: 100, height: 50 }, { width: 200, height: 100 }, 0);
    expect(full).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
});

describe("geodesy", () => {
  it("measures known distances within 0.5 %", async () => {
    const { haversine, lineLength } = await import("./geodesy.js");
    /* Vienna Stephansdom → Salzburg Dom, ~252 km */
    const vienna: [number, number] = [16.3731, 48.2085];
    const salzburg: [number, number] = [13.0466, 47.7979];
    const d = haversine(vienna, salzburg);
    expect(d).toBeGreaterThan(250_000);
    expect(d).toBeLessThan(255_000);
    /* one degree of latitude is ~111.2 km anywhere */
    expect(haversine([16, 48], [16, 49])).toBeCloseTo(111_195, -2);
    /* a line is the sum of its segments */
    expect(lineLength([vienna, salzburg, vienna])).toBeCloseTo(2 * d, 5);
    expect(lineLength([vienna])).toBe(0);
  });

  it("is not fooled by Web Mercator distortion", async () => {
    const { haversine } = await import("./geodesy.js");
    /* the same one-degree span in longitude shrinks with latitude — planar
       pixel maths would report both as equal */
    const equator = haversine([0, 0], [1, 0]);
    const vienna = haversine([16, 48.2], [17, 48.2]);
    expect(vienna / equator).toBeCloseTo(Math.cos(48.2 * (Math.PI / 180)), 2);
  });

  it("measures areas with the spherical excess formula", async () => {
    const { ringArea } = await import("./geodesy.js");
    /* 0.1° × 0.1° box at 48°N ≈ 11.1 km × 7.4 km ≈ 82.5 km² */
    const box = ringArea([
      [16.0, 48.0],
      [16.1, 48.0],
      [16.1, 48.1],
      [16.0, 48.1],
    ]);
    expect(box / 1e6).toBeGreaterThan(80);
    expect(box / 1e6).toBeLessThan(85);
    /* winding order must not matter, degenerate rings are zero */
    const reversed = ringArea([
      [16.0, 48.1],
      [16.1, 48.1],
      [16.1, 48.0],
      [16.0, 48.0],
    ]);
    expect(reversed).toBeCloseTo(box, 0);
    expect(ringArea([[16, 48], [16.1, 48]])).toBe(0);
  });

  it("formats with the unit the magnitude deserves", async () => {
    const { formatLength, formatArea } = await import("./geodesy.js");
    expect(formatLength(845)).toBe("845 m");
    expect(formatLength(4.2)).toBe("4.2 m");
    expect(formatLength(12_400)).toBe("12.4 km");
    expect(formatArea(640)).toBe("640 m²");
    expect(formatArea(32_000)).toBe("3.20 ha");
    expect(formatArea(18_500_000)).toBe("18.50 km²");
    expect(formatLength(12_400, "de")).toBe("12,4 km"); // locale decimals
  });
});

describe("search", () => {
  const base = {
    provider: "photon",
    bias: true,
    limit: 5,
    minLength: 3,
    coordinates: true,
  } as never;

  it("parses coordinate input as latitude, longitude", async () => {
    const { parseCoordinates } = await import("./search.js");
    expect(parseCoordinates("48.2083, 16.3725")?.center).toEqual([16.3725, 48.2083]);
    expect(parseCoordinates("48,2083 16,3725")?.center).toEqual([16.3725, 48.2083]); // comma decimals
    expect(parseCoordinates("  47.2692;11.4041 ")?.center).toEqual([11.4041, 47.2692]);
    expect(parseCoordinates("stephansplatz")).toBeNull();
    expect(parseCoordinates("120.5, 16.4")).toBeNull(); // latitude out of range
  });

  it("builds Photon requests with view bias and locale", async () => {
    const { buildSearchUrl } = await import("./search.js");
    const url = new URL(
      buildSearchUrl(base, "stephansplatz", { center: [16.3725, 48.2083], lang: "de" }),
    );
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api");
    expect(url.searchParams.get("q")).toBe("stephansplatz");
    expect(url.searchParams.get("lang")).toBe("de");
    expect(url.searchParams.get("lat")).toBe("48.2083");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("builds Nominatim requests with a country filter", async () => {
    const { buildSearchUrl } = await import("./search.js");
    const url = new URL(
      buildSearchUrl({ ...base, provider: "nominatim", country: "AT" } as never, "wien"),
    );
    expect(url.pathname).toContain("/search");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("countrycodes")).toBe("at");
  });

  it("fills custom templates and encodes the query", async () => {
    const { buildSearchUrl } = await import("./search.js");
    const url = buildSearchUrl(
      {
        ...base,
        provider: { url: "https://gz.example.gv.at/s?q={query}&rows={limit}&l={lang}" },
      } as never,
      "bad ischl",
      { lang: "de" },
    );
    expect(url).toBe("https://gz.example.gv.at/s?q=bad%20ischl&rows=5&l=de");
  });

  it("normalises Photon features and honours the country filter", async () => {
    const { search } = await import("./search.js");
    const body = {
      features: [
        {
          properties: {
            name: "Stephansplatz",
            street: "Stephansplatz",
            postcode: "1010",
            city: "Wien",
            country: "Österreich",
            countrycode: "AT",
            extent: [16.37, 48.21, 16.38, 48.2], // west, north, east, south
          },
          geometry: { coordinates: [16.372, 48.208] },
        },
        {
          properties: { name: "Stephansplatz", city: "München", countrycode: "DE" },
          geometry: { coordinates: [11.57, 48.13] },
        },
      ],
    };
    const fetchImpl = async () => ({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchImpl);
    const results = await search({ ...base, country: "AT" } as never, "stephansplatz");
    vi.unstubAllGlobals();

    expect(results).toHaveLength(1); // the Munich hit is filtered out
    expect(results[0]?.label).toBe("Stephansplatz");
    expect(results[0]?.detail).toContain("1010");
    expect(results[0]?.center).toEqual([16.372, 48.208]);
    expect(results[0]?.bbox).toEqual([16.37, 48.2, 16.38, 48.21]); // reordered to w,s,e,n
  });

  it("normalises Nominatim results", async () => {
    const { search } = await import("./search.js");
    const body = [
      {
        display_name: "Stephansplatz, Innere Stadt, Wien, Österreich",
        lat: "48.2084",
        lon: "16.3720",
        boundingbox: ["48.20", "48.21", "16.37", "16.38"], // s, n, w, e
      },
    ];
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => body }));
    const results = await search({ ...base, provider: "nominatim" } as never, "stephansplatz");
    vi.unstubAllGlobals();

    expect(results[0]?.label).toBe("Stephansplatz");
    expect(results[0]?.detail).toBe("Innere Stadt, Wien, Österreich");
    expect(results[0]?.bbox).toEqual([16.37, 48.2, 16.38, 48.21]);
  });

  it("short-circuits coordinates and respects minLength", async () => {
    const { search } = await import("./search.js");
    vi.stubGlobal("fetch", async () => {
      throw new Error("should not be called");
    });
    expect((await search(base, "48.2083, 16.3725"))[0]?.isCoordinate).toBe(true);
    expect(await search(base, "st")).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("coordinates", () => {
  it("picks the Austrian GK strip and UTM zone by longitude", async () => {
    const { autoGkCode, autoUtmCode } = await import("./coordinates.js");
    expect(autoGkCode(9.8)).toBe("EPSG:31254"); // Vorarlberg
    expect(autoGkCode(13.0)).toBe("EPSG:31255"); // Salzburg
    expect(autoGkCode(16.37)).toBe("EPSG:31256"); // Wien
    expect(autoUtmCode(16.37, 48.2)).toBe("EPSG:32633");
    expect(autoUtmCode(9.8, 47.5)).toBe("EPSG:32632");
    expect(autoUtmCode(151.2, -33.8)).toBe("EPSG:32756"); // Sydney, southern hemisphere
  });

  it("formats Vienna in WGS84, GK M34 and UTM 33N with plausible values", async () => {
    const { formatCoordinatesAsync } = await import("./coordinates.js");
    const entries = await formatCoordinatesAsync(16.3725, 48.2083);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.text).toBe("48.208300, 16.372500");
    const gk = entries[1]!;
    expect(gk.code).toBe("EPSG:31256");
    const [gkX, gkY] = gk.text.split(", ").map(Number);
    expect(gkX).toBeGreaterThan(1500);
    expect(gkX).toBeLessThan(4500);
    expect(gkY).toBeGreaterThan(338000);
    expect(gkY).toBeLessThan(345000);
    const utm = entries[2]!;
    const [utmX, utmY] = utm.text.split(", ").map(Number);
    expect(utmX).toBeGreaterThan(597000);
    expect(utmX).toBeLessThan(607000);
    expect(utmY).toBeGreaterThan(5335000);
    expect(utmY).toBeLessThan(5345000);
  });

  it("skips unknown CRS without a def, accepts custom defs", async () => {
    const { formatCoordinatesAsync } = await import("./coordinates.js");
    const missing = await formatCoordinatesAsync(16.37, 48.2, [{ code: "EPSG:99999" }]);
    expect(missing).toHaveLength(0);
    const custom = await formatCoordinatesAsync(16.37, 48.2, [
      { code: "EPSG:31287", label: "Lambert" },
    ]);
    expect(custom[0]?.label).toBe("Lambert");
    const [x, y] = custom[0]!.text.split(", ").map(Number);
    expect(x).toBeGreaterThan(600000); // Vienna in Austria Lambert
    expect(x).toBeLessThan(640000);
    expect(y).toBeGreaterThan(460000);
    expect(y).toBeLessThan(500000);
  });
});

describe("i18n overrides", () => {
  it("config overrides win over built-ins, fallback chain holds", async () => {
    const { makeT, resolveLocale } = await import("./i18n.js");
    const overrides = {
      de: { "layers.title": "Kartenthemen", "custom.key": "Eigener Text" },
      it: { "layers.title": "Livelli" },
    };
    const t = makeT("de", "en", overrides);
    expect(t("layers.title")).toBe("Kartenthemen"); // override wins
    expect(t("basemaps.title")).toBe("Hintergrund"); // built-in untouched
    expect(t("custom.key")).toBe("Eigener Text"); // new key via override
    expect(t("does.not.exist")).toBe("does.not.exist");
    /* overrides can introduce a whole new locale */
    expect(resolveLocale("it", "en", overrides)).toBe("it");
    expect(makeT("it", "en", overrides)("layers.title")).toBe("Livelli");
    expect(makeT("it", "en", overrides)("basemaps.title")).toBe("Basemap"); // en fallback
  });
});

describe("wmts", () => {
  it("recognizes Mercator CRS spellings", async () => {
    const { isMercatorCrs } = await import("./adapters/wmts.js");
    expect(isMercatorCrs("EPSG:3857")).toBe(true);
    expect(isMercatorCrs("urn:ogc:def:crs:EPSG:6.18:3:3857")).toBe(true);
    expect(isMercatorCrs("http://www.opengis.net/def/crs/EPSG/0/900913")).toBe(true);
    expect(isMercatorCrs("EPSG:31256")).toBe(false);
    expect(isMercatorCrs("EPSG:4326")).toBe(false);
  });

  it("builds REST templates with plain-numeric matrix ids", async () => {
    const { buildWmtsTemplate } = await import("./adapters/wmts.js");
    const tpl = buildWmtsTemplate({
      encoding: "REST",
      resourceUrl:
        "https://maps.example.at/basemap/geolandbasemap/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "geolandbasemap",
      style: "normal",
      matrixSet: "google3857",
      format: "image/png",
      matrixIds: ["0", "1", "2", "3"],
    });
    expect(tpl).toBe(
      "https://maps.example.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png",
    );
  });

  it("handles prefixed matrix ids (GeoServer style)", async () => {
    const { buildWmtsTemplate } = await import("./adapters/wmts.js");
    const tpl = buildWmtsTemplate({
      encoding: "REST",
      resourceUrl: "https://e.org/wmts/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}?format=image/png",
      layer: "x",
      style: "default",
      matrixSet: "EPSG:900913",
      format: "image/png",
      matrixIds: ["EPSG:900913:0", "EPSG:900913:1", "EPSG:900913:2"],
    });
    expect(tpl).toContain("/EPSG:900913/EPSG:900913:{z}/{y}/{x}");
  });

  it("tells image tile formats from vector/metadata ones", async () => {
    const { isRasterTileFormat } = await import("./adapters/wmts.js");
    expect(isRasterTileFormat("image/png")).toBe(true);
    expect(isRasterTileFormat("image/png8")).toBe(true);
    expect(isRasterTileFormat("image/jpeg")).toBe(true);
    expect(isRasterTileFormat("image/vnd.jpeg-png")).toBe(true);
    expect(isRasterTileFormat("image/webp")).toBe(true);
    expect(isRasterTileFormat("application/vnd.mapbox-vector-tile")).toBe(false);
    expect(isRasterTileFormat("application/json;type=utfgrid")).toBe(false);
    expect(isRasterTileFormat(undefined)).toBe(false);
  });

  /* GeoServer/GWC lists the vector tile first for every vector-backed layer;
     taking resourceLinks[0] fed protobuf to a raster source. */
  it("skips the vector tile GWC advertises first", async () => {
    const { pickRasterLinks } = await import("./adapters/wmts.js");
    const gwc = [
      { format: "application/vnd.mapbox-vector-tile", url: "https://g.at/rest/mvt" },
      { format: "image/png", url: "https://g.at/rest/png" },
      { format: "image/jpeg", url: "https://g.at/rest/jpeg" },
    ];
    expect(pickRasterLinks(gwc).map((l) => l.format)).toEqual(["image/png", "image/jpeg"]);
    expect(pickRasterLinks(gwc, "image/jpeg")).toEqual([gwc[2]]);
    /* format not advertised → fall back rather than break the layer */
    expect(pickRasterLinks(gwc, "image/webp").map((l) => l.format)).toEqual([
      "image/png",
      "image/jpeg",
    ]);
    expect(pickRasterLinks([gwc[0]!])).toEqual([]);
  });

  it("builds KVP GetTile templates", async () => {
    const { buildWmtsTemplate } = await import("./adapters/wmts.js");
    const tpl = buildWmtsTemplate({
      encoding: "KVP",
      resourceUrl: "https://e.org/wmts",
      layer: "roads",
      style: "default",
      matrixSet: "WebMercatorQuad",
      format: "image/png",
      matrixIds: ["0", "1"],
    });
    expect(tpl).toContain("REQUEST=GetTile");
    expect(tpl).toContain("TILEMATRIXSET=WebMercatorQuad");
    expect(tpl.endsWith("TILEMATRIX={z}&TILEROW={y}&TILECOL={x}")).toBe(true);
  });

  /* GWC answers tiles outside a regional layer's TileMatrixSetLimits with 400
     TileOutOfRange. Values below are real: layer oerok:fi_ogd_2025_v25 on
     WebMercatorQuad at geoserver.lebensraumvernetzung.geo-data.space, where a
     whole-Austria view requested column 32 at z6 (allowed: 33–35) and failed.
     The default topLeft is exactly as published there: "y x" order (URN axis
     rules) and print-rounded — the same document lists EPSG:900913 as "x y". */
  const webMercatorMatrices = (
    ident: (z: number) => string,
    topLeft: [number, number] = [2.003750834e7, -2.003750834e7],
  ) =>
    Array.from({ length: 25 }, (_, z) => ({
      identifier: ident(z),
      scaleDenominator: 5.59082264028717e8 / 2 ** z,
      topLeft,
      tileWidth: 256,
      tileHeight: 256,
      matrixWidth: 2 ** z,
      matrixHeight: 2 ** z,
    }));

  it("derives source coverage from TileMatrixSetLimits", async () => {
    const { coverageFromLimits } = await import("./adapters/wmts.js");
    const cov = coverageFromLimits(
      [
        { tileMatrix: "0", minTileRow: 0, maxTileRow: 0, minTileCol: 0, maxTileCol: 0 },
        { tileMatrix: "6", minTileRow: 21, maxTileRow: 22, minTileCol: 33, maxTileCol: 35 },
        // prettier-ignore
        { tileMatrix: "24", minTileRow: 5758924, maxTileRow: 5944079, minTileCol: 8825625, maxTileCol: 9191992 },
      ],
      webMercatorMatrices(String),
    );
    expect(cov.minzoom).toBe(0);
    expect(cov.maxzoom).toBe(24);
    /* Austria, snapped outward to the z24 grid (caps bbox 9.3774 46.3656 17.2388 49.0386) */
    const [w, s, e, n] = cov.bounds!;
    expect(w).toBeCloseTo(9.3774, 3);
    expect(s).toBeCloseTo(46.3656, 3);
    expect(e).toBeCloseTo(17.2388, 3);
    expect(n).toBeCloseTo(49.0386, 3);

    /* MapLibre's tile cover for these bounds (TileBounds floor/ceil on the
       mercator fraction) must equal the server's allowed range per level */
    const mercX = (lng: number) => (180 + lng) / 360;
    const mercY = (lat: number) =>
      (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
    const cover = (z: number) => {
      const tiles = 2 ** z;
      return {
        minCol: Math.floor(mercX(w) * tiles),
        maxCol: Math.ceil(mercX(e) * tiles) - 1,
        minRow: Math.floor(mercY(n) * tiles),
        maxRow: Math.ceil(mercY(s) * tiles) - 1,
      };
    };
    /* the reported failure: column 32 at z6 must not be requested any more */
    expect(cover(6)).toEqual({ minCol: 33, maxCol: 35, minRow: 21, maxRow: 22 });
    /* deepest level sits exactly on tile boundaries — the inset keeps float
       noise from adding out-of-range column 9191993 */
    // prettier-ignore
    expect(cover(24)).toEqual({ minCol: 8825625, maxCol: 9191992, minRow: 5758924, maxRow: 5944079 });
  });

  it("takes the zoom range from which levels the limits list", async () => {
    const { coverageFromLimits } = await import("./adapters/wmts.js");
    /* classic GWC gridset: prefixed ids and "x y" topLeft — must not be swapped */
    const matrices = webMercatorMatrices(
      (z) => `EPSG:900913:${z}`,
      [-20037508.342789244, 20037508.342789244],
    );
    const cov = coverageFromLimits(
      [
        { tileMatrix: "EPSG:900913:6", minTileRow: 21, maxTileRow: 22, minTileCol: 33, maxTileCol: 35 },
        { tileMatrix: "EPSG:900913:12", minTileRow: 1413, maxTileRow: 1448, minTileCol: 2165, maxTileCol: 2240 },
      ],
      matrices,
    );
    expect(cov.minzoom).toBe(6);
    expect(cov.maxzoom).toBe(12);
    expect(cov.bounds![0]).toBeCloseTo(10.283, 2); // z12 col 2165 west edge
  });

  it("yields no coverage from absent or unusable limits", async () => {
    const { coverageFromLimits } = await import("./adapters/wmts.js");
    const matrices = webMercatorMatrices(String);
    expect(coverageFromLimits([], matrices)).toEqual({});
    /* unknown matrix id, NaN from empty XML elements, inverted range */
    expect(
      coverageFromLimits(
        [
          { tileMatrix: "nope:6", minTileRow: 1, maxTileRow: 2, minTileCol: 1, maxTileCol: 2 },
          { tileMatrix: "3", minTileRow: NaN, maxTileRow: NaN, minTileCol: 0, maxTileCol: 1 },
          { tileMatrix: "4", minTileRow: 5, maxTileRow: 4, minTileCol: 0, maxTileCol: 1 },
        ],
        matrices,
      ),
    ).toEqual({});
  });

  it("drops a degenerate clip but keeps the zoom range", async () => {
    const { coverageFromLimits } = await import("./adapters/wmts.js");
    /* a topLeft no orientation can rescue → bounds refused, zoom range kept */
    const broken = webMercatorMatrices(String, [-4.1e7, -4.1e7]);
    const cov = coverageFromLimits(
      [{ tileMatrix: "6", minTileRow: 21, maxTileRow: 22, minTileCol: 33, maxTileCol: 35 }],
      broken,
    );
    expect(cov.bounds).toBeUndefined();
    expect(cov.minzoom).toBe(6);
    expect(cov.maxzoom).toBe(6);
  });
});

describe("mercator", () => {
  it("projects Vienna roughly correctly", () => {
    const [x, y] = lngLatToMercator(16.3725, 48.2083);
    expect(x).toBeCloseTo(1822570, -3);
    expect(y).toBeCloseTo(6141868, -3);
  });
});

/* ---- review findings R1/R5 ---- */

describe("layer stacking (R1, F2.1)", () => {
  const layer = (id: string): NormalizedLayer => ({
    type: "raster",
    url: `https://e.org/${id}/{z}/{x}/{y}.png`,
    id,
    title: id,
    visible: true,
    opacity: 1,
    groupPath: [],
  });

  it("mounts bottom-up so the first configured layer ends up on top", () => {
    const configured = [layer("a"), layer("b"), layer("c")];
    expect(drawOrder(configured).map((l) => l.id)).toEqual(["c", "b", "a"]);
    expect(configured.map((l) => l.id)).toEqual(["a", "b", "c"]); // input untouched
  });

  it("puts runtime-added layers above the configured tree, newest first", () => {
    const stack = stackOrder([layer("a"), layer("b")], [layer("added1"), layer("added2")]);
    expect(stack.map((l) => l.id)).toEqual(["added2", "added1", "a", "b"]);
  });
});

describe("claimShareParam (R5)", () => {
  it("gives each viewer its own hash parameter and releases it again", () => {
    const first = claimShareParam("map0");
    const second = claimShareParam("map0");
    expect(first.param).toBe("map0");
    expect(second.param).toBe("map0-2");
    second.release();
    const third = claimShareParam("map0");
    expect(third.param).toBe("map0-2"); // the freed name is reusable
    first.release();
    third.release();
    const reclaimed = claimShareParam("map0");
    expect(reclaimed.param).toBe("map0");
    reclaimed.release();
  });
});

describe("createCore — permalink claim rollback (R8)", () => {
  it("frees the hash parameter when the core never comes up", async () => {
    const { createCore } = await import("./index.js");
    const cfg = normalizeConfig({
      version: 1,
      /* refused connection: the style fetch fails before a map can exist */
      basemaps: [{ type: "style", url: "http://127.0.0.1:1/style.json" }],
      permalink: true,
    });
    await expect(
      createCore({ container: { nodeType: 1 } as unknown as HTMLElement, config: cfg }),
    ).rejects.toBeTruthy();
    const claim = claimShareParam("map0");
    expect(claim.param).toBe("map0"); // not "map0-2": the failed attempt let go
    claim.release();
  });
});

describe("reproject (crs on geojson/geoparquet)", () => {
  const gkPoint: [number, number] = [2500, 341000]; // Vienna, MGI / GK M34
  const legacyMember = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::31256" } };
  const near = (c: unknown) => {
    const [lng, lat] = c as [number, number];
    expect(lng).toBeCloseTo(16.3658, 3);
    expect(lat).toBeCloseTo(48.2074, 3);
  };

  it("folds the spellings a CRS turns up in", async () => {
    const { normalizeCrsCode, isWgs84Code, declaredGeoJsonCrs } = await import("./reproject.js");
    expect(normalizeCrsCode("urn:ogc:def:crs:EPSG::31256")).toBe("EPSG:31256");
    expect(normalizeCrsCode("urn:ogc:def:crs:EPSG:6.9:31256")).toBe("EPSG:31256");
    expect(normalizeCrsCode("http://www.opengis.net/def/crs/EPSG/0/31256")).toBe("EPSG:31256");
    expect(normalizeCrsCode("http://www.opengis.net/gml/srs/epsg.xml#31256")).toBe("EPSG:31256");
    expect(normalizeCrsCode("epsg:31256")).toBe("EPSG:31256");
    expect(normalizeCrsCode(" 31256 ")).toBe("EPSG:31256");
    expect(normalizeCrsCode("urn:ogc:def:crs:OGC:1.3:CRS84")).toBe("OGC:CRS84");
    expect(normalizeCrsCode("CRS:84")).toBe("OGC:CRS84");
    expect(normalizeCrsCode("http://www.opengis.net/def/crs/OGC/1.3/CRS84")).toBe("OGC:CRS84");
    expect(isWgs84Code("EPSG:4326")).toBe(true);
    expect(isWgs84Code("urn:ogc:def:crs:OGC:1.3:CRS84")).toBe(true);
    expect(isWgs84Code("EPSG:4258")).toBe(true); // ETRS89 — the same numbers
    expect(isWgs84Code("EPSG:31256")).toBe(false);
    expect(declaredGeoJsonCrs({ type: "FeatureCollection", features: [], crs: legacyMember })).toBe("EPSG:31256");
    expect(
      declaredGeoJsonCrs({ type: "Point", coordinates: [0, 0], crs: { type: "EPSG", properties: { code: 4326 } } }),
    ).toBe("EPSG:4326");
    expect(declaredGeoJsonCrs({ type: "FeatureCollection", features: [] })).toBeNull();
    expect(declaredGeoJsonCrs("https://e.org/x.geojson")).toBeNull();
  });

  it("copies every geometry type into WGS84 and leaves the input alone", async () => {
    const { projectorToWgs84, reprojectGeoJson } = await import("./reproject.js");
    const project = (await projectorToWgs84({ code: "EPSG:31256" }))!;
    const props = { name: "A" };
    const ring = [gkPoint, [3000, 341000], [3000, 342000], gkPoint];
    const input = {
      type: "FeatureCollection",
      bbox: [0, 0, 1, 1],
      crs: legacyMember,
      features: [
        { type: "Feature", properties: props, bbox: [0, 0, 1, 1], geometry: { type: "Point", coordinates: [...gkPoint, 171.5] } },
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [gkPoint, [3000, 342000]] } },
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
        { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[ring]] } },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: gkPoint }] },
        },
        { type: "Feature", properties: {}, geometry: null },
      ],
    };
    const before = JSON.stringify(input);
    const out = reprojectGeoJson(input, project) as typeof input & Record<string, unknown>;
    expect(JSON.stringify(input)).toBe(before); // inline data is the config object — untouched
    expect(out).not.toHaveProperty("bbox");
    expect(out).not.toHaveProperty("crs");
    expect(out.features[0]).not.toHaveProperty("bbox");
    const g = (i: number) =>
      out.features[i]!.geometry as { coordinates: unknown; geometries?: Array<{ coordinates: unknown }> };
    near(g(0).coordinates);
    expect((g(0).coordinates as number[])[2]).toBe(171.5); // z survives
    expect(out.features[0]!.properties).toBe(props); // shared, never mutated
    near((g(1).coordinates as unknown[])[0]);
    near((g(2).coordinates as unknown[][])[0]![0]);
    near((g(3).coordinates as unknown[][][])[0]![0]![0]);
    near(g(4).geometries![0]!.coordinates);
    expect(out.features[5]!.geometry).toBeNull();
  });

  it("knows the registry, derives UTM zones, and refuses the rest with the fix in the message", async () => {
    const { projectorToWgs84 } = await import("./reproject.js");
    expect(await projectorToWgs84({ code: "EPSG:4326" })).toBeNull();
    expect(await projectorToWgs84({ code: "urn:ogc:def:crs:OGC:1.3:CRS84" })).toBeNull();
    expect(await projectorToWgs84({ code: "EPSG:32756" })).toBeTypeOf("function");
    const laea = (await projectorToWgs84({ code: "EPSG:3035" }))!([4790000, 2800000]);
    expect(laea[0]).toBeCloseTo(16.4, 0);
    expect(laea[1]).toBeCloseTo(48.2, 0);
    await expect(projectorToWgs84({ code: "EPSG:99999" })).rejects.toThrow(/"def"/);
    const custom = await projectorToWgs84({
      code: "EPSG:99998",
      def: "+proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel +units=m +no_defs",
    });
    expect(custom!(gkPoint)[0]).toBeCloseTo(16.37, 1);
  });

  it("GeoJsonAdapter feeds the source WGS84 — from a crs key, a legacy member, or a fetched document", async () => {
    const { GeoJsonAdapter } = await import("./adapters/geojson.js");
    const sources: Array<{ data: unknown }> = [];
    const map = {
      addSource: (_id: string, src: { data: unknown }) => sources.push(src),
      addLayer: () => {},
      on: () => {},
      off: () => {},
      getLayer: () => undefined,
      setLayoutProperty: () => {},
      setPaintProperty: () => {},
    };
    const ctx = { map, accent: "#000" } as never;
    const base = { type: "geojson", id: "p", title: "P", visible: true, opacity: 1, groupPath: [] };

    const keyed = new GeoJsonAdapter({ ...base, crs: "EPSG:31256", data: { type: "Point", coordinates: gkPoint } } as never);
    await keyed.mount(ctx);
    near((sources[0]!.data as { coordinates: unknown }).coordinates);
    const bounds = (await keyed.bounds())!;
    near([bounds[0], bounds[1]]);
    near([bounds[2], bounds[3]]);

    const legacy = new GeoJsonAdapter({
      ...base,
      data: {
        type: "FeatureCollection",
        crs: legacyMember,
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: gkPoint } }],
      },
    } as never);
    await legacy.mount(ctx);
    const fc = sources[1]!.data as { crs?: unknown; features: Array<{ geometry: { coordinates: unknown } }> };
    near(fc.features[0]!.geometry.coordinates);
    expect(fc).not.toHaveProperty("crs");

    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ type: "Point", coordinates: gkPoint }) }));
    const remote = new GeoJsonAdapter({ ...base, crs: { code: "EPSG:31256" }, data: "https://e.org/gk.geojson" } as never);
    await remote.mount(ctx);
    near((sources[2]!.data as { coordinates: unknown }).coordinates);
    vi.unstubAllGlobals();

    /* without a crs the URL stays a URL — MapLibre loads it in its worker as before */
    const plain = new GeoJsonAdapter({ ...base, data: "https://e.org/x.geojson" } as never);
    await plain.mount(ctx);
    expect(sources[3]!.data).toBe("https://e.org/x.geojson");
  });
});

describe("geofile (F3.2) — GeoJSON, KML and GPX files", () => {
  const parseXml = async () => {
    const { DOMParser } = await import("@xmldom/xmldom");
    return (text: string) =>
      new DOMParser().parseFromString(text, "text/xml") as unknown as Document;
  };

  const kmlText = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Style id="red"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>
  <Placemark><name>Stephansdom</name><description>Cathedral</description>
    <Point><coordinates>16.3738,48.2085,0</coordinates></Point></Placemark>
  <Placemark><name>Ring</name><styleUrl>#red</styleUrl>
    <LineString><coordinates>16.36,48.20,0 16.37,48.21,0</coordinates></LineString></Placemark>
  <Folder><name>empty folder</name></Folder>
</Document></kml>`;

  const gpxText = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="48.2085" lon="16.3738"><name>Start</name></wpt>
  <trk><name>Morning run</name><trkseg>
    <trkpt lat="48.20" lon="16.36"><ele>170</ele></trkpt>
    <trkpt lat="48.21" lon="16.37"><ele>172</ele></trkpt>
  </trkseg></trk>
</gpx>`;

  const point = (coordinates: number[]) => ({ type: "Point" as const, coordinates });
  const fcOf = (...features: Array<{ properties: Record<string, unknown> | null; geometry: object }>) => ({
    type: "FeatureCollection" as const,
    features: features.map((f) => ({ type: "Feature" as const, ...f })) as never[],
  });

  it("detects the format by extension, then by content", async () => {
    const { sniffGeoFormat, formatFromFileName } = await import("./geofile.js");
    expect(formatFromFileName("trees.GeoJSON")).toBe("geojson");
    expect(formatFromFileName("trees.json")).toBe("geojson");
    expect(formatFromFileName("route.kml")).toBe("kml");
    expect(formatFromFileName("route.gpx")).toBe("gpx");
    expect(formatFromFileName("photo.jpg")).toBeNull();
    /* unknown extension: the first bytes decide */
    expect(sniffGeoFormat("export.xml", kmlText)).toBe("kml");
    expect(sniffGeoFormat("track", gpxText)).toBe("gpx");
    expect(sniffGeoFormat("data.txt", '\uFEFF  {"type":"Point"}')).toBe("geojson");
    expect(sniffGeoFormat("notes.txt", "hello")).toBeNull();
    /* a known extension is not second-guessed */
    expect(sniffGeoFormat("data.json", kmlText)).toBe("geojson");
  });

  it("names the layer after the file, without the extension", async () => {
    const { titleFromFileName } = await import("./geofile.js");
    expect(titleFromFileName("Radweg Donau.kml")).toBe("Radweg Donau");
    expect(titleFromFileName("C:\\Users\\x\\trees.geojson")).toBe("trees");
    expect(titleFromFileName("/tmp/a.b.gpx")).toBe("a.b");
    expect(titleFromFileName("README")).toBe("README");
    expect(titleFromFileName(".geojson")).toBe(".geojson");
  });

  it("passes a FeatureCollection through and wraps a Feature or geometry", async () => {
    const { parseGeoFile } = await import("./geofile.js");
    const fc = fcOf({ properties: { a: 1 }, geometry: point([16, 48]) });
    expect(await parseGeoFile("x.geojson", JSON.stringify(fc))).toEqual(fc);
    const feature = await parseGeoFile("f.json", JSON.stringify(fc.features[0]));
    expect(feature.features).toEqual(fc.features);
    const geom = await parseGeoFile(
      "g.json",
      '{"type":"LineString","coordinates":[[16,48],[17,48]]}',
    );
    expect(geom.features).toHaveLength(1);
    expect(geom.features[0]!.geometry.type).toBe("LineString");
    expect(geom.features[0]!.properties).toEqual({});
  });

  it("keeps a legacy crs member so the adapter can reproject the file", async () => {
    const { parseGeoFile } = await import("./geofile.js");
    const { declaredGeoJsonCrs } = await import("./reproject.js");
    const crs = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::31256" } };
    const fc = { type: "FeatureCollection", crs, features: [] };
    expect(declaredGeoJsonCrs(await parseGeoFile("gk.geojson", JSON.stringify(fc)))).toBe(
      "EPSG:31256",
    );
    /* …also when the file is a single Feature or a bare geometry (QGIS writes both) */
    const single = { type: "Feature", crs, properties: {}, geometry: point([2500, 341000]) };
    expect(declaredGeoJsonCrs(await parseGeoFile("gk-f.json", JSON.stringify(single)))).toBe(
      "EPSG:31256",
    );
    const bare = { type: "Point", crs, coordinates: [2500, 341000] };
    const parsed = await parseGeoFile("gk-g.json", JSON.stringify(bare));
    expect(declaredGeoJsonCrs(parsed)).toBe("EPSG:31256");
    expect(parsed.features[0]!.geometry).toEqual(bare);
  });

  it("converts KML placemarks, carrying names and simplestyle colours", async () => {
    const { parseGeoFile } = await import("./geofile.js");
    const fc = await parseGeoFile("wien.kml", kmlText, { parseXml: await parseXml() });
    expect(fc.type).toBe("FeatureCollection");
    /* the empty folder is not a feature */
    expect(fc.features.map((f) => f.geometry.type)).toEqual(["Point", "LineString"]);
    expect(fc.features[0]!.properties).toMatchObject({
      name: "Stephansdom",
      description: "Cathedral",
    });
    expect(fc.features[0]!.geometry).toEqual(point([16.3738, 48.2085, 0]));
    /* KML aabbggrr → simplestyle #rrggbb + width */
    expect(fc.features[1]!.properties).toMatchObject({ stroke: "#ff0000", "stroke-width": 3 });
  });

  it("converts GPX waypoints and tracks", async () => {
    const { parseGeoFile } = await import("./geofile.js");
    const fc = await parseGeoFile("run.gpx", gpxText, { parseXml: await parseXml() });
    /* togeojson emits tracks, then routes, then waypoints */
    expect(fc.features.map((f) => f.geometry.type)).toEqual(["LineString", "Point"]);
    expect(fc.features[0]!.properties?.name).toBe("Morning run");
    expect((fc.features[0]!.geometry as { coordinates: number[][] }).coordinates).toEqual([
      [16.36, 48.2, 170],
      [16.37, 48.21, 172],
    ]);
  });

  it("refuses files that are not feature files, with a message naming the file", async () => {
    const { parseGeoFile } = await import("./geofile.js");
    await expect(parseGeoFile("notes.txt", "hello world")).rejects.toThrow(
      /notes\.txt is not a GeoJSON, KML or GPX file/,
    );
    await expect(parseGeoFile("broken.geojson", "{not json")).rejects.toThrow(
      /broken\.geojson is not valid JSON/,
    );
    await expect(parseGeoFile("config.json", '{"version":1,"basemaps":[]}')).rejects.toThrow(
      /config\.json is not GeoJSON/,
    );
    await expect(parseGeoFile("list.json", "[1,2,3]")).rejects.toThrow(/is not GeoJSON/);
  });

  it("styles per feature only when the file carries simplestyle properties", async () => {
    const { simpleStyleFor } = await import("./geofile.js");
    const plain = fcOf({ properties: { name: "x" }, geometry: point([16, 48]) });
    expect(simpleStyleFor(plain, "#0e7490")).toBeUndefined();
    const styled = fcOf(
      { properties: { name: "x" }, geometry: point([16, 48]) },
      {
        properties: { stroke: "#ff0000" },
        geometry: { type: "LineString", coordinates: [[16, 48], [17, 48]] },
      },
    );
    const style = simpleStyleFor(styled, "#0e7490")!;
    expect(style["line-color"]).toEqual(["coalesce", ["get", "stroke"], "#0e7490"]);
    expect(style["fill-color"]).toEqual(["coalesce", ["get", "fill"], "#0e7490"]);
    expect(style["circle-radius"]).toBe(5);
    /* null properties (GPX routes without extensions) do not count as styled */
    const nulls = fcOf({ properties: null, geometry: point([16, 48]) });
    expect(simpleStyleFor(nulls, "#0e7490")).toBeUndefined();
  });
});

describe("permalink — which user-added layers travel (F3.5, F3.2)", () => {
  it("keeps layers added by URL and drops layers with inline data", async () => {
    const { shareableLayerDefs } = await import("./permalink.js");
    const byUrl = { type: "geojson", id: "a", data: "https://e.org/a.geojson" };
    const dropped = { type: "geojson", id: "b", data: { type: "FeatureCollection", features: [] } };
    const wms = { type: "wms", id: "c", url: "https://e.org/ows", layers: "x" };
    expect(shareableLayerDefs([dropped, byUrl, wms])).toEqual([byUrl, wms]);
    expect(shareableLayerDefs([])).toEqual([]);
  });
});
