/**
 * Style presets for vector-data layers: ready-made simple styles from one base
 * colour, and data-driven styles — categorised by the distinct values of a
 * property, or graduated over a numeric range — built as MapLibre style-spec
 * layers with a matching legend. Pure functions over GeoJSON features; the
 * features come from whatever the preview has loaded.
 */
import type { LegendEntryDef, SimpleStyle, StyleLayerSpec } from "@map0/schema";

type Props = Record<string, unknown>;

export interface SampleFeature {
  properties?: Props | null;
  geometry?: { type?: string } | null;
}

/* ------------------------------ simple presets ------------------------------ */

export type SimplePresetId = "area" | "outline" | "points" | "subtle";

export const SIMPLE_PRESETS: SimplePresetId[] = ["area", "outline", "points", "subtle"];

/** a flat paint-property style from one base colour */
export function simplePreset(id: SimplePresetId, color: string): SimpleStyle {
  switch (id) {
    case "area":
      return {
        "fill-color": color,
        "fill-opacity": 0.45,
        "line-color": color,
        "line-width": 1.5,
        "circle-color": color,
        "circle-radius": 6,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      };
    case "outline":
      return { "fill-opacity": 0, "line-color": color, "line-width": 2, "circle-color": color, "circle-radius": 5 };
    case "points":
      return {
        "circle-color": color,
        "circle-radius": 7,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "line-color": color,
        "line-width": 2,
        "fill-color": color,
        "fill-opacity": 0.3,
      };
    case "subtle":
      return {
        "fill-color": color,
        "fill-opacity": 0.15,
        "line-color": color,
        "line-width": 0.8,
        "circle-color": color,
        "circle-radius": 4,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
      };
  }
}

/* -------------------------------- palettes -------------------------------- */

/** twelve distinguishable hues (ColorBrewer Paired/Set3 blend) */
export const CATEGORICAL_PALETTE = [
  "#1f78b4",
  "#e6550d",
  "#31a354",
  "#756bb1",
  "#d62728",
  "#ff7f00",
  "#17becf",
  "#bcbd22",
  "#8c564b",
  "#e377c2",
  "#6a3d9a",
  "#7f7f7f",
];

/** five-class sequential ramp (ColorBrewer YlGnBu) */
export const SEQUENTIAL_PALETTE = ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"];

/** anything that is not one of the palette's classes */
const FALLBACK_COLOR = "#c0c0c0";

/** the most distinct values a categorised style is offered for */
export const MAX_CATEGORIES = 12;

/* ------------------------------- data access ------------------------------- */

/** property names present on the sample, most frequent first; cluster internals excluded */
export function propertyNames(features: SampleFeature[]): string[] {
  const counts = new Map<string, number>();
  for (const f of features) {
    for (const key of Object.keys(f.properties ?? {})) {
      if (key === "point_count" || key === "point_count_abbreviated" || key === "cluster_id" || key === "cluster") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export type Scalar = string | number | boolean;

/** distinct values of a property (null/undefined skipped), in order of first appearance */
export function distinctValues(features: SampleFeature[], prop: string): Scalar[] {
  const seen = new Set<string>();
  const out: Scalar[] = [];
  for (const f of features) {
    const v = f.properties?.[prop];
    if (v === null || v === undefined || typeof v === "object") continue;
    const key = `${typeof v}:${String(v)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v as Scalar);
  }
  return out;
}

/** min/max when every value is numeric (numeric strings count), else null */
export function numericRange(values: Scalar[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
    if (!Number.isFinite(n)) return null;
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  return { min, max };
}

export type GeometryKind = "polygon" | "line" | "point";

/** which geometry kinds the sample contains — decides which style layers and legend shapes to emit */
export function geometryKinds(features: SampleFeature[]): Set<GeometryKind> {
  const kinds = new Set<GeometryKind>();
  for (const f of features) {
    const t = f.geometry?.type ?? "";
    if (t.endsWith("Polygon")) kinds.add("polygon");
    else if (t.endsWith("LineString")) kinds.add("line");
    else if (t.endsWith("Point")) kinds.add("point");
  }
  return kinds;
}

/* ------------------------------ style builders ------------------------------ */

export interface DataStyle {
  style: StyleLayerSpec[];
  legend: LegendEntryDef[];
}

/** style layers for every present geometry kind, colour taken from one expression */
function layersFor(kinds: Set<GeometryKind>, color: unknown): StyleLayerSpec[] {
  const all = kinds.size === 0; // unknown geometry: emit everything, MapLibre draws what fits
  const out: StyleLayerSpec[] = [];
  if (all || kinds.has("polygon")) out.push({ type: "fill", paint: { "fill-color": color, "fill-opacity": 0.6 } });
  if (all || kinds.has("polygon") || kinds.has("line"))
    out.push({ type: "line", paint: { "line-color": color, "line-width": kinds.has("line") ? 2 : 1 } });
  if (all || kinds.has("point"))
    out.push({
      type: "circle",
      paint: { "circle-color": color, "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 },
    });
  return out;
}

function legendShape(kinds: Set<GeometryKind>): LegendEntryDef["shape"] {
  if (kinds.has("polygon")) return "square";
  if (kinds.has("line")) return "line";
  if (kinds.has("point")) return "circle";
  return "square";
}

/** one colour per distinct value (`match` expression), grey for everything else */
export function categorizedStyle(prop: string, values: Scalar[], kinds: Set<GeometryKind>): DataStyle {
  const classes = values.slice(0, MAX_CATEGORIES);
  /* `match` compares strictly by type — a numeric property must be matched with numbers */
  const match: unknown[] = ["match", ["get", prop]];
  const legend: LegendEntryDef[] = [];
  const shape = legendShape(kinds);
  classes.forEach((v, i) => {
    const color = CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]!;
    match.push(typeof v === "boolean" ? String(v) : v, color);
    legend.push({ label: String(v), color, shape });
  });
  match.push(FALLBACK_COLOR);
  /* booleans are not valid `match` labels — compare their string form instead */
  const input = classes.some((v) => typeof v === "boolean") ? ["to-string", ["get", prop]] : ["get", prop];
  match[1] = input;
  return { style: layersFor(kinds, match), legend };
}

/** the class breaks for `n` equal intervals over [min, max] — the upper bounds of all but the last class */
export function equalIntervalBreaks(min: number, max: number, n: number): number[] {
  const breaks: number[] = [];
  const width = (max - min) / n;
  for (let i = 1; i < n; i++) breaks.push(roundNice(min + width * i, width));
  return breaks;
}

/** round a break to a precision that suits the class width (2 significant digits of the width) */
function roundNice(value: number, width: number): number {
  if (width <= 0) return value;
  const digits = Math.max(0, 1 - Math.floor(Math.log10(width)));
  return Number(value.toFixed(Math.min(digits, 6)));
}

/** five equal-interval classes over the range (`step` expression), light to dark */
export function graduatedStyle(prop: string, min: number, max: number, kinds: Set<GeometryKind>): DataStyle {
  const palette = SEQUENTIAL_PALETTE;
  const shape = legendShape(kinds);
  if (max <= min) {
    return {
      style: layersFor(kinds, palette[palette.length - 1]),
      legend: [{ label: String(min), color: palette[palette.length - 1]!, shape }],
    };
  }
  const breaks = equalIntervalBreaks(min, max, palette.length);
  const step: unknown[] = ["step", ["to-number", ["get", prop]], palette[0]];
  const legend: LegendEntryDef[] = [];
  let lower = min;
  breaks.forEach((b, i) => {
    step.push(b, palette[i + 1]);
    legend.push({ label: `${formatNumber(lower)} – ${formatNumber(b)}`, color: palette[i]!, shape });
    lower = b;
  });
  legend.push({ label: `${formatNumber(lower)} – ${formatNumber(max)}`, color: palette[palette.length - 1]!, shape });
  return { style: layersFor(kinds, step), legend };
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)));
}

/**
 * The data-driven style for a property: categorised when the values are few,
 * graduated when they are numeric and many, null when neither fits (too many
 * text values).
 */
export function dataDrivenStyle(features: SampleFeature[], prop: string): DataStyle | null {
  const values = distinctValues(features, prop);
  if (values.length === 0) return null;
  const kinds = geometryKinds(features);
  if (values.length <= MAX_CATEGORIES) return categorizedStyle(prop, values, kinds);
  const range = numericRange(values);
  return range ? graduatedStyle(prop, range.min, range.max, kinds) : null;
}
