import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeConfig, type LayerDef } from "@map0/schema";
import { ensurePmtilesProtocol } from "./adapters/vector.js";
import { decodeTile, tileAt, tileUrl, tileZoom } from "./adapters/vector-tile.js";
import { LayerManager } from "./layers.js";
import { fakeMap } from "./testing/fake-map.js";
import { encodeMvt, rangeResponse, wholeTile, writePmtiles } from "./testing/vector-tiles.mjs";

async function mounted(layers: LayerDef[]) {
  const map = fakeMap();
  const manager = new LayerManager(map as never, normalizeConfig({ version: 1, basemaps: [{ type: "empty" }], layers }));
  await manager.mountAll({ map: map as never, accent: "#123456" });
  /* the filter of every MapLibre layer a map0 layer owns, in style order */
  const filters = (id: string) =>
    manager.all.find((a) => a.def.id === id)!.layerIds.map((l) => map.getFilter(l) ?? null);
  return { map, manager, filters };
}

const NOTHING = ["==", ["get", "number"], -1];
const SELECTED = ["in", ["get", "number"], ["literal", [17, 23]]];
const OWN = ["==", ["get", "kind"], "field"];

const parcels: LayerDef = {
  type: "vector",
  id: "parcels",
  title: "Parcels",
  url: "https://tiles.test/{z}/{x}/{y}.pbf",
  sourceLayer: "parcels",
  style: [
    { type: "fill", filter: OWN, paint: { "fill-color": "#ccc" } },
    { type: "line", paint: { "line-color": "#333" } },
    { type: "line", id: "selected", filter: NOTHING, paint: { "line-color": "#d6246e" } },
    { type: "line", id: "highlighted", filter: NOTHING, paint: { "line-color": "#111" } },
  ],
};

describe("api.layers.setFilter", () => {
  it("combines the filter with each style layer's own, and null restores the own", async () => {
    const { manager, filters } = await mounted([parcels]);
    expect(manager.setFilter("parcels", SELECTED)).toBe(true);
    expect(filters("parcels")).toEqual([
      ["all", OWN, SELECTED],
      SELECTED,
      ["all", NOTHING, SELECTED],
      ["all", NOTHING, SELECTED],
    ]);
    expect(manager.setFilter("parcels", null)).toBe(true);
    expect(filters("parcels")).toEqual([OWN, null, NOTHING, NOTHING]);
  });

  it("reaches one style layer by its config id, and replaces its own filter on request", async () => {
    const { manager, filters } = await mounted([parcels]);
    /* a filter that matches nothing until the host selects: combining would keep it matching nothing */
    expect(manager.setFilter("parcels", SELECTED, { styleLayer: "selected", replace: true })).toBe(true);
    expect(filters("parcels")).toEqual([OWN, null, SELECTED, NOTHING]);
    expect(manager.setFilter("parcels", null, { styleLayer: "selected" })).toBe(true);
    expect(filters("parcels")).toEqual([OWN, null, NOTHING, NOTHING]);
  });

  it("filters style layers that share an id together", async () => {
    /* the validator only warns about a repeated id: pasted style layers must not keep a map from loading */
    const { manager, filters } = await mounted([
      {
        ...parcels,
        style: [
          { type: "fill", id: "selected", filter: NOTHING, paint: { "fill-color": "#d6246e" } },
          { type: "line", paint: { "line-color": "#333" } },
          { type: "line", id: "selected", filter: NOTHING, paint: { "line-color": "#d6246e" } },
        ],
      } as LayerDef,
    ]);
    expect(manager.setFilter("parcels", SELECTED, { styleLayer: "selected", replace: true })).toBe(true);
    expect(filters("parcels")).toEqual([SELECTED, null, SELECTED]);
  });

  it("works on a layer added at runtime", async () => {
    const { manager, filters } = await mounted([]);
    const id = await manager.addLayer({ ...parcels, id: "parcels-2024" } as never);
    expect(id).toBe("parcels-2024");
    expect(manager.setFilter("parcels-2024", SELECTED, { styleLayer: "highlighted", replace: true })).toBe(true);
    expect(filters("parcels-2024")[3]).toEqual(SELECTED);
  });

  it("keeps map0's own geometry filters on the default GeoJSON styling", async () => {
    const { manager, filters } = await mounted([
      { type: "geojson", id: "pois", title: "POIs", data: { type: "FeatureCollection", features: [] } },
    ]);
    expect(manager.setFilter("pois", SELECTED)).toBe(true);
    expect(filters("pois")).toEqual([
      ["all", ["==", ["geometry-type"], "Polygon"], SELECTED],
      ["all", ["==", ["geometry-type"], "LineString"], SELECTED],
      ["all", ["==", ["geometry-type"], "Point"], SELECTED],
    ]);
  });

  it("keeps them when the host asks to replace: there is no configured filter to replace", async () => {
    const { manager, filters } = await mounted([
      { type: "geojson", id: "pois", title: "POIs", data: { type: "FeatureCollection", features: [] } },
    ]);
    expect(manager.setFilter("pois", SELECTED, { replace: true })).toBe(true);
    /* without its geometry filter the circle layer would draw every vertex of a polygon */
    expect(filters("pois")).toEqual([
      ["all", ["==", ["geometry-type"], "Polygon"], SELECTED],
      ["all", ["==", ["geometry-type"], "LineString"], SELECTED],
      ["all", ["==", ["geometry-type"], "Point"], SELECTED],
    ]);
    expect(manager.setFilter("pois", null)).toBe(true);
    expect(filters("pois")).toEqual([
      ["==", ["geometry-type"], "Polygon"],
      ["==", ["geometry-type"], "LineString"],
      ["==", ["geometry-type"], "Point"],
    ]);
  });

  describe("on a clustered layer", () => {
    const clustered: LayerDef = {
      type: "geojson",
      id: "pois",
      title: "POIs",
      cluster: true,
      data: { type: "FeatureCollection", features: [] },
    };
    const above: LayerDef = { ...parcels, id: "above" };
    const source = (map: Awaited<ReturnType<typeof mounted>>["map"]) =>
      map.getSource("m0s-pois") as { cluster?: boolean; filter?: unknown };

    it("filters the source, before the clustering, and leaves the style layers alone", async () => {
      const { map, manager, filters } = await mounted([clustered]);
      const before = filters("pois");
      expect(manager.setFilter("pois", SELECTED)).toBe(true);
      expect(source(map)).toMatchObject({ cluster: true, filter: SELECTED });
      /* the bubbles included: on the style layers the filter would hide every one of them */
      expect(filters("pois")).toEqual(before);
      expect(manager.setFilter("pois", null)).toBe(true);
      expect(source(map)).not.toHaveProperty("filter");
    });

    it("puts the style layers back where they were in the stack, as they were", async () => {
      /* drawn bottom-up: "above" is configured first, so it lies on top */
      const { map, manager } = await mounted([above, clustered]);
      const order = map.getLayersOrder();
      const bubbles = order.find((id) => id.endsWith("-cluster"))!;
      expect(order.indexOf(bubbles)).toBeLessThan(order.indexOf("m0l-above-0"));
      expect(manager.setFilter("pois", SELECTED)).toBe(true);
      expect(map.getLayersOrder()).toEqual(order);
      expect(map.getFilter(bubbles)).toEqual(expect.arrayContaining(["all"]));
    });

    it("answers false and keeps the previous source when MapLibre refuses the filter", async () => {
      const { map, manager } = await mounted([clustered]);
      expect(manager.setFilter("pois", SELECTED)).toBe(true);
      const order = map.getLayersOrder();
      /* MapLibre validates the source, reports an error event and adds nothing */
      const addSource = map.addSource;
      map.addSource = (id: string, spec: unknown) => {
        if ((spec as { filter?: unknown[] }).filter?.[0] !== "no-such-operator") addSource(id, spec);
      };
      expect(manager.setFilter("pois", ["no-such-operator"])).toBe(false);
      expect(source(map)).toMatchObject({ cluster: true, filter: SELECTED });
      expect(map.getLayersOrder()).toEqual(order);
    });

    it("still filters one named style layer on the style layer", async () => {
      const { map, manager, filters } = await mounted([
        { ...clustered, style: [{ type: "circle", id: "dots", paint: { "circle-radius": 4 } }] },
      ]);
      expect(manager.setFilter("pois", SELECTED, { styleLayer: "dots" })).toBe(true);
      expect(filters("pois")).toEqual([SELECTED]);
      expect(source(map)).not.toHaveProperty("filter");
    });
  });

  it("answers false and changes nothing when there is nothing to filter", async () => {
    const { manager, filters } = await mounted([
      parcels,
      { type: "raster", id: "ortho", title: "Ortho", url: "https://tiles.test/ortho/{z}/{x}/{y}.png" },
    ]);
    expect(manager.setFilter("nope", SELECTED)).toBe(false);
    expect(manager.setFilter("ortho", SELECTED)).toBe(false);
    expect(manager.setFilter("parcels", SELECTED, { styleLayer: "typo" })).toBe(false);
    expect(filters("parcels")).toEqual([OWN, null, NOTHING, NOTHING]);
  });

  it("answers false when MapLibre rejects the filter", async () => {
    const { map, manager } = await mounted([parcels]);
    /* MapLibre validates, reports an error event and keeps the old filter */
    map.setFilter.mockImplementation(() => {});
    expect(manager.setFilter("parcels", ["no-such-operator"], { styleLayer: "selected" })).toBe(false);
  });
});

describe("tile math", () => {
  it("finds the tile containing a position, wrapping longitudes and clamping latitudes", () => {
    expect(tileAt([13.405, 52.52], 10)).toEqual({ x: 550, y: 335 });
    expect(tileAt({ lng: 13.405 + 360, lat: 52.52 }, 10)).toEqual({ x: 550, y: 335 });
    expect(tileAt([0, 0], 0)).toEqual({ x: 0, y: 0 });
    expect(tileAt([179.9999, 89], 3)).toEqual({ x: 7, y: 0 });
    expect(tileAt([-180, -89], 3)).toEqual({ x: 0, y: 7 });
  });

  it("rounds the zoom down and holds it inside the source's range", () => {
    expect(tileZoom(12.99)).toBe(12);
    expect(tileZoom(16, 0, 14)).toBe(14);
    expect(tileZoom(3, 5, 14)).toBe(5);
    expect(tileZoom(-2)).toBe(0);
  });

  it("picks a subdomain template the way MapLibre does", () => {
    const templates = ["https://a.test/{z}/{x}/{y}", "https://b.test/{z}/{x}/{y}"];
    expect(tileUrl(templates, 14, 8936, 5681)).toBe("https://b.test/14/8936/5681");
    expect(tileUrl(templates, 14, 8936, 5680)).toBe("https://a.test/14/8936/5680");
  });

  it("fills in the other placeholders MapLibre knows, and counts rows from the south for TMS", () => {
    expect(tileUrl(["https://t.test/{z}/{x}/{y}"], 3, 3, 5, "tms")).toBe("https://t.test/3/3/2");
    expect(tileUrl(["https://t.test/{quadkey}"], 3, 3, 5)).toBe("https://t.test/213");
    expect(tileUrl(["https://t.test/{prefix}/{z}/{x}/{y}{ratio}"], 14, 8936, 5681)).toBe("https://t.test/81/14/8936/5681");
    /* the north-west quadrant of the world, west,south,east,north in metres */
    expect(tileUrl(["https://t.test/?bbox={bbox-epsg-3857}"], 1, 0, 0)).toBe(
      "https://t.test/?bbox=-20037508.342789244,0,0,20037508.342789244",
    );
  });

  it("refuses a position that is not two numbers instead of answering with an empty tile", () => {
    expect(() => tileAt([16.36, Number.NaN], 14)).toThrow(RangeError);
    expect(() => tileAt({ lng: undefined as never, lat: 48.2 }, 14)).toThrow(/lngLat must be two numbers/);
  });
});

const PARCEL_TILE = { z: 14, x: 8936, y: 5681 };
/* inside tile 14/8936/5681 */
const IN_TILE: [number, number] = [16.3586, 48.2027];

function parcelTile() {
  return encodeMvt([
    {
      name: "parcels",
      features: [
        { id: 1, type: 3, properties: { number: 17, kind: "field", area: 1.5 }, rings: wholeTile() },
        { id: 2, type: 3, properties: { number: 23, kind: "meadow" }, rings: [[[0, 0], [100, 0], [100, 100], [0, 100]]] },
      ],
    },
    { name: "labels", features: [{ type: 1, properties: { name: "A" }, rings: [[[2048, 2048]]] }] },
  ]);
}

describe("decodeTile", () => {
  it("returns GeoJSON in WGS84, tagged with the source layer", () => {
    const features = decodeTile(parcelTile(), PARCEL_TILE);
    expect(features.map((f) => [f.sourceLayer, f.id, f.properties])).toEqual([
      ["parcels", 1, { number: 17, kind: "field", area: 1.5 }],
      ["parcels", 2, { number: 23, kind: "meadow" }],
      ["labels", undefined, { name: "A" }],
    ]);
    /* a polygon over the whole tile is the tile's extent */
    const ring = (features[0]!.geometry as GeoJSON.Polygon).coordinates[0]!;
    const lngs = ring.map((p) => p[0]!);
    const lats = ring.map((p) => p[1]!);
    expect(Math.min(...lngs)).toBeCloseTo(16.3477, 3);
    expect(Math.max(...lngs)).toBeCloseTo(16.3696, 3);
    expect(Math.min(...lats)).toBeCloseTo(48.1954, 3);
    expect(Math.max(...lats)).toBeCloseTo(48.21, 3);
    expect(tileAt([Math.min(...lngs) + 1e-6, Math.max(...lats) - 1e-6], 14)).toEqual({ x: 8936, y: 5681 });
  });

  it("reads one source layer, and leaves the geometry out when asked to", () => {
    const features = decodeTile(parcelTile(), PARCEL_TILE, { sourceLayer: "parcels", geometry: false });
    expect(features).toEqual([
      { type: "Feature", id: 1, geometry: null, properties: { number: 17, kind: "field", area: 1.5 }, sourceLayer: "parcels" },
      { type: "Feature", id: 2, geometry: null, properties: { number: 23, kind: "meadow" }, sourceLayer: "parcels" },
    ]);
    expect(decodeTile(parcelTile(), PARCEL_TILE, { sourceLayer: "missing" })).toEqual([]);
  });
});

describe("api.layers.getTile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** a fetch that serves `files` (Range requests included) and records every request */
  function serve(files: Record<string, Uint8Array | object>) {
    const requests: Array<{ url: string; range: string | null }> = [];
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const range = new Headers(init?.headers).get("range");
      requests.push({ url, range });
      const file = files[url];
      if (!file) return new Response("not found", { status: 404 });
      if (!(file instanceof Uint8Array)) return Response.json(file);
      const { status, headers, body } = rangeResponse(file, range);
      return new Response(body as BodyInit, { status, headers });
    });
    vi.stubGlobal("fetch", fetch);
    return requests;
  }

  const vectorLayer = (id: string, url: string): LayerDef => ({
    type: "vector",
    id,
    title: id,
    url,
    sourceLayer: "parcels",
    style: [{ type: "fill", paint: { "fill-color": "#ccc" } }],
  });

  it("reads a PMTiles archive through the instance the map already opened", async () => {
    const url = "https://tiles.test/shared.pmtiles";
    const requests = serve({ [url]: writePmtiles({ "14/8936/5681": parcelTile() }, { minZoom: 6, maxZoom: 14 }) });
    const { manager } = await mounted([vectorLayer("parcels", `pmtiles://${url}`)]);

    /* what MapLibre does on its own: TileJSON, then a tile — header and root directory read once */
    const protocol = await ensurePmtilesProtocol();
    await protocol.tilev4({ url: `pmtiles://${url}`, type: "json" } as never, new AbortController());
    await protocol.tilev4({ url: `pmtiles://${url}/14/8936/5681`, type: "arrayBuffer" } as never, new AbortController());
    const before = requests.length;

    const tile = await manager.getTile("parcels", { zoom: 17.4, lngLat: { lng: IN_TILE[0], lat: IN_TILE[1] }, sourceLayer: "parcels" });
    expect(tile).toMatchObject({ z: 14, x: 8936, y: 5681 });
    expect(tile!.features.map((f) => f.properties!.number)).toEqual([17, 23]);
    /* only the tile's own bytes were fetched — no second header or directory */
    expect(requests.slice(before)).toHaveLength(1);
    expect(requests.filter((r) => r.range?.startsWith("bytes=0-"))).toHaveLength(1);
  });

  it("opens the archive itself for a layer the map has not drawn yet, and hands it to the map", async () => {
    const url = "https://tiles.test/hidden.pmtiles";
    serve({ [url]: writePmtiles({ "14/8936/5681": parcelTile() }, { minZoom: 6, maxZoom: 14 }) });
    const { manager } = await mounted([{ ...vectorLayer("hidden", `pmtiles://${url}`), visible: false }]);
    const tile = await manager.getTile("hidden", { zoom: 14, lngLat: IN_TILE, geometry: false });
    expect(tile!.features).toHaveLength(3);
    expect((await ensurePmtilesProtocol()).get(url)).toBeDefined();
  });

  it("returns no features for a tile the archive does not have", async () => {
    const url = "https://tiles.test/sparse.pmtiles";
    serve({ [url]: writePmtiles({ "14/8936/5681": parcelTile() }, { minZoom: 6, maxZoom: 14 }) });
    const { manager } = await mounted([vectorLayer("sparse", `pmtiles://${url}`)]);
    expect(await manager.getTile("sparse", { zoom: 14, lngLat: [0, 0] })).toEqual({ z: 14, x: 8192, y: 8192, features: [] });
  });

  it("rejects an archive that holds no Mapbox Vector Tiles", async () => {
    const url = "https://tiles.test/mlt.pmtiles";
    serve({ [url]: writePmtiles({ "14/8936/5681": new Uint8Array([1, 2, 3]) }, { minZoom: 6, maxZoom: 14, tileType: 6 }) });
    const { manager } = await mounted([vectorLayer("mlt", `pmtiles://${url}`)]);
    await expect(manager.getTile("mlt", { zoom: 14, lngLat: IN_TILE })).rejects.toThrow(/Mlt, not Mapbox Vector Tiles/);
  });

  it("fetches from a tile template, gzip or not, and treats a 404 as an empty tile", async () => {
    const gzipped = new Uint8Array(
      await new Response(new Blob([parcelTile() as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
    );
    serve({ "https://tiles.test/14/8936/5681.pbf": gzipped });
    const { manager } = await mounted([vectorLayer("xyz", "https://tiles.test/{z}/{x}/{y}.pbf")]);
    const tile = await manager.getTile("xyz", { zoom: 14, lngLat: IN_TILE, sourceLayer: "parcels" });
    expect(tile!.features.map((f) => f.properties!.number)).toEqual([17, 23]);
    expect(await manager.getTile("xyz", { zoom: 14, lngLat: [0, 0] })).toMatchObject({ features: [] });
  });

  it("caps the zoom at a TileJSON's maxzoom", async () => {
    serve({
      "https://tiles.test/tiles.json": { tiles: ["https://tiles.test/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 12 },
      "https://tiles.test/12/2234/1420.pbf": parcelTile(),
    });
    const { manager } = await mounted([vectorLayer("tj", "https://tiles.test/tiles.json")]);
    const tile = await manager.getTile("tj", { zoom: 15, lngLat: IN_TILE });
    expect(tile).toMatchObject({ z: 12, x: 2234, y: 1420 });
    expect(tile!.features).toHaveLength(3);
  });

  it("reads a TMS pyramid the way the map does: the source keeps the scheme, the row is counted from the south", async () => {
    serve({
      "https://tiles.test/tms.json": { tiles: ["https://tiles.test/tms/{z}/{x}/{y}.pbf"], scheme: "tms", maxzoom: 14 },
      [`https://tiles.test/tms/14/8936/${2 ** 14 - 1 - 5681}.pbf`]: parcelTile(),
    });
    const { map, manager } = await mounted([vectorLayer("tms", "https://tiles.test/tms.json")]);
    expect(map.getSource("m0s-tms")).toMatchObject({ scheme: "tms" });
    const tile = await manager.getTile("tms", { zoom: 14, lngLat: IN_TILE });
    /* the answer names the tile in XYZ terms, like everything else in the API */
    expect(tile).toMatchObject(PARCEL_TILE);
    expect(tile!.features).toHaveLength(3);
  });

  it("answers null for layers without tiles to read", async () => {
    serve({});
    const { manager } = await mounted([
      { type: "geojson", id: "pois", title: "POIs", data: { type: "FeatureCollection", features: [] } },
    ]);
    expect(await manager.getTile("pois", { zoom: 14, lngLat: IN_TILE })).toBeNull();
    expect(await manager.getTile("nope", { zoom: 14, lngLat: IN_TILE })).toBeNull();
  });
});
