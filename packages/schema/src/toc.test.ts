import { describe, expect, it } from "vitest";
import {
  exclusiveRivals,
  normalizeConfig,
  tocShowIds,
  tocVisibility,
  validateConfig,
  type LayerDef,
  type TocNode,
} from "./index.js";

const layer = (id: string, visible?: boolean): LayerDef => ({
  id,
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
  ...(visible === undefined ? {} : { visible }),
});
const config = (layers: LayerDef[], extra: object = {}) => ({
  version: 1 as const,
  basemaps: [{ type: "empty" as const }],
  layers,
  ...extra,
});

describe("exclusive groups (F2.3)", () => {
  const tree = normalizeConfig(
    config([
      {
        type: "group",
        title: "Imagery",
        exclusive: true,
        children: [
          layer("ortho"),
          layer("hillshade"),
          { type: "group", title: "Historic", children: [layer("y1950"), layer("y1970")] },
        ],
      },
      layer("roads"),
    ]),
  );

  it("starts with the first visible option on and the others hidden", () => {
    expect(tree.layers.map((l) => [l.id, l.visible])).toEqual([
      ["ortho", true],
      ["hillshade", false],
      ["y1950", false],
      ["y1970", false],
      ["roads", true],
    ]);
    expect(tree.toc[0]).toMatchObject({ kind: "group", exclusive: true });
  });

  it("keeps an explicitly chosen later option instead of the first", () => {
    const cfg = normalizeConfig(
      config([
        { type: "group", exclusive: true, children: [layer("a", false), layer("b", true), layer("c")] },
      ]),
    );
    expect(cfg.layers.map((l) => l.visible)).toEqual([false, true, false]);
  });

  it("names the rivals of every option — a child group is one option", () => {
    const rivals = exclusiveRivals(tree.toc);
    expect(rivals.get("ortho")).toEqual(["hillshade", "y1950", "y1970"]);
    expect(rivals.get("y1950")).toEqual(["ortho", "hillshade"]);
    expect(rivals.has("roads")).toBe(false);
  });

  it("adds the rivals of nested exclusive groups", () => {
    const toc: TocNode[] = [
      {
        kind: "group",
        title: "outer",
        collapsed: false,
        exclusive: true,
        children: [
          { kind: "layer", layerId: "a" },
          {
            kind: "group",
            title: "inner",
            collapsed: false,
            exclusive: true,
            children: [
              { kind: "layer", layerId: "b" },
              { kind: "layer", layerId: "c" },
            ],
          },
        ],
      },
    ];
    expect(exclusiveRivals(toc).get("b")).toEqual(["a", "c"]);
  });

  it("reports how much of a group is on and what switching it on means", () => {
    const visible = new Set(["hillshade", "roads"]);
    const isVisible = (id: string) => visible.has(id);
    const [imagery, roads] = tree.toc;
    expect(tocVisibility(imagery!, isVisible)).toBe("on");
    expect(tocShowIds(imagery!, isVisible)).toEqual(["hillshade"]);
    expect(tocVisibility(roads!, isVisible)).toBe("on");

    const none = () => false;
    expect(tocVisibility(imagery!, none)).toBe("off");
    expect(tocShowIds(imagery!, none)).toEqual(["ortho"]);

    /* half of the historic option: the radio group is only partly on */
    const half = (id: string) => id === "y1950";
    expect(tocVisibility(imagery!, half)).toBe("mixed");
    expect(tocShowIds(imagery!, half)).toEqual(["y1950", "y1970"]);
  });

  it("warns when several options are configured visible, and only then", () => {
    const two = validateConfig(
      config([{ type: "group", exclusive: true, children: [layer("a", true), layer("b", true)] }]),
    );
    expect(two.valid).toBe(true);
    expect(two.warnings.map((w) => w.path)).toEqual(["$.layers[0].children"]);

    const implicit = validateConfig(
      config([{ type: "group", exclusive: true, children: [layer("a"), layer("b")] }]),
    );
    expect(implicit.warnings).toEqual([]);
  });

  it("rejects a non-boolean exclusive", () => {
    const res = validateConfig(
      config([{ type: "group", exclusive: "yes", children: [] } as unknown as LayerDef]),
    );
    expect(res.errors.map((e) => e.path)).toEqual(["$.layers[0].exclusive"]);
  });
});

describe("layer panel filter option (F2.7)", () => {
  it('defaults to "auto" and accepts booleans', () => {
    const ls = (c: object) => normalizeConfig(config([], c)).controls.layerSwitcher;
    expect(ls({})).toMatchObject({ filter: "auto" });
    expect(ls({ controls: { layerSwitcher: { filter: true } } })).toMatchObject({ filter: true });
  });

  it("rejects anything else", () => {
    const res = validateConfig(config([], { controls: { layerSwitcher: { filter: "always" } } }));
    expect(res.errors.map((e) => e.path)).toEqual(["$.controls.layerSwitcher.filter"]);
  });
});
