/**
 * Normalization: apply documented defaults and assign stable ids.
 * A minimal config (version + one basemap) must yield a fully working map.
 */
import type {
  BasemapDef,
  ControlsConfig,
  GroupLayerDef,
  LayerDef,
  Map0Config,
  MapConfig,
} from "./types.js";

export interface NormalizedBasemap extends BasemapDef {
  id: string;
  title: string;
}

export type NormalizedLayer = Exclude<LayerDef, GroupLayerDef> & {
  id: string;
  title: string;
  visible: boolean;
  opacity: number;
  /** path of group titles above this layer */
  groupPath: string[];
};

export interface NormalizedGroup {
  type: "group";
  title: string;
  collapsed: boolean;
  /** ids in tree order (leaves only) */
  children: TocNode[];
}

export type TocNode =
  | { kind: "layer"; layerId: string }
  | { kind: "group"; title: string; collapsed: boolean; children: TocNode[] };

export interface NormalizedControls {
  navigation: boolean;
  scale: false | { maxWidth: number; unit: "metric" | "imperial" };
  fullscreen: boolean;
  geolocate: false | { follow: boolean };
  globe: boolean;
  home: boolean;
  attribution: false | { compact: boolean | "auto" };
  layerSwitcher: false | { position: string; open: boolean | "auto"; title?: string; allowAdd: boolean };
  basemapSwitcher: false | { position: string };
  legend: false | { position: string; open: boolean };
  print: boolean;
}

export interface NormalizedConfig {
  version: 1;
  meta: { title?: string; description?: string };
  map: Required<Pick<MapConfig, "projection">> & MapConfig;
  basemaps: NormalizedBasemap[];
  defaultBasemapId: string;
  /** flat list of leaf layers in tree (drawing) order — first item = bottom-most overlay */
  layers: NormalizedLayer[];
  /** tree structure for the TOC (same order as `layers`) */
  toc: TocNode[];
  controls: NormalizedControls;
  theme: { mode: "auto" | "light" | "dark"; primary: string; radius: "none" | "sm" | "md" | "lg"; font?: string };
  i18n: { locale: string; fallback: string; overrides?: Record<string, Record<string, string>> };
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "layer"
  );
}

export function normalizeConfig(cfg: Map0Config): NormalizedConfig {
  const usedIds = new Set<string>();

  /* basemaps */
  const basemaps: NormalizedBasemap[] = cfg.basemaps.map((bm, i) => ({
    tileSize: bm.type === "raster" ? 256 : undefined,
    ...bm,
    id: bm.id ?? uniqueId(bm.title ? slugify(bm.title) : `basemap-${i + 1}`, usedIds),
    title: bm.title ?? defaultBasemapTitle(bm, i),
  }));
  const defaultBasemapId =
    basemaps.find((b) => b.default)?.id ?? basemaps[0]!.id;

  /* layers: flatten tree, keep TOC structure */
  const layers: NormalizedLayer[] = [];
  const toc = normalizeLayerList(cfg.layers ?? [], [], layers, usedIds);

  /* controls */
  const c = cfg.controls ?? {};
  const controls: NormalizedControls = {
    navigation: c.navigation ?? true,
    scale:
      c.scale === false
        ? false
        : {
            maxWidth: typeof c.scale === "object" ? (c.scale.maxWidth ?? 100) : 100,
            unit: typeof c.scale === "object" ? (c.scale.unit ?? "metric") : "metric",
          },
    fullscreen: c.fullscreen ?? true,
    geolocate:
      c.geolocate === false
        ? false
        : { follow: typeof c.geolocate === "object" ? (c.geolocate.follow ?? false) : false },
    globe: c.globe ?? true,
    home: c.home ?? false,
    attribution:
      c.attribution === false
        ? false
        : { compact: typeof c.attribution === "object" ? (c.attribution.compact ?? "auto") : "auto" },
    layerSwitcher:
      c.layerSwitcher === false
        ? false
        : {
            position:
              typeof c.layerSwitcher === "object"
                ? (c.layerSwitcher.position ?? "top-right")
                : "top-right",
            open:
              typeof c.layerSwitcher === "object" ? (c.layerSwitcher.open ?? "auto") : "auto",
            title: typeof c.layerSwitcher === "object" ? c.layerSwitcher.title : undefined,
            allowAdd:
              typeof c.layerSwitcher === "object" ? (c.layerSwitcher.allowAdd ?? true) : true,
          },
    basemapSwitcher:
      c.basemapSwitcher === false || basemaps.length < 2
        ? false
        : {
            position:
              typeof c.basemapSwitcher === "object"
                ? (c.basemapSwitcher.position ?? "bottom-left")
                : "bottom-left",
          },
    legend:
      c.legend === false
        ? false
        : {
            position:
              typeof c.legend === "object" ? (c.legend.position ?? "bottom-right") : "bottom-right",
            open: typeof c.legend === "object" ? (c.legend.open ?? false) : false,
          },
    print: c.print ?? true,
  };

  return {
    version: 1,
    meta: cfg.meta ?? {},
    map: { projection: cfg.map?.projection ?? "mercator", ...cfg.map },
    basemaps,
    defaultBasemapId,
    layers,
    toc,
    controls,
    theme: {
      mode: cfg.theme?.mode ?? "auto",
      primary: cfg.theme?.primary ?? "#0e7490",
      radius: cfg.theme?.radius ?? "md",
      font: cfg.theme?.font,
    },
    i18n: {
      locale: cfg.i18n?.locale ?? "auto",
      fallback: cfg.i18n?.fallback ?? "en",
      overrides: cfg.i18n?.overrides,
    },
  };
}

function defaultBasemapTitle(bm: BasemapDef, i: number): string {
  if (bm.type === "empty") return "—";
  try {
    if (bm.url) return new URL(bm.url).hostname;
  } catch {
    /* relative URL */
  }
  return `Basemap ${i + 1}`;
}

/** Normalize a single (non-group) layer added at runtime (F3 add-layer dialog). */
export function normalizeSingleLayer(
  def: Exclude<LayerDef, GroupLayerDef>,
  existingIds: Iterable<string>,
): NormalizedLayer {
  const used = new Set(existingIds);
  const title = def.title ?? def.id ?? "Layer";
  const id =
    def.id && !used.has(def.id) ? def.id : uniqueId(slugify(def.title ?? def.id ?? "layer"), used);
  return {
    ...def,
    id,
    title,
    visible: def.visible ?? true,
    opacity: def.opacity ?? 1,
    groupPath: [],
  } as NormalizedLayer;
}

function normalizeLayerList(
  defs: LayerDef[],
  groupPath: string[],
  out: NormalizedLayer[],
  usedIds: Set<string>,
): TocNode[] {
  const nodes: TocNode[] = [];
  for (const def of defs) {
    if (def.type === "group") {
      const title = def.title ?? "Group";
      const children = normalizeLayerList(
        def.children,
        [...groupPath, title],
        out,
        usedIds,
      );
      nodes.push({ kind: "group", title, collapsed: def.collapsed ?? false, children });
    } else {
      const title = def.title ?? def.id ?? `Layer ${out.length + 1}`;
      const id = def.id ?? uniqueId(slugify(title), usedIds);
      if (def.id) usedIds.add(def.id);
      const norm = {
        ...def,
        id,
        title,
        visible: def.visible ?? true,
        opacity: def.opacity ?? 1,
        groupPath,
      } as NormalizedLayer;
      out.push(norm);
      nodes.push({ kind: "layer", layerId: id });
    }
  }
  return nodes;
}
