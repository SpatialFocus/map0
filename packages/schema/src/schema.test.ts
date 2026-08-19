import { describe, expect, it } from "vitest";
import { mergeConfigs, normalizeConfig, resolveConfigExtends, validateConfig } from "./index.js";
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

  it("accepts a cog layer with a color ramp", () => {
    const r = validateConfig({
      ...minimal,
      layers: [
        {
          type: "cog",
          url: "https://example.org/data.tif",
          color: { scheme: "BrewerSpectral7", min: 1.7, max: 1.8, continuous: true },
        },
      ],
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags a broken cog layer with precise paths", () => {
    const r = validateConfig({
      ...minimal,
      layers: [{ type: "cog", color: { min: 5, max: 5, continuous: "yes" } }],
    });
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("$.layers[0].url");
    expect(paths).toContain("$.layers[0].color.scheme");
    expect(paths).toContain("$.layers[0].color.max"); // max must be > min
    expect(paths).toContain("$.layers[0].color.continuous");
  });

  it("rejects unknown layer types", () => {
    const r = validateConfig({ ...minimal, layers: [{ type: "wfs", url: "x" }] });
    expect(r.errors.some((e) => e.path === "$.layers[0].type")).toBe(true);
  });
});

describe("extends (C6)", () => {
  it("merges objects deep, child wins, arrays replace", () => {
    const base = {
      basemaps: [{ type: "style", url: "https://base.example/s.json" }],
      theme: { primary: "#0e7490", radius: "md" },
      i18n: { locale: "de" },
    };
    const child = {
      version: 1,
      theme: { primary: "#7c3aed" },
      basemaps: [{ type: "empty" }],
    };
    const merged = mergeConfigs(base, child);
    expect(merged.version).toBe(1);
    expect(merged.theme).toEqual({ primary: "#7c3aed", radius: "md" }); // deep merge
    expect(merged.basemaps).toEqual([{ type: "empty" }]); // arrays replace
    expect(merged.i18n).toEqual({ locale: "de" }); // inherited
  });

  it("resolves a chain with relative URLs and strips the extends key", async () => {
    const files: Record<string, unknown> = {
      "https://sdi.example/configs/map.json": {
        version: 1,
        extends: "./org.json",
        theme: { primary: "#111111" },
      },
      "https://sdi.example/configs/org.json": {
        extends: "/global.json",
        theme: { primary: "#222222", radius: "lg" },
        i18n: { locale: "de" },
      },
      "https://sdi.example/global.json": {
        basemaps: [{ type: "style", url: "https://sdi.example/style.json" }],
        theme: { font: "Inter" },
      },
    };
    const fetchImpl = (async (url: string) => ({
      ok: true,
      url,
      json: async () => files[url],
    })) as never;
    const merged = (await resolveConfigExtends(files["https://sdi.example/configs/map.json"], {
      baseUrl: "https://sdi.example/configs/map.json",
      fetchImpl,
    })) as Record<string, unknown>;
    expect(merged.extends).toBeUndefined();
    expect(merged.version).toBe(1);
    expect(merged.theme).toEqual({ primary: "#111111", radius: "lg", font: "Inter" });
    expect(merged.i18n).toEqual({ locale: "de" });
    expect(Array.isArray(merged.basemaps)).toBe(true);
  });

  it("detects cycles", async () => {
    const files: Record<string, unknown> = {
      "https://e.org/a.json": { extends: "./b.json", version: 1 },
      "https://e.org/b.json": { extends: "./a.json" },
    };
    const fetchImpl = (async (url: string) => ({ ok: true, url, json: async () => files[url] })) as never;
    await expect(
      resolveConfigExtends(files["https://e.org/a.json"], {
        baseUrl: "https://e.org/a.json",
        fetchImpl,
      }),
    ).rejects.toThrow(/cycle/);
  });

  it("passes through configs without extends untouched", async () => {
    const cfg = { version: 1, basemaps: [] };
    expect(await resolveConfigExtends(cfg)).toBe(cfg);
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

/* ---- review findings R1/R3: the config as a system boundary ---- */

describe("validateConfig — invariants (R3)", () => {
  it("rejects duplicate explicit ids across basemaps and layers", () => {
    const r = validateConfig({
      ...minimal,
      basemaps: [{ type: "empty", id: "base" }],
      layers: [
        { type: "raster", id: "dup", url: "https://e.org/{z}/{x}/{y}.png" },
        { type: "group", children: [{ type: "raster", id: "dup", url: "https://e.org/a/{z}/{x}/{y}.png" }] },
        { type: "raster", id: "base", url: "https://e.org/b/{z}/{x}/{y}.png" },
      ],
    });
    expect(r.valid).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("$.layers[1].children[0].id");
    expect(paths).toContain("$.layers[2].id");
  });

  it("warns about unknown keys but still opens the map (C5)", () => {
    const r = validateConfig({
      ...minimal,
      contorls: { navigation: false },
      layers: [{ type: "raster", url: "https://e.org/{z}/{x}/{y}.png", opactiy: 0.5 }],
    });
    expect(r.valid).toBe(true); // forward-compatible parsing: reported, not fatal
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.path)).toEqual(
      expect.arrayContaining(["$.contorls", "$.layers[0].opactiy"]),
    );
  });

  it("enforces the https policy (N6) but allows loopback and relative URLs", () => {
    const bad = validateConfig({
      ...minimal,
      basemaps: [{ type: "raster", url: "http://tiles.example.org/{z}/{x}/{y}.png" }],
    });
    expect(bad.errors.some((e) => e.path === "$.basemaps[0].url")).toBe(true);

    const ok = validateConfig({
      version: 1,
      basemaps: [{ type: "raster", url: "http://localhost:8080/{z}/{x}/{y}.png" }],
      layers: [{ type: "geojson", data: "./trees.geojson" }],
    });
    expect(ok.valid).toBe(true);
  });

  it("rejects javascript: URLs", () => {
    const r = validateConfig({
      ...minimal,
      layers: [{ type: "raster", url: "javascript:alert(1)" }],
    });
    expect(r.errors.some((e) => e.path === "$.layers[0].url")).toBe(true);
  });

  it("validates nested control and permalink shapes", () => {
    const r = validateConfig({
      ...minimal,
      controls: { legend: { position: "middle", open: "yes" }, scale: { unit: "furlongs" } },
      permalink: { param: "map 0" },
    });
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("$.controls.legend.position");
    expect(paths).toContain("$.controls.legend.open");
    expect(paths).toContain("$.controls.scale.unit");
    expect(paths).toContain("$.permalink.param");
  });

  it("still accepts the fully configured example shape", () => {
    const r = validateConfig({
      version: 1,
      $schema: "https://map0.example.org/schema/v1.json",
      meta: { title: "Demo" },
      map: { center: [16.37, 48.2], zoom: 12, projection: "globe", hash: false },
      basemaps: [{ type: "style", url: "https://e.org/style.json", title: "Karte", default: true }],
      layers: [
        {
          type: "group",
          title: "Umwelt",
          collapsed: true,
          children: [
            {
              type: "wms",
              url: "https://e.org/ows",
              layers: "laerm",
              info: { title: "{{name}}", fields: [{ key: "name", label: "Name" }] },
              legend: [{ label: "laut", color: "#f00", shape: "square" }],
              metadata: { url: "https://e.org/meta", title: "Metadaten" },
            },
          ],
        },
        {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: { enabled: true, radius: 40 },
          popup: { content: "<b>{{name}}</b>" },
          hover: { content: "{{name}}" },
        },
      ],
      controls: { layerSwitcher: { position: "top-right", open: "auto", allowAdd: false } },
      search: { provider: { url: "https://geo.example/api?q={query}", format: "geojson" } },
      print: { formats: ["png"], sizes: ["A4-landscape"], dpi: [150], elements: ["title"] },
      theme: { mode: "dark", primary: "#0e7490", radius: "lg" },
      i18n: { locale: "de", overrides: { de: { "layers.title": "Themen" } } },
      permalink: { param: "karte" },
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe("normalizeConfig — id namespace (R3)", () => {
  it("never generates an id that an author already used", () => {
    const n = normalizeConfig({
      version: 1,
      basemaps: [{ type: "empty", title: "Karte" }],
      layers: [
        { type: "geojson", title: "Punkte", data: "https://e.org/a.json" },
        { type: "geojson", id: "punkte", data: "https://e.org/b.json" },
      ],
    });
    const ids = [n.basemaps[0]!.id, ...n.layers.map((l) => l.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("punkte");
  });
});
