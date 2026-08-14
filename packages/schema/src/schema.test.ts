import { describe, expect, it } from "vitest";
import { normalizeConfig, validateConfig } from "./index.js";
import type { Map0Config } from "./index.js";

const minimal: Map0Config = {
  version: 1,
  basemaps: [{ type: "style", url: "https://example.org/style.json" }],
};

describe("validateConfig", () => {
  it("accepts a minimal config", () => {
    const r = validateConfig(minimal);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects non-objects with $ path", () => {
    const r = validateConfig("nope");
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.path).toBe("$");
  });

  it("requires version 1", () => {
    const r = validateConfig({ ...minimal, version: 2 });
    expect(r.errors.some((e) => e.path === "$.version")).toBe(true);
  });

  it("requires at least one basemap", () => {
    const r = validateConfig({ version: 1, basemaps: [] });
    expect(r.errors.some((e) => e.path === "$.basemaps")).toBe(true);
  });

  it("flags a wms layer without url/layers, with precise paths", () => {
    const r = validateConfig({
      ...minimal,
      layers: [{ type: "group", children: [{ type: "wms", title: "broken" }] }],
    });
    expect(r.valid).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("$.layers[0].children[0].url");
    expect(paths).toContain("$.layers[0].children[0].layers");
  });

  it("validates opacity range", () => {
    const r = validateConfig({
      ...minimal,
      layers: [{ type: "raster", url: "https://e.org/{z}/{x}/{y}.png", opacity: 2 }],
    });
    expect(r.errors.some((e) => e.path.endsWith(".opacity"))).toBe(true);
  });

  it("rejects unknown layer types", () => {
    const r = validateConfig({ ...minimal, layers: [{ type: "wfs", url: "x" }] });
    expect(r.errors.some((e) => e.path === "$.layers[0].type")).toBe(true);
  });
});

describe("normalizeConfig", () => {
  it("applies defaults for a minimal config", () => {
    const n = normalizeConfig(minimal);
    expect(n.basemaps[0]?.id).toBeTruthy();
    expect(n.defaultBasemapId).toBe(n.basemaps[0]?.id);
    expect(n.map.projection).toBe("mercator");
    expect(n.controls.navigation).toBe(true);
    expect(n.controls.basemapSwitcher).toBe(false); // only one basemap
    expect(n.theme.primary).toBeTruthy();
    expect(n.layers).toEqual([]);
  });

  it("flattens groups into ordered layers and keeps a TOC tree", () => {
    const n = normalizeConfig({
      ...minimal,
      layers: [
        {
          type: "group",
          title: "Umwelt",
          children: [
            { type: "wms", title: "Lärm", url: "https://e.org/ows", layers: "laerm" },
            { type: "geojson", title: "Bäume", data: "https://e.org/trees.json" },
          ],
        },
        { type: "raster", title: "Overlay", url: "https://e.org/{z}/{x}/{y}.png" },
      ],
    });
    expect(n.layers.map((l) => l.title)).toEqual(["Lärm", "Bäume", "Overlay"]);
    expect(n.layers[0]?.groupPath).toEqual(["Umwelt"]);
    expect(n.layers[0]?.visible).toBe(true);
    expect(n.layers[0]?.opacity).toBe(1);
    expect(n.toc).toHaveLength(2);
    expect(n.toc[0]?.kind).toBe("group");
  });

  it("assigns unique slug ids and enables the basemap switcher for 2+ basemaps", () => {
    const n = normalizeConfig({
      version: 1,
      basemaps: [
        { type: "style", url: "https://e.org/a.json", title: "Karte" },
        { type: "raster", url: "https://e.org/{z}/{x}/{y}.jpg", title: "Ortho", default: true },
      ],
      layers: [
        { type: "geojson", title: "Punkte", data: "https://e.org/a.json" },
        { type: "geojson", title: "Punkte", data: "https://e.org/b.json" },
      ],
    });
    expect(n.defaultBasemapId).toBe("ortho");
    expect(n.controls.basemapSwitcher).not.toBe(false);
    const ids = n.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
  });
});
