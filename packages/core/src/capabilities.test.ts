import { describe, expect, it } from "vitest";
import {
  asBbox,
  cleanServiceUrl,
  pickInfoFormat,
  scaleDenominatorToZoom,
  wmsCandidates,
  wmsLayerFromCandidate,
  wmtsLayerFromCandidate,
  type WmsLayerDetails,
  type WmsTreeNode,
} from "./capabilities.js";

/* GeoServer's shape: an unnamed root with the full CRS list, leaves with their native CRS only */
const tree: WmsTreeNode[] = [
  {
    availableCrs: ["EPSG:4326", "EPSG:3857", "EPSG:31256"],
    children: [
      { name: "native", availableCrs: ["EPSG:31256", "CRS:84"] },
      { name: "group", children: [{ name: "child", availableCrs: [] }] },
    ],
  },
];

const details: Record<string, WmsLayerDetails> = {
  native: {
    title: "Native only",
    abstract: "declares one CRS",
    availableCrs: ["EPSG:31256", "CRS:84"],
    boundingBoxes: { "CRS:84": ["16.18", "48.12", "16.57", "48.32"] },
    queryable: true,
    maxScaleDenominator: 50000,
    metadata: [{ url: "https://cat/native" }],
    attribution: { title: "City" },
    styles: [{ name: "polygon", title: "Default Polygon" }, { name: "outline" }],
  },
  child: { title: "Child", availableCrs: ["EPSG:31256"], boundingBoxes: {}, queryable: false, styles: [] },
};

describe("wmsCandidates", () => {
  it("unions CRS down the tree, so a leaf inherits the root's EPSG:3857", () => {
    const [native, child] = wmsCandidates(tree, (name) => details[name]!);
    expect(native).toMatchObject({ name: "native", title: "Native only", has3857: true, queryable: true });
    expect(child).toMatchObject({ name: "child", title: "Child", has3857: true, queryable: false });
    expect(wmsCandidates(tree, (name) => details[name]!)).toHaveLength(2); // groups are not candidates
  });

  it("reads bounds from attribute strings, zoom from the scale denominator, metadata, attribution and styles", () => {
    const [native] = wmsCandidates(tree, (name) => details[name]!);
    expect(native!.bounds).toEqual([16.18, 48.12, 16.57, 48.32]);
    expect(native!.minZoom).toBe(scaleDenominatorToZoom(50000));
    expect(native!.metadataUrl).toBe("https://cat/native");
    expect(native!.attribution).toBe("City");
    expect(native!.styles).toEqual([{ name: "polygon", title: "Default Polygon" }, { name: "outline" }]);
  });

  it("without a Mercator CRS anywhere the leaf is flagged; with no CRS at all it gets the benefit of the doubt", () => {
    const flat: WmsTreeNode[] = [{ name: "gk", availableCrs: ["EPSG:31256"] }, { name: "mute" }];
    const [gk, mute] = wmsCandidates(flat, (name) => ({ title: name, availableCrs: name === "gk" ? ["EPSG:31256"] : [] }));
    expect(gk!.has3857).toBe(false);
    expect(mute!.has3857).toBe(true);
  });
});

describe("candidate → layer", () => {
  it("builds a WMS layer with feature info for queryable candidates", () => {
    const [native, child] = wmsCandidates(tree, (name) => details[name]!);
    expect(wmsLayerFromCandidate({ url: "https://x/wms", infoFormat: "text/html" }, native!)).toEqual({
      type: "wms",
      url: "https://x/wms",
      layers: "native",
      info: { format: "text/html" },
      title: "Native only",
      minZoom: scaleDenominatorToZoom(50000),
      bounds: [16.18, 48.12, 16.57, 48.32],
      metadata: { url: "https://cat/native" },
      attribution: "City",
    });
    expect(wmsLayerFromCandidate({ url: "https://x/wms" }, child!)).toEqual({ type: "wms", url: "https://x/wms", layers: "child", title: "Child" });
  });

  it("builds a WMTS layer pointing at the capabilities URL", () => {
    expect(wmtsLayerFromCandidate({ url: "https://x/wmts/1.0.0/WMTSCapabilities.xml" }, { name: "bmap", title: "bmap", queryable: false, has3857: true })).toEqual({
      type: "wmts",
      url: "https://x/wmts/1.0.0/WMTSCapabilities.xml",
      layer: "bmap",
      title: "bmap",
    });
  });
});

describe("helpers", () => {
  it("strips operation parameters but keeps vendor ones", () => {
    expect(cleanServiceUrl("https://x/wms?SERVICE=WMS&REQUEST=GetCapabilities&map=/a.map")).toBe("https://x/wms?map=%2Fa.map");
    expect(cleanServiceUrl("https://x/wms?service=WMS")).toBe("https://x/wms");
    expect(cleanServiceUrl("not a url")).toBe("not a url");
  });

  it("coerces bounding boxes and picks info formats", () => {
    expect(asBbox(["1", "2", "3", "4"])).toEqual([1, 2, 3, 4]);
    expect(asBbox([1, 2, 3])).toBeUndefined();
    expect(asBbox(["a", 2, 3, 4])).toBeUndefined();
    expect(pickInfoFormat(["text/plain", "application/json"])).toBe("application/json");
    expect(pickInfoFormat(["text/plain", "text/html"])).toBe("text/html");
    expect(pickInfoFormat(["text/plain"])).toBeUndefined();
  });
});
