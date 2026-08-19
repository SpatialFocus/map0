import { describe, expect, it, vi } from "vitest";
import {
  buildGetFeatureInfoUrl,
  buildLegendUrl,
  buildWmsTileUrl,
  normalizeLegendUrl,
  WmsAdapter,
} from "./adapters/wms.js";
import { buildCogUrl, cogLegendEntries } from "./adapters/cog.js";
import { expandSimpleStyle } from "./adapters/geojson.js";
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
