import { describe, expect, it } from "vitest";
import { hintFromUrl, rootTag, sniff } from "./detect.js";
import { corsFinding, exceptionText, httpsFinding, withParams, withoutParams, type HttpResult } from "./http.js";

function res(text: string, contentType = "text/xml"): HttpResult {
  return { url: "https://x", finalUrl: "https://x", status: 200, ok: true, ms: 1, bytes: text.length, contentType, cors: "*", text };
}

describe("service detection", () => {
  it("sniff recognises every capabilities flavour", () => {
    expect(sniff(res('<?xml version="1.0"?>\n<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"/>'))).toBe("wms");
    expect(
      sniff(
        res(
          '<?xml version="1.0"?>\n<!DOCTYPE WMT_MS_Capabilities SYSTEM "http://x/capabilities_1_1_1.dtd">\n<!-- c --><WMT_MS_Capabilities version="1.1.1">',
        ),
      ),
    ).toBe("wms");
    expect(sniff(res('<Capabilities xmlns="http://www.opengis.net/wmts/1.0" version="1.0.0">'))).toBe("wmts");
    expect(sniff(res('<wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" version="2.0.0">'))).toBe("wfs");
    expect(sniff(res('<ServiceExceptionReport version="1.3.0"><ServiceException>nope</ServiceException></ServiceExceptionReport>'))).toBe("exception");
    expect(sniff(res('<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"/>'))).toBe("exception");
    expect(sniff(res("<html><body>hi</body></html>", "text/html"))).toBeUndefined();
  });

  it("sniff recognises OGC API documents", () => {
    const landing = JSON.stringify({ title: "x", links: [{ rel: "data", href: "/collections" }, { rel: "conformance", href: "/conformance" }] });
    expect(sniff(res(landing, "application/json"))).toBe("ogcapi-features");
    const collection = JSON.stringify({ id: "roads", links: [{ rel: "self", href: "x" }], extent: {} });
    expect(sniff(res(collection, "application/json"))).toBe("ogcapi-features");
    const items = JSON.stringify({ type: "FeatureCollection", features: [] });
    expect(sniff(res(items, "application/geo+json"))).toBe("ogcapi-features");
    expect(sniff(res(JSON.stringify({ hello: "world" }), "application/json"))).toBeUndefined();
    expect(sniff(res("{not json", "application/json"))).toBeUndefined();
  });

  it("rootTag skips prolog, doctype and comments", () => {
    expect(rootTag('<?xml version="1.0"?><!-- x --><a:Root xmlns:a="u"><b/></a:Root>')).toBe("Root");
    expect(rootTag("plain text")).toBeUndefined();
  });

  it("hintFromUrl reads the service parameter and path fragments", () => {
    expect(hintFromUrl("https://h/geo?service=wfs")).toBe("wfs");
    expect(hintFromUrl("https://h/basemap/1.0.0/WMTSCapabilities.xml")).toBe("wmts");
    expect(hintFromUrl("https://h/api/collections/roads")).toBe("ogcapi-features");
    expect(hintFromUrl("https://h/geo")).toBeUndefined();
    expect(hintFromUrl("not a url")).toBeUndefined();
  });
});

describe("http helpers", () => {
  it("withParams replaces case-insensitively, withoutParams drops the trailing ?", () => {
    expect(withParams("https://h/g?service=wms&x=1", { SERVICE: "WFS" })).toBe("https://h/g?x=1&SERVICE=WFS");
    expect(withoutParams("https://h/c?f=json", ["f"])).toBe("https://h/c");
  });

  it("exceptionText extracts OGC and problem-detail messages", () => {
    expect(
      exceptionText('<ServiceExceptionReport><ServiceException code="LayerNotDefined">\n  Unknown layer  "x"\n</ServiceException></ServiceExceptionReport>'),
    ).toBe('Unknown layer "x"');
    expect(exceptionText("<ows:ExceptionReport><ows:Exception><ows:ExceptionText>No CRS</ows:ExceptionText></ows:Exception></ows:ExceptionReport>")).toBe("No CRS");
    expect(exceptionText('<ows:ExceptionReport><ows:Exception exceptionCode="InvalidParameterValue"/></ows:ExceptionReport>')).toBe(
      "OGC exception report (InvalidParameterValue)",
    );
    expect(exceptionText(JSON.stringify({ title: "Not Found", description: "no such collection" }))).toBe("Not Found: no such collection");
    expect(exceptionText(JSON.stringify({ type: "FeatureCollection", features: [] }))).toBeUndefined();
    expect(exceptionText("<html>")).toBeUndefined();
    expect(exceptionText(undefined)).toBeUndefined();
  });

  it("httpsFinding mirrors map0's URL policy", () => {
    expect(httpsFinding("https://h/x").level).toBe("ok");
    expect(httpsFinding("http://h/x").level).toBe("fail");
    expect(httpsFinding("http://localhost:8080/x").level).toBe("info");
    expect(httpsFinding("ftp://h/x").level).toBe("warn");
  });

  it("corsFinding judges the Access-Control-Allow-Origin header", () => {
    const base = res("x");
    expect(corsFinding({ ...base, cors: null }, "GetMap", "https://map0.net").level).toBe("fail");
    expect(corsFinding({ ...base, cors: "*" }, "GetMap", "https://map0.net").level).toBe("ok");
    expect(corsFinding({ ...base, cors: "https://MAP0.net" }, "GetMap", "https://map0.net").level).toBe("ok");
    expect(corsFinding({ ...base, cors: "https://other.example" }, "GetMap", "https://map0.net").level).toBe("warn");
    expect(corsFinding({ ...base, error: "boom" }, "GetMap", "https://map0.net").level).toBe("info");
  });
});
