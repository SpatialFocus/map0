import { describe, expect, it } from "vitest";
import { validateConfig, type Map0Config } from "@map0/schema";
import { I18N_DE_KEYS, I18N_KEYS } from "./i18n.js";
import {
  BASEMAP_PRESETS,
  BLANK_CONFIG,
  STARTER_CONFIG,
  cleanConfig,
  collectIds,
  duplicateLayer,
  embedSnippet,
  flattenLayers,
  getLayer,
  indentLayer,
  insertLayer,
  moveLayer,
  outdentLayer,
  paramsToText,
  removeLayer,
  serializeConfig,
  setKey,
  slugId,
  textToParams,
  textToTuple,
  updateLayer,
} from "./state.js";

const tree: Map0Config = {
  version: 1,
  basemaps: [{ type: "empty" }],
  layers: [
    { type: "geojson", id: "a", title: "A", data: "https://x/a.geojson" },
    {
      type: "group",
      title: "G",
      children: [
        { type: "geojson", id: "b", title: "B", data: "https://x/b.geojson" },
        { type: "geojson", id: "c", title: "C", data: "https://x/c.geojson" },
      ],
    },
    { type: "geojson", id: "d", title: "D", data: "https://x/d.geojson" },
  ],
};

const ids = (cfg: Map0Config): string[] =>
  flattenLayers(cfg).map((r) => ("id" in r.def && r.def.id ? r.def.id : r.def.type === "group" ? `[${r.def.title}]` : "?"));

describe("starter configs", () => {
  it("validate", () => {
    expect(validateConfig(cleanConfig(STARTER_CONFIG)).valid).toBe(true);
    expect(validateConfig(cleanConfig(BLANK_CONFIG)).valid).toBe(true);
  });

  it("every basemap preset validates inside a config", () => {
    for (const preset of BASEMAP_PRESETS) {
      const result = validateConfig(cleanConfig({ version: 1, basemaps: [preset.def] }));
      expect(result.errors, preset.id).toEqual([]);
    }
  });
});

describe("tree operations", () => {
  it("addresses nodes by index path", () => {
    expect(getLayer(tree, [1, 1])).toMatchObject({ id: "c" });
    expect(getLayer(tree, [5])).toBeUndefined();
    expect(getLayer(tree, [0, 0])).toBeUndefined(); // not a group
  });

  it("updates without touching the rest of the tree", () => {
    const next = updateLayer(tree, [1, 0], (d) => ({ ...d, title: "B2" }));
    expect(getLayer(next, [1, 0])).toMatchObject({ title: "B2" });
    expect(next.layers![0]).toBe(tree.layers![0]); // structural sharing
    expect(tree.layers![1]).toMatchObject({ children: [{ title: "B" }, { title: "C" }] });
  });

  it("removes and inserts", () => {
    expect(ids(removeLayer(tree, [1, 0]))).toEqual(["a", "[G]", "c", "d"]);
    const inserted = insertLayer(tree, [1], { type: "geojson", id: "e", data: "https://x/e" }, 0);
    expect(ids(inserted)).toEqual(["a", "[G]", "e", "b", "c", "d"]);
    expect(ids(insertLayer(tree, [], { type: "geojson", id: "top", data: "https://x/t" }, 0))[0]).toBe("top");
  });

  it("moves within siblings and stops at the ends", () => {
    const down = moveLayer(tree, [0], 1);
    expect(ids(down.config)).toEqual(["[G]", "b", "c", "a", "d"]);
    expect(down.path).toEqual([1]);
    const stuck = moveLayer(tree, [0], -1);
    expect(stuck.config).toBe(tree);
  });

  it("indents into the group above and outdents after it", () => {
    const indented = indentLayer(tree, [2]);
    expect(ids(indented!.config)).toEqual(["a", "[G]", "b", "c", "d"]);
    expect(indented!.path).toEqual([1, 2]);
    expect(indentLayer(tree, [1])).toBeNull(); // nothing groupish above "G"

    const outdented = outdentLayer(tree, [1, 0]);
    expect(ids(outdented!.config)).toEqual(["a", "[G]", "c", "b", "d"]);
    expect(outdented!.path).toEqual([2]);
    expect(outdentLayer(tree, [0])).toBeNull();
  });

  it("duplicates with a fresh id", () => {
    const next = duplicateLayer(tree, [0]);
    expect(ids(next).slice(0, 2)).toEqual(["a", "a-copy"]);
    expect(collectIds(next).size).toBe(5);
  });
});

describe("ids", () => {
  it("slugifies titles and keeps them unique", () => {
    expect(slugId("Flächenwidmung 2024", new Set())).toBe("flaechenwidmung-2024");
    expect(slugId("Zoning plan", new Set(["zoning-plan"]))).toBe("zoning-plan-2");
    expect(slugId("!!!", new Set())).toBe("layer");
  });
});

describe("values", () => {
  it("setKey drops blank values but keeps empty objects", () => {
    expect(setKey({ a: 1 }, "a", "")).toEqual({});
    expect(setKey({ a: 1 }, "b", Number.NaN)).toEqual({ a: 1 });
    expect(setKey({}, "popup", {})).toEqual({ popup: {} });
  });

  it("round-trips params and tuples", () => {
    expect(textToParams("cql_filter=BEZ=1\n\nTIME=2024")).toEqual({ cql_filter: "BEZ=1", TIME: "2024" });
    expect(paramsToText({ a: "1", b: "x=y" })).toBe("a=1\nb=x=y");
    expect(textToParams("")).toBeUndefined();
    expect(textToTuple("16.1, 48.1, 16.6, 48.3", 4)).toEqual([16.1, 48.1, 16.6, 48.3]);
    expect(textToTuple("16.1, 48.1", 4)).toBeUndefined();
  });
});

describe("output", () => {
  it("prunes empties, orders keys and puts $schema first", () => {
    const cfg: Map0Config = {
      version: 1,
      theme: {},
      meta: { title: "" },
      basemaps: [{ type: "empty", title: "" }],
      layers: [
        { type: "wms", url: "https://x/wms", layers: "a", title: "T", info: {}, params: {} } as never,
        { type: "geojson", data: "https://x/a", popup: {}, style: {} } as never,
      ],
      search: {},
    };
    const cleaned = cleanConfig(cfg);
    expect(Object.keys(cleaned)).toEqual(["$schema", "version", "basemaps", "layers", "search"]);
    expect(cleaned.layers![0]).toEqual({ type: "wms", title: "T", url: "https://x/wms", layers: "a", info: {} });
    expect(cleaned.layers![1]).toEqual({ type: "geojson", data: "https://x/a", popup: {} });
    expect(validateConfig(cleaned).valid).toBe(true);
  });

  it("drops an empty layer list", () => {
    expect(cleanConfig({ version: 1, basemaps: [{ type: "empty" }], layers: [] }).layers).toBeUndefined();
  });

  it("serializes the embed snippet around the config", () => {
    const snippet = embedSnippet(BLANK_CONFIG, "https://cdn/map0.js", "400px");
    expect(snippet).toContain('<script type="module" src="https://cdn/map0.js"></script>');
    expect(snippet).toContain('<map0-viewer style="height:400px">');
    expect(snippet).toContain(serializeConfig(BLANK_CONFIG).split("\n")[0]);
  });
});

describe("i18n", () => {
  it("German covers every English key", () => {
    const missing = I18N_KEYS.filter((k) => !I18N_DE_KEYS.includes(k));
    const stale = I18N_DE_KEYS.filter((k) => !I18N_KEYS.includes(k));
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });
});
