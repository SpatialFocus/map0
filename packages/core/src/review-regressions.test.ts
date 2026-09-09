import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "@map0/schema";
import { BasemapManager } from "./basemaps.js";
import { LayerManager } from "./layers.js";
import { decodeShareState, encodeShareState } from "./permalink.js";
import { buildWmsTileUrl, buildGetFeatureInfoUrl } from "./adapters/wms.js";
import { buildWmtsTemplate } from "./adapters/wmts.js";
import { buildSearchUrl } from "./search.js";
import { ringArea, midpoint, centroid } from "./geodesy.js";
import { GeoJsonAdapter } from "./adapters/geojson.js";
import { VectorAdapter } from "./adapters/vector.js";
import { SourceAdapter } from "./adapters/types.js";
import { registerAdapter } from "./adapters/registry.js";

afterEach(() => vi.unstubAllGlobals());

describe("shared state validation", () => {
  it.each([
    { v: [0, 100, 3] }, { v: [0, 0, "3"] }, { v: [0, 0, null] },
    { v: [0, 0, 3], l: { trees: null } }, { v: [0, 0, 3], l: { trees: [1, 150] } },
    { v: [0, 0, 3], u: {} }, { v: [0, 0, 3], b: [] },
  ])("ignores malformed shared state %j", state => {
    expect(decodeShareState(encodeShareState(state as never))).toBeNull();
  });
  it("accepts valid state, including wrapped longitudes", () => {
    const state = { v: [540, 48, 3, -30, 45], l: { trees: [0, 35] }, u: [] };
    expect(decodeShareState(encodeShareState(state as never))).toEqual(state);
  });
});

describe("service request parameters", () => {
  const def = { url: "https://example.org/ows?request=GetCapabilities&bbox=old&srs=EPSG:4326&map=at#details", layers: "trees" };
  it("replaces pasted WMS operation keys and puts the tile bbox before the fragment", () => {
    const raw = buildWmsTileUrl(def);
    const url = new URL(raw);
    const entries = [...url.searchParams].map(([k, v]) => [k.toUpperCase(), v]);
    expect(entries.filter(([k]) => k === "REQUEST")).toEqual([["REQUEST", "GetMap"]]);
    expect(entries.filter(([k]) => k === "BBOX")).toEqual([["BBOX", "{bbox-epsg-3857}"]]);
    expect(entries.some(([k]) => k === "SRS")).toBe(false);
    expect(url.searchParams.get("map")).toBe("at");
    expect(raw).toContain("BBOX={bbox-epsg-3857}#details");
  });
  it("lets differently cased explicit WMS params override generated values", () => {
    const url = new URL(buildGetFeatureInfoUrl({ ...def, params: { info_format: "text/html" } }, {
      bbox3857: [0, 0, 1, 1], size: 101, i: 50, j: 50, infoFormat: "application/json",
    }));
    expect([...url.searchParams].filter(([k]) => k.toUpperCase() === "INFO_FORMAT"))
      .toEqual([["info_format", "text/html"]]);
  });
  it("replaces WMTS KVP operation keys while preserving tokens and placeholders", () => {
    const raw = buildWmtsTemplate({ encoding: "KVP", resourceUrl: "https://example.org/wmts?request=GetCapabilities&token=abc#details",
      layer: "trees", style: "default", matrixSet: "web", format: "image/png", matrixIds: ["0", "1"] });
    const url = new URL(raw);
    expect([...url.searchParams].filter(([k]) => k.toUpperCase() === "REQUEST")).toEqual([["REQUEST", "GetTile"]]);
    expect(url.searchParams.get("token")).toBe("abc");
    expect(url.searchParams.get("TILEMATRIX")).toBe("{z}");
    expect(raw).toContain("TILEROW={y}&TILECOL={x}#details");
  });
});

it.each(["reselect", "destroy"])("cancels a pending basemap switch on %s", async action => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const cfg = normalizeConfig({ version: 1, basemaps: [{ id: "empty", type: "empty" }, { id: "slow", type: "style", url: `https://example.org/review-style-${action}.json` }] });
  const map = { setStyle: vi.fn() };
  const manager = new BasemapManager(map as never, cfg.basemaps, "empty", () => ({ layers: new Set(), sources: new Set() }), "#fff");
  const pending = manager.switchTo("slow");
  if (action === "reselect") await manager.switchTo("empty");
  else manager.destroy();
  resolve(new Response(JSON.stringify({ version: 8, sources: {}, layers: [] })));
  await pending;
  expect(manager.current.value).toBe("empty");
  expect(map.setStyle).not.toHaveBeenCalled();
});

function fakeMap() {
  const sources = new Map();
  const specs = new Map();
  return {
    on: vi.fn(), off: vi.fn(), getZoom: () => 5,
    addSource: (id: string, source: unknown) => { if (sources.has(id)) throw new Error("duplicate source"); sources.set(id, source); },
    getSource: (id: string) => sources.get(id), removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: { id: string }) => specs.set(spec.id, spec),
    getLayer: (id: string) => specs.get(id), removeLayer: (id: string) => specs.delete(id),
    setLayoutProperty: vi.fn(), setPaintProperty: vi.fn(),
  };
}

describe("runtime layers", () => {
  it("cleans up partially mounted sources when adding a layer fails", async () => {
    class FailingAdapter extends SourceAdapter {
      get sourceIds() { return [`m0s-${this.def.id}`]; }
      get layerIds() { return []; }
      protected addToMap() {
        this.ctx.map.addSource(this.sourceIds[0]!, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        throw new Error("broken style");
      }
    }
    registerAdapter("review-failure", def => new FailingAdapter(def));
    const map = fakeMap();
    const manager = new LayerManager(map as never, normalizeConfig({ version: 1, basemaps: [{ type: "empty" }] }));
    await manager.mountAll({ map: map as never, accent: "#123456" });
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await manager.addLayer({ type: "review-failure", id: "broken" } as never)).toBeNull();
      expect(map.getSource("m0s-broken")).toBeUndefined();
      expect(await manager.addLayer({ type: "geojson", id: "broken", data: { type: "FeatureCollection", features: [] } })).toBe("broken");
    } finally {
      warn.mockRestore();
      manager.destroy();
    }
  });

  it.each(["configured", "added"])("does not retain a %s layer whose load finishes after destruction", async kind => {
    let resolve!: () => void;
    class SlowAdapter extends SourceAdapter {
      get sourceIds() { return []; }
      get layerIds() { return []; }
      protected addToMap() { return new Promise<void>(r => { resolve = r; }); }
    }
    registerAdapter("review-slow", def => new SlowAdapter(def));
    const map = fakeMap();
    const cfg = normalizeConfig({ version: 1, basemaps: [{ type: "empty" }] });
    if (kind === "configured") cfg.layers = [{ type: "review-slow", id: "slow", visible: true, opacity: 1 }] as never;
    const manager = new LayerManager(map as never, cfg);
    const mounted = manager.mountAll({ map: map as never, accent: "#123456" });
    const pending = kind === "configured" ? mounted : (await mounted, manager.addLayer({ type: "review-slow" } as never));
    manager.destroy();
    resolve();
    await pending;
    expect(manager.all).toHaveLength(0);
    expect(manager.userLayerDefs).toHaveLength(0);
  });

  it("shares the current visibility and opacity of URL layers without mutating the config", async () => {
    const map = fakeMap();
    const manager = new LayerManager(map as never, normalizeConfig({ version: 1, basemaps: [{ type: "empty" }] }));
    await manager.mountAll({ map: map as never, accent: "#123456" });
    const id = await manager.addLayer({ type: "geojson", data: "/trees.json" });
    manager.setVisibility(id!, false);
    manager.setOpacity(id!, 0.35);
    expect(manager.userLayerDefs[0]).toMatchObject({ visible: false, opacity: 0.35 });
    expect(manager.all[0]!.def).toMatchObject({ visible: true, opacity: 1 });
    manager.destroy();
  });
  it("gives concurrent additions unique IDs", async () => {
    const map = fakeMap();
    const manager = new LayerManager(map as never, normalizeConfig({ version: 1, basemaps: [{ type: "empty" }] }));
    await manager.mountAll({ map: map as never, accent: "#123456" });
    const def = { type: "geojson" as const, title: "Trees", data: { type: "FeatureCollection", features: [] } };
    const ids = await Promise.all([manager.addLayer(def as never), manager.addLayer(def as never)]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);
    expect(manager.state.value.filter(s => s.userAdded)).toHaveLength(2);
    manager.destroy();
  });
  it("does not query WMS layers outside their visible zoom range", async () => {
    const map = fakeMap();
    const manager = new LayerManager(map as never, normalizeConfig({ version: 1, basemaps: [{ type: "empty" }], layers: [
      { id: "near", type: "wms", url: "https://example.org/wms", layers: "near", minZoom: 10, info: {} },
      { id: "far", type: "wms", url: "https://example.org/wms", layers: "far", maxZoom: 5, info: {} },
      { id: "visible", type: "wms", url: "https://example.org/wms", layers: "visible", minZoom: 5, maxZoom: 10, info: {} },
    ] }));
    await manager.mountAll({ map: map as never, accent: "#123456" });
    expect(manager.queryable.map(a => a.def.id)).toEqual(["visible"]);
    expect(manager.all.map(a => a.def.id)).toEqual(["near", "far", "visible"]);
    manager.destroy();
  });
});

it("resolves a relative geocoder URL against the page", () => {
  vi.stubGlobal("location", { href: "https://example.org/maps/view.html" });
  const config = normalizeConfig({ version: 1, basemaps: [{ type: "empty" }], search: { url: "../geocode" } }).search;
  expect(new URL(buildSearchUrl(config as never, "Vienna")).pathname).toBe("/geocode");
});

it("measures the same area on either side of the date line", () => {
  const ordinary = ringArea([[-1, 0], [1, 0], [1, 1], [-1, 1]]);
  const crossing = ringArea([[179, 0], [-179, 0], [-179, 1], [179, 1]]);
  expect(crossing).toBeCloseTo(ordinary, 1);
  expect(Math.abs(midpoint([179, 0], [-179, 0])[0])).toBe(180);
  expect(Math.abs(centroid([[179, 0], [-179, 0], [-179, 1], [179, 1]])[0])).toBe(180);
});

it.each(["geojson", "vector"])("preserves per-feature opacity in %s layers when the slider changes", async type => {
  const map = fakeMap();
  const expression = ["coalesce", ["get", "opacity"], 0.8];
  const def = { id: "styled", type, visible: true, opacity: 1, style: [{ type: "circle", paint: { "circle-opacity": expression } }],
    data: { type: "FeatureCollection", features: [] }, url: "https://example.org/{z}/{x}/{y}.pbf", sourceLayer: "trees" };
  const adapter = type === "geojson" ? new GeoJsonAdapter(def as never) : new VectorAdapter(def as never);
  await adapter.mount({ map: map as never, accent: "#123456" });
  adapter.applyOpacity(0.5);
  expect(map.setPaintProperty).toHaveBeenCalledWith("m0l-styled-0", "circle-opacity", ["*", expression, 0.5]);
  adapter.applyOpacity(1);
  expect(map.setPaintProperty).toHaveBeenCalledWith("m0l-styled-0", "circle-opacity", expression);
  adapter.unmount();
});
