import { describe, expect, it } from "vitest";
import { buildGetFeatureInfoUrl, buildLegendUrl, buildWmsTileUrl, WmsAdapter } from "./adapters/wms.js";
import { expandSimpleStyle } from "./adapters/geojson.js";
import { deriveFromStyleLayers, entryFromPaint } from "./adapters/legend-derive.js";
import { escapeHtml, renderFields, renderTemplate } from "./template.js";
import { lngLatToMercator } from "./mercator.js";

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
      expect(spec.url).toBe(buildLegendUrl({ url: "https://sdi.example.gv.at/ows", layers: "laerm" }));
    }
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
});

describe("mercator", () => {
  it("projects Vienna roughly correctly", () => {
    const [x, y] = lngLatToMercator(16.3725, 48.2083);
    expect(x).toBeCloseTo(1822570, -3);
    expect(y).toBeCloseTo(6141868, -3);
  });
});
