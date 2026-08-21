import type {
  CogColorClassDef,
  CogColorRampDef,
  CogHillshadeDef,
  CogLayerDef,
  NormalizedLayer,
} from "@map0/schema";
import { SourceAdapter, type LegendEntry, type LegendSpec } from "./types.js";

type NormalizedCog = CogLayerDef & NormalizedLayer & { type: "cog" };

type CogModule = typeof import("@geomatico/maplibre-cog-protocol");

/** the per-pixel callback of setColorFunction() — the type itself is not re-exported */
type ColorFunction = NonNullable<Parameters<CogModule["setColorFunction"]>[1]>;

let cogRegistered = false;

/** Register the cog:// protocol once, lazily (geotiff.js is only loaded when a config has a cog layer). */
async function loadCogProtocol(): Promise<CogModule> {
  const [maplibre, cog] = await Promise.all([
    import("maplibre-gl"),
    import("@geomatico/maplibre-cog-protocol"),
  ]);
  if (!cogRegistered) {
    maplibre.addProtocol("cog", cog.cogProtocol);
    cogRegistered = true;
  }
  return cog;
}

/**
 * cog:// source URL, with the protocol's #color fragment for single-band ramps
 * or #dem for Terrain-RGB encoding (hillshade). Explicit classes carry no
 * fragment — they render through a per-URL color function instead.
 */
export function buildCogUrl(url: string, opts?: { color?: CogColorRampDef; dem?: boolean }): string {
  if (opts?.dem) return `cog://${url}#dem`;
  const color = opts?.color;
  if (!color) return `cog://${url}`;
  const modifiers = `${color.continuous ? "c" : ""}${color.reverse ? "-" : ""}`;
  const parts = [color.scheme, String(color.min), String(color.max)];
  if (modifiers) parts.push(modifiers);
  return `cog://${url}#color:${parts.join(",")}`;
}

/** value → [r, g, b], the shape colorScale() returns */
type RgbScale = (value: number) => ArrayLike<number> | undefined;

const css = (rgb: ArrayLike<number>): string =>
  `rgb(${Math.round(rgb[0]!)}, ${Math.round(rgb[1]!)}, ${Math.round(rgb[2]!)})`;

/** enough decimals to tell neighbouring class boundaries apart */
function formatValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)) + 1);
  return value.toFixed(decimals);
}

/**
 * Legend entries for a single-band ramp (F4). Discrete ramps get one entry per
 * class with its value range; the classes are uniform over [min, max] (that is
 * how the protocol builds its threshold scale), so the class count can be read
 * off the scale by sampling it. Continuous ramps get a few labelled samples.
 */
export function cogLegendEntries(
  scale: RgbScale,
  color: Pick<CogColorRampDef, "min" | "max" | "continuous">,
): LegendEntry[] {
  const { min, max } = color;
  const span = max - min;
  if (!(span > 0)) return [];

  if (color.continuous) {
    const SAMPLES = 5;
    const step = span / (SAMPLES - 1);
    const samples: LegendEntry[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const value = min + i * step;
      const rgb = scale(value);
      if (rgb) samples.push({ label: formatValue(value, step), color: css(rgb), shape: "square" });
    }
    return samples;
  }

  /* count the classes: sample densely, count color changes */
  const PROBES = 512;
  let classes = 1;
  let previous = "";
  for (let i = 0; i < PROBES; i++) {
    const rgb = scale(min + ((i + 0.5) / PROBES) * span);
    if (!rgb) continue;
    const key = css(rgb);
    if (previous && key !== previous) classes++;
    previous = key;
  }
  const step = span / classes;
  const entries: LegendEntry[] = [];
  for (let i = 0; i < classes; i++) {
    const rgb = scale(min + (i + 0.5) * step);
    if (!rgb) continue;
    entries.push({
      label: `${formatValue(min + i * step, step)} – ${formatValue(min + (i + 1) * step, step)}`,
      color: css(rgb),
      shape: "square",
    });
  }
  return entries;
}

/* ---------------------------- explicit classes ---------------------------- */

/** "#rgb", "#rrggbb", "#rrggbbaa" → RGBA bytes (format enforced by the validator) */
function parseHexColor(hex: string): Uint8ClampedArray {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const bytes = [0, 2, 4, 6].map((i) =>
    i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255,
  );
  return new Uint8ClampedArray(bytes);
}

const TRANSPARENT = new Uint8ClampedArray([0, 0, 0, 0]);

/**
 * Per-pixel renderer for explicit classes: exact values win over ranges;
 * ranges are [from, to) with the highest "to" inclusive (the validator's
 * contract), so the data maximum never falls off the top class. noData/NaN,
 * fill pixels (Infinity) and unmatched values are transparent.
 * Exact values compare with a relative epsilon because the value is
 * scale/offset-adjusted first and e.g. 3 × 0.01 is not exactly 0.03.
 */
export function classColorFunction(classes: CogColorClassDef[]): ColorFunction {
  const exacts: Array<{ value: number; rgba: Uint8ClampedArray }> = [];
  const ranges: Array<{ from: number; to: number; rgba: Uint8ClampedArray }> = [];
  for (const cls of classes) {
    const rgba = parseHexColor(cls.color);
    if (cls.value !== undefined) exacts.push({ value: cls.value, rgba });
    else if (cls.from !== undefined && cls.to !== undefined)
      ranges.push({ from: cls.from, to: cls.to, rgba });
  }
  ranges.sort((a, b) => a.from - b.from);
  const maxTo = ranges.reduce((m, r) => Math.max(m, r.to), -Infinity);

  return (pixel, color, metadata) => {
    const raw = pixel[0];
    if (raw === undefined || raw === metadata.noData || !Number.isFinite(raw)) {
      color.set(TRANSPARENT);
      return;
    }
    const value = raw * metadata.scale + metadata.offset;
    for (const e of exacts) {
      if (Math.abs(value - e.value) <= 1e-9 * Math.max(1, Math.abs(e.value))) {
        color.set(e.rgba);
        return;
      }
    }
    for (const r of ranges) {
      if (value < r.from) break; // sorted — no later range can match
      if (value < r.to || (r.to === maxTo && value <= r.to)) {
        color.set(r.rgba);
        return;
      }
    }
    color.set(TRANSPARENT);
  };
}

/** Legend entries for explicit classes: one swatch per class, in config order. */
export function classLegendEntries(classes: CogColorClassDef[]): LegendEntry[] {
  return classes.map((cls) => ({
    label: cls.label ?? (cls.value !== undefined ? String(cls.value) : `${cls.from} – ${cls.to}`),
    color: cls.color,
    shape: "square" as const,
  }));
}

/**
 * setColorFunction() is keyed by the plain COG URL and global to the protocol
 * (it also overrides #color/#dem fragments on the same URL). Refcount per URL
 * so removing one of two layers sharing a file keeps the other rendered, and
 * the function is cleared when the last one unmounts.
 */
const activeClassFunctions = new Map<string, { count: number; key: string }>();

function registerClassColorFunction(
  cog: CogModule,
  url: string,
  classes: CogColorClassDef[],
): () => void {
  const key = JSON.stringify(classes);
  const entry = activeClassFunctions.get(url);
  if (entry) {
    entry.count++;
    if (entry.key !== key) {
      console.warn(
        `[map0] multiple cog layers style ${url} with different "classes" — ` +
          `the protocol keys color functions by URL, so the last definition wins for all of them`,
      );
      entry.key = key;
      cog.setColorFunction(url, classColorFunction(classes));
    }
  } else {
    activeClassFunctions.set(url, { count: 1, key });
    cog.setColorFunction(url, classColorFunction(classes));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const e = activeClassFunctions.get(url);
    if (!e || --e.count > 0) return;
    activeClassFunctions.delete(url);
    cog.setColorFunction(url, undefined);
  };
}

export class CogAdapter extends SourceAdapter<NormalizedCog> {
  private srcId = `m0s-${this.def.id}`;
  private lyrId = `m0l-${this.def.id}`;
  private rampLegend: LegendEntry[] | null = null;
  private releaseColorFunction?: () => void;

  get sourceIds(): string[] {
    return [this.srcId];
  }
  get layerIds(): string[] {
    return [this.lyrId];
  }

  protected override async addToMap(): Promise<void> {
    const { map } = this.ctx;
    const cog = await loadCogProtocol();

    /* Read the header up front: fails fast with the library's own message when
       the file is unreachable or not EPSG:3857 (it does not reproject), and the
       extent enables "zoom to layer" (F2.2). The result is cached, so the
       protocol handler does not fetch it twice. */
    const meta = await cog.getCogMetadata(this.def.url);
    if (!this.def.bounds && Array.isArray(meta.bbox)) {
      this.def.bounds = meta.bbox as [number, number, number, number];
    }

    const color = this.def.color;
    const ramp = color && "scheme" in color ? color : undefined;
    if (ramp) {
      /* throws on an unknown scheme name — before the source is added */
      const scale = cog.colorScale({
        colorScheme: ramp.scheme,
        min: ramp.min,
        max: ramp.max,
        isContinuous: ramp.continuous ?? false,
        isReverse: ramp.reverse ?? false,
      }) as RgbScale;
      this.rampLegend = cogLegendEntries(scale, ramp);
    } else if (color && "classes" in color) {
      /* explicit classes render through the protocol's per-URL color function */
      this.releaseColorFunction = registerClassColorFunction(cog, this.def.url, color.classes);
      this.rampLegend = classLegendEntries(color.classes);
    }

    const hs: CogHillshadeDef | null = this.def.hillshade
      ? this.def.hillshade === true
        ? {}
        : this.def.hillshade
      : null;

    map.addSource(this.srcId, {
      type: hs ? "raster-dem" : "raster",
      /* the protocol answers this URL with a TileJSON (tiles, bounds, maxzoom) */
      url: buildCogUrl(this.def.url, { color: ramp, dem: !!hs }),
      tileSize: 256, // the protocol always renders 256-px tiles
      ...(hs ? { encoding: "mapbox" } : {}), // #dem emits the Mapbox Terrain-RGB scheme
      ...(this.def.attribution ? { attribution: this.def.attribution } : {}),
    } as never);

    if (hs) {
      const exaggeration = hs.exaggeration ?? 0.5;
      map.addLayer({
        id: this.lyrId,
        type: "hillshade",
        source: this.srcId,
        ...(this.def.minZoom !== undefined ? { minzoom: this.def.minZoom } : {}),
        ...(this.def.maxZoom !== undefined ? { maxzoom: this.def.maxZoom } : {}),
        paint: {
          "hillshade-exaggeration": exaggeration,
          ...(hs.illuminationDirection !== undefined
            ? { "hillshade-illumination-direction": hs.illuminationDirection }
            : {}),
          ...(hs.shadowColor ? { "hillshade-shadow-color": hs.shadowColor } : {}),
          ...(hs.highlightColor ? { "hillshade-highlight-color": hs.highlightColor } : {}),
          ...(hs.accentColor ? { "hillshade-accent-color": hs.accentColor } : {}),
        },
      });
      /* hillshade has no opacity paint property — scale the exaggeration instead */
      this.opacityEntries = [[this.lyrId, "hillshade-exaggeration", exaggeration]];
      return;
    }

    map.addLayer({
      id: this.lyrId,
      type: "raster",
      source: this.srcId,
      ...(this.def.minZoom !== undefined ? { minzoom: this.def.minZoom } : {}),
      ...(this.def.maxZoom !== undefined ? { maxzoom: this.def.maxZoom } : {}),
      paint: { "raster-opacity": 1 },
    });
    this.opacityEntries = [[this.lyrId, "raster-opacity", 1]];
  }

  override unmount(): void {
    super.unmount();
    this.releaseColorFunction?.();
    this.releaseColorFunction = undefined;
  }

  protected override autoLegend(): LegendSpec | null {
    return this.rampLegend && this.rampLegend.length > 0
      ? { kind: "entries", entries: this.rampLegend }
      : null;
  }
}
