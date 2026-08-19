import type { CogColorDef, CogHillshadeDef, CogLayerDef, NormalizedLayer } from "@map0/schema";
import { SourceAdapter, type LegendEntry, type LegendSpec } from "./types.js";

type NormalizedCog = CogLayerDef & NormalizedLayer & { type: "cog" };

type CogModule = typeof import("@geomatico/maplibre-cog-protocol");

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
 * or #dem for Terrain-RGB encoding (hillshade).
 */
export function buildCogUrl(url: string, opts?: { color?: CogColorDef; dem?: boolean }): string {
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
  color: Pick<CogColorDef, "min" | "max" | "continuous">,
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

export class CogAdapter extends SourceAdapter<NormalizedCog> {
  private srcId = `m0s-${this.def.id}`;
  private lyrId = `m0l-${this.def.id}`;
  private rampLegend: LegendEntry[] | null = null;

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

    if (this.def.color) {
      /* throws on an unknown scheme name — before the source is added */
      const scale = cog.colorScale({
        colorScheme: this.def.color.scheme,
        min: this.def.color.min,
        max: this.def.color.max,
        isContinuous: this.def.color.continuous ?? false,
        isReverse: this.def.color.reverse ?? false,
      }) as RgbScale;
      this.rampLegend = cogLegendEntries(scale, this.def.color);
    }

    const hs: CogHillshadeDef | null = this.def.hillshade
      ? this.def.hillshade === true
        ? {}
        : this.def.hillshade
      : null;

    map.addSource(this.srcId, {
      type: hs ? "raster-dem" : "raster",
      /* the protocol answers this URL with a TileJSON (tiles, bounds, maxzoom) */
      url: buildCogUrl(this.def.url, { color: this.def.color, dem: !!hs }),
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

  protected override autoLegend(): LegendSpec | null {
    return this.rampLegend && this.rampLegend.length > 0
      ? { kind: "entries", entries: this.rampLegend }
      : null;
  }
}
