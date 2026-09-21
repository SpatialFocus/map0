/**
 * Pure config operations behind the configurator: everything that changes a
 * config object lives here as an immutable function, so it can be unit-tested
 * without a DOM and the element stays a thin layer of forms over it.
 *
 * Paths into the layer tree are index paths (`[2, 0]` = third root node, its
 * first child) — the config has no stable ids for groups, and layer ids are
 * optional, so positions are the only address that always exists.
 */
import { CONFIG_KEYS, type BasemapDef, type GroupLayerDef, type LayerDef, type Map0Config } from "@map0/schema";

export type LayerPath = number[];

export const SCHEMA_URL = "https://map0.net/schema/v1.json";

/** the config a fresh configurator starts with — Vienna, one basemap, one WMS layer */
export const STARTER_CONFIG: Map0Config = {
  $schema: SCHEMA_URL,
  version: 1,
  meta: { title: "My map" },
  map: { center: [16.3725, 48.2083], zoom: 12 },
  basemaps: [
    {
      type: "style",
      title: "basemap.at",
      url: "https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json",
    },
  ],
  layers: [
    {
      type: "wms",
      title: "Zoning plan",
      url: "https://data.wien.gv.at/daten/geo",
      layers: "GENFLWIDMUNGOGD",
      opacity: 0.6,
    },
  ],
};

/** the smallest config the viewer accepts — for "start from scratch" */
export const BLANK_CONFIG: Map0Config = {
  $schema: SCHEMA_URL,
  version: 1,
  map: { center: [13.35, 47.7], zoom: 7 },
  basemaps: [{ type: "empty", title: "None" }],
  layers: [],
};

export interface BasemapPreset {
  id: string;
  /** shown in the picker — a proper name, not translated */
  title: string;
  def: BasemapDef;
}

/** public basemaps a config author can add with one click; `custom` is the manual path */
export const BASEMAP_PRESETS: BasemapPreset[] = [
  {
    id: "bmapv",
    title: "basemap.at (vector)",
    def: {
      type: "style",
      title: "basemap.at",
      url: "https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json",
    },
  },
  {
    id: "bmaporthofoto",
    title: "basemap.at Orthofoto",
    def: {
      type: "raster",
      title: "Orthofoto",
      url: "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
      attribution: "© basemap.at",
      maxZoom: 19,
    },
  },
  {
    id: "bmapgrau",
    title: "basemap.at grau",
    def: {
      type: "raster",
      title: "Grau",
      url: "https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png",
      attribution: "© basemap.at",
      maxZoom: 19,
    },
  },
  {
    id: "openfreemap",
    title: "OpenFreeMap Liberty (vector)",
    def: {
      type: "style",
      title: "OpenFreeMap",
      url: "https://tiles.openfreemap.org/styles/liberty",
    },
  },
  {
    id: "osm",
    title: "OpenStreetMap (raster)",
    def: {
      type: "raster",
      title: "OpenStreetMap",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    },
  },
  {
    id: "empty",
    title: "No background",
    def: { type: "empty", title: "None" },
  },
];

export const LAYER_TYPE_LABELS: Record<string, string> = {
  group: "Group",
  wms: "WMS",
  wmts: "WMTS",
  wfs: "WFS",
  "ogcapi-features": "OGC API Features",
  raster: "XYZ raster",
  cog: "COG",
  geojson: "GeoJSON",
  geoparquet: "GeoParquet",
  vector: "Vector tiles",
};

export function layerTypeLabel(type: string): string {
  return LAYER_TYPE_LABELS[type] ?? type;
}

export const isGroup = (def: LayerDef | undefined): def is GroupLayerDef => def?.type === "group";

/* ------------------------------ tree access ------------------------------ */

/** the list a path's last index points into (the root list or a group's children) */
export function getSiblings(cfg: Map0Config, path: LayerPath): LayerDef[] | undefined {
  let list: LayerDef[] | undefined = cfg.layers ?? [];
  for (const index of path.slice(0, -1)) {
    const node: LayerDef | undefined = list?.[index];
    if (!isGroup(node)) return undefined;
    list = node.children;
  }
  return list;
}

export function getLayer(cfg: Map0Config, path: LayerPath): LayerDef | undefined {
  if (path.length === 0) return undefined;
  return getSiblings(cfg, path)?.[path[path.length - 1]!];
}

/** structural sharing: copies only the spine from the root to the changed list */
function replaceList(cfg: Map0Config, parentPath: LayerPath, fn: (list: LayerDef[]) => LayerDef[]): Map0Config {
  const rebuild = (list: LayerDef[], depth: number): LayerDef[] => {
    if (depth === parentPath.length) return fn(list);
    const index = parentPath[depth]!;
    const node = list[index];
    if (!isGroup(node)) return list;
    const next = [...list];
    next[index] = { ...node, children: rebuild(node.children, depth + 1) };
    return next;
  };
  return { ...cfg, layers: rebuild(cfg.layers ?? [], 0) };
}

export function updateLayer(cfg: Map0Config, path: LayerPath, fn: (def: LayerDef) => LayerDef): Map0Config {
  const index = path[path.length - 1];
  if (index === undefined) return cfg;
  return replaceList(cfg, path.slice(0, -1), (list) => {
    const current = list[index];
    if (!current) return list;
    const next = [...list];
    next[index] = fn(current);
    return next;
  });
}

export function removeLayer(cfg: Map0Config, path: LayerPath): Map0Config {
  const index = path[path.length - 1];
  if (index === undefined) return cfg;
  return replaceList(cfg, path.slice(0, -1), (list) => list.filter((_, i) => i !== index));
}

/** insert at `index` of the list `parentPath` addresses (append when omitted) */
export function insertLayer(
  cfg: Map0Config,
  parentPath: LayerPath,
  def: LayerDef,
  index?: number,
): Map0Config {
  return replaceList(cfg, parentPath, (list) => {
    const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, at), def, ...list.slice(at)];
  });
}

/** swap with the neighbour above (-1) or below (+1); no-op at the ends */
export function moveLayer(
  cfg: Map0Config,
  path: LayerPath,
  delta: -1 | 1,
): { config: Map0Config; path: LayerPath } {
  const index = path[path.length - 1];
  if (index === undefined) return { config: cfg, path };
  const siblings = getSiblings(cfg, path);
  const target = index + delta;
  if (!siblings || target < 0 || target >= siblings.length) return { config: cfg, path };
  const config = replaceList(cfg, path.slice(0, -1), (list) => {
    const next = [...list];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
  return { config, path: [...path.slice(0, -1), target] };
}

/** move into the group directly above it (as its last child) */
export function indentLayer(cfg: Map0Config, path: LayerPath): { config: Map0Config; path: LayerPath } | null {
  const index = path[path.length - 1];
  if (index === undefined || index === 0) return null;
  const siblings = getSiblings(cfg, path);
  const def = siblings?.[index];
  const above = siblings?.[index - 1];
  if (!def || !isGroup(above)) return null;
  const removed = removeLayer(cfg, path);
  const groupPath = [...path.slice(0, -1), index - 1];
  const config = insertLayer(removed, groupPath, def);
  return { config, path: [...groupPath, above.children.length] };
}

/** move out of its group, placed right after that group */
export function outdentLayer(cfg: Map0Config, path: LayerPath): { config: Map0Config; path: LayerPath } | null {
  if (path.length < 2) return null;
  const def = getLayer(cfg, path);
  if (!def) return null;
  const removed = removeLayer(cfg, path);
  const groupPath = path.slice(0, -1);
  const groupIndex = groupPath[groupPath.length - 1]!;
  const config = insertLayer(removed, groupPath.slice(0, -1), def, groupIndex + 1);
  return { config, path: [...groupPath.slice(0, -1), groupIndex + 1] };
}

export function duplicateLayer(cfg: Map0Config, path: LayerPath): Map0Config {
  const def = getLayer(cfg, path);
  const index = path[path.length - 1];
  if (!def || index === undefined) return cfg;
  const copy = structuredClone(def) as LayerDef;
  if ("id" in copy && copy.id) copy.id = slugId(`${copy.id}-copy`, collectIds(cfg));
  return insertLayer(cfg, path.slice(0, -1), copy, index + 1);
}

/** every explicit id in basemaps and layers — one namespace (permalink, JS API) */
export function collectIds(cfg: Map0Config): Set<string> {
  const ids = new Set<string>();
  for (const bm of cfg.basemaps ?? []) if (bm.id) ids.add(bm.id);
  const walk = (list: LayerDef[]): void => {
    for (const def of list) {
      if (isGroup(def)) walk(def.children);
      else if (def.id) ids.add(def.id);
    }
  };
  walk(cfg.layers ?? []);
  return ids;
}

/** "Flächenwidmung 2024" → "flaechenwidmung-2024", made unique against `taken` */
export function slugId(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "layer";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** every node with its path, depth-first — what the tree view renders */
export function flattenLayers(cfg: Map0Config): Array<{ path: LayerPath; def: LayerDef; depth: number }> {
  const out: Array<{ path: LayerPath; def: LayerDef; depth: number }> = [];
  const walk = (list: LayerDef[], prefix: LayerPath): void => {
    list.forEach((def, i) => {
      const path = [...prefix, i];
      out.push({ path, def, depth: prefix.length });
      if (isGroup(def)) walk(def.children, path);
    });
  };
  walk(cfg.layers ?? [], []);
  return out;
}

export const samePath = (a: LayerPath | null, b: LayerPath | null): boolean =>
  a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);

/* ------------------------------ key helpers ------------------------------ */

/**
 * Set a key, or delete it when the value is "nothing": undefined, an empty
 * string, NaN, or an empty object. Forms produce empty values all the time and
 * a config full of `"title": ""` is not what anyone wants to paste into a CMS.
 */
export function setKey<T extends object>(obj: T, key: string, value: unknown): T {
  const next = { ...obj } as Record<string, unknown>;
  if (isBlank(value)) delete next[key];
  else next[key] = value;
  return next as T;
}

/** undefined, an empty string or NaN — what an emptied form control yields */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === "") return true;
  return typeof value === "number" && Number.isNaN(value);
}

/** blank, or an object with no keys left */
export function isNothing(value: unknown): boolean {
  if (isBlank(value)) return true;
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

/**
 * Keys whose empty object carries meaning and must survive pruning: an empty
 * "popup"/"info" enables feature info with defaults, an empty "search" shows
 * the search box.
 */
const KEEP_EMPTY = new Set(["popup", "info", "search"]);

/** the number an <input> holds, or undefined for an empty field */
export function numberOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** "key=value" lines ↔ a params record (vendor parameters, i18n overrides) */
export function paramsToText(params?: Record<string, string>): string {
  return Object.entries(params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function textToParams(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** "96, 150, 300" ↔ [96, 150, 300] */
export function textToNumbers(text: string): number[] | undefined {
  const list = text
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return list.length > 0 ? list : undefined;
}

/** "16.37, 48.21" → [16.37, 48.21] when it has exactly `count` finite numbers */
export function textToTuple(text: string, count: number): number[] | undefined {
  const list = textToNumbers(text);
  return list && list.length === count ? list : undefined;
}

export const numbersToText = (list?: readonly number[]): string => (list ?? []).join(", ");

/* ------------------------------ output ------------------------------ */

const LAYER_KEY_ORDER = [
  "type",
  "id",
  "title",
  "visible",
  "opacity",
  "minZoom",
  "maxZoom",
  "bounds",
  "attribution",
  "metadata",
  "legend",
  "collapsed",
  "url",
  "data",
  "layers",
  "layer",
  "typeNames",
  "styles",
  "style",
  "matrixSet",
  "format",
  "version",
  "outputFormat",
  "transparent",
  "tileSize",
  "limit",
  "pageSize",
  "params",
  "sourceLayer",
  "crs",
  "promoteId",
  "color",
  "hillshade",
  "cluster",
  "info",
  "popup",
  "hover",
  "children",
];

function orderKeys<T extends object>(obj: T, order: readonly string[]): T {
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = record[k];
  return out as T;
}

/** drop empty values recursively — arrays are kept as the author left them */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = prune(v);
      if (!isNothing(cleaned) || (KEEP_EMPTY.has(k) && cleaned !== undefined && cleaned !== "")) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/**
 * The config as it should be pasted into a CMS: empty values gone, top-level
 * keys in the documented order, layer keys in a readable order, `$schema`
 * first so editors pick up autocomplete.
 */
export function cleanConfig(cfg: Map0Config): Map0Config {
  const pruned = prune({ $schema: SCHEMA_URL, ...cfg }) as Map0Config;
  const orderLayers = (list: LayerDef[] | undefined): LayerDef[] | undefined =>
    list?.map((def) => {
      const ordered = orderKeys(def, LAYER_KEY_ORDER);
      return isGroup(ordered) ? { ...ordered, children: orderLayers(ordered.children) ?? [] } : ordered;
    });
  const withLayers = { ...pruned, layers: orderLayers(pruned.layers) };
  if (withLayers.layers && withLayers.layers.length === 0) delete withLayers.layers;
  return orderKeys(withLayers, CONFIG_KEYS);
}

export function serializeConfig(cfg: Map0Config): string {
  return JSON.stringify(cleanConfig(cfg), null, 2);
}

/** the copy-ready embed: script tag + the element with its inline config */
export function embedSnippet(cfg: Map0Config, scriptUrl: string, height = "520px"): string {
  const json = serializeConfig(cfg)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return [
    `<script type="module" src="${scriptUrl}"></script>`,
    ``,
    `<map0-viewer style="height:${height}">`,
    `  <script type="application/json">`,
    json,
    `  </script>`,
    `</map0-viewer>`,
  ].join("\n");
}

/** the playground link that carries this config (`?c=` JSON, like the demos) */
export function playgroundUrl(cfg: Map0Config, prefix = ""): string {
  return `${prefix}/playground/?c=${encodeURIComponent(JSON.stringify(cleanConfig(cfg)))}`;
}
