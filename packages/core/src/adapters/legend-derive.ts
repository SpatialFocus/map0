import type { StyleLayerSpec } from "@map0/schema";
import type { LegendEntry } from "./types.js";

const COLOR_PROP: Record<string, { prop: string; shape: LegendEntry["shape"] }> = {
  fill: { prop: "fill-color", shape: "square" },
  line: { prop: "line-color", shape: "line" },
  circle: { prop: "circle-color", shape: "circle" },
};

/** Swatch from a paint object — only literal string colors (expressions can't be summarized). */
export function entryFromPaint(
  type: string,
  paint: Record<string, unknown> | undefined,
): LegendEntry | null {
  const mapping = COLOR_PROP[type];
  if (!mapping) return null;
  const color = paint?.[mapping.prop];
  if (typeof color !== "string") return null;
  return { color, shape: mapping.shape };
}

/** Derive swatch entries from full style-spec layer objects (best effort). */
export function deriveFromStyleLayers(specs: StyleLayerSpec[]): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const spec of specs) {
    const entry = entryFromPaint(
      spec.type,
      (spec as { paint?: Record<string, unknown> }).paint,
    );
    if (entry) entries.push(entry);
  }
  return entries;
}
