import { validateConfig } from "@map0/schema";
import { describe, expect, it } from "vitest";
import { buildConfig } from "./cli.js";
import { collectionUrl, extentBbox, ogcApiSnippet, splitCollectionUrl } from "./ogcapi.js";
import { listedLayers } from "./report.js";
import { probeTargets, verdictOf, type LayerReport, type Options, type ServiceReport } from "./types.js";
import { pickJsonFormat, sampleUrl, sizeFinding, wfsSnippet } from "./wfs.js";
import { getMapUrl, wmsSnippet } from "./wms.js";
import { fillTemplate, imageFormats, wmtsSnippet } from "./wmts.js";

const opts: Options = { origin: "https://map0.net", timeoutMs: 1000, probeLimit: 3, layers: [], all: false };

const service: ServiceReport = {
  kind: "wms",
  title: "T",
  url: "https://h/geo",
  capabilitiesUrl: "https://h/geo?service=WMS&request=GetCapabilities",
  summary: [],
  findings: [],
  layerCount: 1,
  layers: [],
};

describe("verdicts and probe selection", () => {
  it("verdictOf: fail beats warn, info counts as ok", () => {
    expect(verdictOf([])).toBe("ok");
    expect(verdictOf([{ level: "info", code: "x", message: "" }])).toBe("ok");
    expect(verdictOf([{ level: "warn", code: "x", message: "" }, { level: "ok", code: "y", message: "" }])).toBe("warn");
    expect(verdictOf([{ level: "warn", code: "x", message: "" }, { level: "fail", code: "y", message: "" }])).toBe("fail");
  });

  it("probeTargets: --layer picks win, otherwise the first probeLimit", () => {
    const names = ["a", "b", "c", "d"];
    expect([...probeTargets(names, opts).targets]).toEqual(["a", "b", "c"]);
    expect([...probeTargets(names, { ...opts, all: true }).targets]).toEqual(names);
    const picked = probeTargets(names, { ...opts, layers: ["d", "zz"] });
    expect([...picked.targets]).toEqual(["d"]);
    expect(picked.missing).toEqual(["zz"]);
  });
});

describe("WMS", () => {
  it("getMapUrl is map0's GetMap request with the tile's bbox filled in", () => {
    const url = new URL(getMapUrl("https://h/geo?map=x", "1.3.0", "roads", [1, 2, 3, 4]));
    expect(url.searchParams.get("map")).toBe("x");
    expect(url.searchParams.get("SERVICE")).toBe("WMS");
    expect(url.searchParams.get("CRS")).toBe("EPSG:3857");
    expect(url.searchParams.get("SRS")).toBeNull();
    expect(url.searchParams.get("BBOX")).toBe("1,2,3,4");
    expect(url.searchParams.get("TRANSPARENT")).toBe("TRUE");
    expect(url.searchParams.get("WIDTH")).toBe("256");
    expect(new URL(getMapUrl("https://h/geo", "1.1.1", "roads", [1, 2, 3, 4])).searchParams.get("SRS")).toBe("EPSG:3857");
  });

  it("wmsSnippet is core's layer definition, plus the version for pre-1.3.0 servers", () => {
    const c = { name: "roads", title: "Roads", queryable: true, has3857: true, bounds: [16.18371, 48.1225, 16.5455, 48.31704] as [number, number, number, number] };
    expect(wmsSnippet({ url: "https://h/geo", infoFormat: "text/html" }, c, "1.3.0")).toEqual({
      type: "wms",
      url: "https://h/geo",
      layers: "roads",
      title: "Roads",
      info: { format: "text/html" },
      bounds: [16.1837, 48.1225, 16.5455, 48.317],
    });
    expect(wmsSnippet({ url: "https://h/geo" }, { ...c, queryable: false }, "1.1.1")).toMatchObject({ version: "1.1.1" });
    expect("info" in wmsSnippet({ url: "https://h/geo" }, { ...c, queryable: false }, "1.3.0")).toBe(false);
  });
});

describe("WMTS", () => {
  it("ranks image formats and fills REST templates", () => {
    expect(imageFormats(["application/vnd.mapbox-vector-tile", "image/jpeg", "image/png"])).toEqual(["image/png", "image/jpeg"]);
    expect(imageFormats(["application/json"])).toEqual([]);
    expect(
      fillTemplate("https://h/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png?t={Time}", {
        Style: "normal",
        tilematrixset: "google3857",
        TileMatrix: "7",
        TileRow: "44",
        TileCol: "68",
      }),
    ).toBe("https://h/normal/google3857/7/44/68.png?t={Time}");
  });

  it("wmtsSnippet is core's layer definition with rounded bounds", () => {
    expect(wmtsSnippet("https://h/caps.xml", "bmapgrau", true, [8.78241, 46.35882, 17.5, 49.03791])).toEqual({
      type: "wmts",
      url: "https://h/caps.xml",
      layer: "bmapgrau",
      title: "bmapgrau",
      bounds: [8.7824, 46.3588, 17.5, 49.0379],
    });
  });
});

describe("WFS", () => {
  it("picks the GeoJSON format in the server's spelling", () => {
    expect(pickJsonFormat(["GML2", "application/json", "gml3"])).toBe("application/json");
    expect(pickJsonFormat(["geojson", "gml"])).toBe("geojson");
    expect(pickJsonFormat(["application/json; subtype=geojson"])).toBe("application/json; subtype=geojson");
    expect(pickJsonFormat(["GML2"])).toBeUndefined();
  });

  it("size thresholds follow map0's default limit", () => {
    expect(sizeFinding(undefined, "features")).toBeUndefined();
    expect(sizeFinding(2388, "features")?.level).toBe("ok");
    expect(sizeFinding(10001, "features")?.level).toBe("warn");
    expect(sizeFinding(300000, "features")?.level).toBe("warn");
  });

  it("sampleUrl is map0's GetFeature request for one feature", () => {
    const u = new URL(sampleUrl("https://h/geo", "2.0.0", "ns:t", "application/json"));
    expect(u.searchParams.get("TYPENAMES")).toBe("ns:t");
    expect(u.searchParams.get("COUNT")).toBe("1");
    expect(u.searchParams.get("SRSNAME")).toBe("EPSG:4326");
    const v1 = new URL(sampleUrl("https://h/geo", "1.1.0", "ns:t", "geojson"));
    expect(v1.searchParams.get("TYPENAME")).toBe("ns:t");
    expect(v1.searchParams.get("MAXFEATURES")).toBe("1");
  });

  it("wfsSnippet only spells out what differs from map0's defaults", () => {
    expect(wfsSnippet("ns:t", "Title", "https://h/geo", "1.1.0", "geojson", undefined, "https://meta")).toEqual({
      type: "wfs",
      url: "https://h/geo",
      typeNames: "ns:t",
      title: "Title",
      version: "1.1.0",
      outputFormat: "geojson",
      metadata: { url: "https://meta" },
    });
    expect("outputFormat" in wfsSnippet("t", "t", "https://h", "2.0.0", "application/json", undefined, undefined)).toBe(false);
  });
});

describe("OGC API Features", () => {
  it("splits collection URLs and reads extents", () => {
    expect(splitCollectionUrl("https://h/api/collections/roads/items?f=json")).toEqual({ root: "https://h/api", collectionId: "roads" });
    expect(splitCollectionUrl("https://h/api/")).toEqual({ root: "https://h/api" });
    expect(splitCollectionUrl("https://h/api/collections")).toEqual({ root: "https://h/api" });
    expect(collectionUrl("https://h/api", "a b")).toBe("https://h/api/collections/a%20b");
    expect(extentBbox({ extent: { spatial: { bbox: [[16, 48, 17, 49]] } } })).toEqual([16, 48, 17, 49]);
    expect(extentBbox({ extent: { spatial: { bbox: [[16, 48, 100, 17, 49, 200]] } } })).toEqual([16, 48, 17, 49]);
    expect(extentBbox({})).toBeUndefined();
    expect(ogcApiSnippet("https://h/api/collections/roads", "Roads", undefined)).toEqual({
      type: "ogcapi-features",
      url: "https://h/api/collections/roads",
      title: "Roads",
    });
  });
});

describe("report and config", () => {
  const layer = (name: string, verdict: LayerReport["verdict"], probed = false): LayerReport => ({
    name,
    title: name,
    verdict,
    facts: [],
    findings: [],
    probed,
  });

  it("listedLayers shows probed layers first and caps unprobed problems", () => {
    const layers = [layer("ok1", "ok"), ...Array.from({ length: 12 }, (_, i) => layer(`bad${i}`, "fail")), layer("probed", "ok", true)];
    const { shown, hidden, hiddenProblems } = listedLayers(layers, false);
    expect(shown[0]?.name).toBe("probed");
    expect(shown.length).toBe(9);
    expect(hidden).toBe(layers.length - 9);
    expect(hiddenProblems).toBe(4);
    expect(listedLayers(layers, true).shown.length).toBe(layers.length);
  });

  it("buildConfig produces a config map0's validator accepts", () => {
    const cfg = buildConfig(service, [
      wmsSnippet({ url: "https://h/geo", infoFormat: "application/json" }, { name: "a", title: "A", queryable: true, has3857: true, bounds: [16, 48, 17, 49] }, "1.3.0"),
      wfsSnippet("ns:t", "T", "https://h/geo", "2.0.0", "application/json", undefined, undefined),
      ogcApiSnippet("https://h/api/collections/roads", "Roads", undefined),
      wmtsSnippet("https://h/caps.xml", "grau", true, undefined),
    ]);
    expect(cfg.version).toBe(1);
    expect(cfg.map).toEqual({ bounds: [16, 48, 17, 49] });
    expect((cfg.basemaps as unknown[]).length).toBe(1);
    const result = validateConfig(cfg);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("buildConfig falls back to the Austrian view without bounds", () => {
    const cfg = buildConfig(service, [{ type: "wms", url: "https://h/geo", layers: "a" }]);
    expect(cfg.map).toEqual({ center: [13.35, 47.6], zoom: 7 });
  });
});
