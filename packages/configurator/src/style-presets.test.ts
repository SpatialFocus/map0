import { describe, expect, it } from "vitest";
import {
  CATEGORICAL_PALETTE,
  MAX_CATEGORIES,
  SEQUENTIAL_PALETTE,
  SIMPLE_PRESETS,
  categorizedStyle,
  dataDrivenStyle,
  distinctValues,
  equalIntervalBreaks,
  geometryKinds,
  graduatedStyle,
  numericRange,
  propertyNames,
  simplePreset,
  type SampleFeature,
} from "./style-presets.js";

const polygons = (values: Array<Record<string, unknown>>): SampleFeature[] =>
  values.map((properties) => ({ properties, geometry: { type: "Polygon" } }));

describe("simple presets", () => {
  it("derive every colour from the base colour", () => {
    for (const id of SIMPLE_PRESETS) {
      const style = simplePreset(id, "#123456");
      for (const [key, value] of Object.entries(style))
        if (key.endsWith("-color") && key !== "circle-stroke-color") expect(value).toBe("#123456");
    }
  });
});

describe("sampling", () => {
  it("lists properties by frequency and skips cluster internals", () => {
    const sample: SampleFeature[] = [
      { properties: { name: "a", point_count: 3, cluster: true } },
      { properties: { name: "b", kind: "x" } },
      { properties: { kind: "y" } },
    ];
    expect(propertyNames(sample)).toEqual(["name", "kind"]);
  });

  it("collects distinct scalar values in order and detects numeric ranges", () => {
    const sample = polygons([{ v: 3 }, { v: "3" }, { v: 1 }, { v: null }, { v: 3 }, { v: { nested: 1 } }]);
    expect(distinctValues(sample, "v")).toEqual([3, "3", 1]);
    expect(numericRange([3, "3", 1])).toEqual({ min: 1, max: 3 });
    expect(numericRange(["a", 1])).toBeNull();
    expect(geometryKinds([{ geometry: { type: "MultiLineString" } }, { geometry: { type: "Point" } }])).toEqual(
      new Set(["line", "point"]),
    );
  });
});

describe("data-driven styles", () => {
  it("categorises with a match expression and a legend entry per value", () => {
    const { style, legend } = categorizedStyle("bez", [1, 2, 3], new Set(["polygon"]));
    expect(style.map((l) => l.type)).toEqual(["fill", "line"]);
    const fill = style[0]!["paint"] as Record<string, unknown>;
    expect(fill["fill-color"]).toEqual(["match", ["get", "bez"], 1, CATEGORICAL_PALETTE[0], 2, CATEGORICAL_PALETTE[1], 3, CATEGORICAL_PALETTE[2], "#c0c0c0"]);
    expect(legend).toEqual([
      { label: "1", color: CATEGORICAL_PALETTE[0], shape: "square" },
      { label: "2", color: CATEGORICAL_PALETTE[1], shape: "square" },
      { label: "3", color: CATEGORICAL_PALETTE[2], shape: "square" },
    ]);
  });

  it("compares booleans by their string form", () => {
    const { style } = categorizedStyle("flag", [true, false], new Set(["point"]));
    const circle = style.find((l) => l.type === "circle")!["paint"] as Record<string, unknown>;
    expect((circle["circle-color"] as unknown[]).slice(0, 4)).toEqual(["match", ["to-string", ["get", "flag"]], "true", CATEGORICAL_PALETTE[0]]);
  });

  it("graduates numeric ranges into five equal intervals", () => {
    expect(equalIntervalBreaks(0, 100, 5)).toEqual([20, 40, 60, 80]);
    expect(equalIntervalBreaks(0, 1, 5)).toEqual([0.2, 0.4, 0.6, 0.8]);
    const { style, legend } = graduatedStyle("pop", 0, 100, new Set(["polygon"]));
    const fill = style[0]!["paint"] as Record<string, unknown>;
    expect(fill["fill-color"]).toEqual(["step", ["to-number", ["get", "pop"]], SEQUENTIAL_PALETTE[0], 20, SEQUENTIAL_PALETTE[1], 40, SEQUENTIAL_PALETTE[2], 60, SEQUENTIAL_PALETTE[3], 80, SEQUENTIAL_PALETTE[4]]);
    expect(legend.map((e) => e.label)).toEqual(["0 – 20", "20 – 40", "40 – 60", "60 – 80", "80 – 100"]);
  });

  it("picks categorised for few values, graduated for many numbers, nothing for many texts", () => {
    const few = polygons([{ k: "a" }, { k: "b" }]);
    expect(dataDrivenStyle(few, "k")?.legend).toHaveLength(2);
    const many = polygons(Array.from({ length: MAX_CATEGORIES + 5 }, (_, i) => ({ n: i * 10 })));
    const graduated = dataDrivenStyle(many, "n")!;
    expect(graduated.legend).toHaveLength(5);
    const texts = polygons(Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => ({ s: `t${i}` })));
    expect(dataDrivenStyle(texts, "s")).toBeNull();
    expect(dataDrivenStyle(few, "missing")).toBeNull();
  });
});
