import { describe, expect, it } from "vitest";
import { classifyProtocol, cswGetRecordsBody, layerFromLink, parseRecordsJson, recordsItemsUrl } from "./catalog.js";

describe("catalog links", () => {
  it("classifies GeoNetwork protocols and bare URLs", () => {
    expect(classifyProtocol("OGC:WMS-1.3.0-http-get-map", "https://x/wms")).toBe("wms");
    expect(classifyProtocol("OGC:WMTS", "https://x")).toBe("wmts");
    expect(classifyProtocol("OGC:WFS", "https://x")).toBe("wfs");
    expect(classifyProtocol("OGC API - Features", "https://x/ogc")).toBe("ogcapi-features");
    expect(classifyProtocol(undefined, "https://x/geoserver/ows?service=WFS&request=GetCapabilities")).toBe("wfs");
    expect(classifyProtocol("WWW:LINK-1.0-http--link", "https://x/page.html")).toBeNull();
  });

  it("builds the CSW and Records requests", () => {
    const body = cswGetRecordsBody("wald & <wiese>", 7);
    expect(body).toContain('maxRecords="7"');
    expect(body).toContain("<ogc:Literal>*wald &amp; &lt;wiese&gt;*</ogc:Literal>");
    expect(body).toContain("<ogc:PropertyName>csw:AnyText</ogc:PropertyName>");
    expect(body).toContain("<csw:ElementSetName>full</csw:ElementSetName>");
    expect(recordsItemsUrl("https://api/collections/metadata/", "wald")).toBe("https://api/collections/metadata/items?q=wald&limit=40&f=json");
    expect(recordsItemsUrl("https://api/collections/metadata/items", "x", 5)).toContain("/items?q=x&limit=5");
  });

  it("reads Records items into records with classified links", () => {
    const records = parseRecordsJson({
      features: [
        {
          id: "r1",
          properties: { title: "Forests", description: "Forest cover" },
          links: [
            { href: "https://cat/r1.html", rel: "alternate", type: "text/html" },
            { href: "https://x/wms?service=WMS", rel: "service", type: "OGC:WMS", title: "Forest WMS" },
            { href: "https://x/wms?service=WMS&request=GetCapabilities", rel: "item", type: "OGC:WMS" },
            { href: "https://x/doc.pdf", rel: "describedby", type: "application/pdf" },
          ],
        },
      ],
    });
    expect(records).toEqual([
      {
        id: "r1",
        title: "Forests",
        abstract: "Forest cover",
        links: [{ kind: "wms", url: "https://x/wms?service=WMS", label: "Forest WMS" }],
        landing: "https://cat/r1.html",
      },
    ]);
  });

  it("turns a named link into a layer and leaves bare services to the picker", () => {
    const record = { id: "r", title: "Forests", links: [], landing: "https://cat/r.html" };
    expect(layerFromLink(record, { kind: "wms", url: "https://x/wms?SERVICE=WMS&REQUEST=GetCapabilities", name: "forest" })).toEqual({
      type: "wms",
      url: "https://x/wms",
      layers: "forest",
      info: {},
      title: "Forests",
      metadata: { url: "https://cat/r.html", title: "Forests" },
    });
    expect(layerFromLink(record, { kind: "wfs", url: "https://x/wfs", name: "ns:forest" })).toMatchObject({ type: "wfs", typeNames: "ns:forest" });
    expect(layerFromLink(record, { kind: "wms", url: "https://x/wms" })).toBeNull();
  });
});
