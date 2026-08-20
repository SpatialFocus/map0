/**
 * Structural validation for config v1 — the system boundary of map0.
 * Everything that can be known before a map exists is decided here, with
 * friendly, JSON-path-addressed errors (rendered by the UI error panel):
 * shapes, enums, ranges, unknown keys, id uniqueness and the transport policy
 * (N6). A config that passes this may still fail against a live service — that
 * is what the per-layer status is for.
 * The published JSON Schema (../v1.json) is hand-written against the same key
 * tables; v1-schema.test.ts keeps the two from drifting.
 */
import type { Map0Config } from "./types.js";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /**
   * Non-fatal notes — today: unknown keys. C5 requires forward-compatible
   * parsing: a config written for a newer map0 must still open, so an
   * unrecognised key is reported and ignored, never a reason to refuse the map.
   */
  warnings: ValidationError[];
  /** typed view of the input; only safe to use when valid === true */
  config?: Map0Config;
}

/** report a problem; `severity: "warning"` keeps it out of the fatal set (C5) */
type Err = (path: string, message: string, severity?: "warning") => void;

export const BASEMAP_TYPES = ["style", "raster", "empty"];
export const LAYER_TYPES = ["group", "wms", "wmts", "raster", "cog", "geojson", "vector"];
export const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

/* ---------------------------- key tables & enums ----------------------------
 * The single source of truth for which keys and values exist per config shape.
 * Exported because the published JSON Schema (v1.json, hand-written for the
 * sake of its descriptions) is checked against these tables by
 * v1-schema.test.ts — add a key here and that test fails until v1.json
 * knows it too, and vice versa.
 * --------------------------------------------------------------------------- */

export const CONFIG_KEYS = [
  "$schema",
  "version",
  "extends",
  "meta",
  "map",
  "basemaps",
  "layers",
  "controls",
  "search",
  "print",
  "theme",
  "i18n",
  "permalink",
];
export const META_KEYS = ["title", "description"];
export const MAP_KEYS = [
  "center",
  "zoom",
  "bounds",
  "minZoom",
  "maxZoom",
  "maxBounds",
  "bearing",
  "pitch",
  "projection",
  "hash",
];
export const PROJECTIONS = ["mercator", "globe"];
export const BASEMAP_KEYS = [
  "id",
  "title",
  "type",
  "url",
  "tileSize",
  "minZoom",
  "maxZoom",
  "attribution",
  "thumbnail",
  "default",
];
const LAYER_COMMON_KEYS = [
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
];
export const LAYER_KEYS: Record<string, string[]> = {
  group: ["type", "title", "collapsed", "children"],
  wms: [
    ...LAYER_COMMON_KEYS,
    "url",
    "layers",
    "styles",
    "format",
    "version",
    "transparent",
    "tileSize",
    "params",
    "info",
  ],
  wmts: [...LAYER_COMMON_KEYS, "url", "layer", "matrixSet", "style", "format"],
  raster: [...LAYER_COMMON_KEYS, "url", "tileSize"],
  cog: [...LAYER_COMMON_KEYS, "url", "color", "hillshade"],
  geojson: [...LAYER_COMMON_KEYS, "data", "style", "cluster", "popup", "hover", "promoteId"],
  vector: [...LAYER_COMMON_KEYS, "url", "sourceLayer", "style", "popup", "hover"],
};
export const POPUP_KEYS = ["title", "content", "fields", "maxWidth"];
export const FIELD_KEYS = ["key", "label"];
export const HOVER_KEYS = ["content"];
export const WMS_INFO_KEYS = [...POPUP_KEYS, "format"];
export const WMS_VERSIONS = ["1.1.1", "1.3.0"];
export const METADATA_KEYS = ["url", "title"];
export const LEGEND_ENTRY_KEYS = ["label", "color", "shape", "image"];
export const LEGEND_SHAPES = ["square", "line", "circle"];
export const CLUSTER_KEYS = ["enabled", "radius", "maxZoom"];
export const HILLSHADE_KEYS = [
  "exaggeration",
  "illuminationDirection",
  "shadowColor",
  "highlightColor",
  "accentColor",
];
export const COG_COLOR_KEYS = ["scheme", "min", "max", "continuous", "reverse"];
export const CONTROL_KEYS = [
  "navigation",
  "scale",
  "fullscreen",
  "geolocate",
  "globe",
  "home",
  "attribution",
  "layerSwitcher",
  "basemapSwitcher",
  "legend",
  "print",
  "measure",
  "coordinates",
];
export const SCALE_KEYS = ["maxWidth", "unit"];
export const SCALE_UNITS = ["metric", "imperial"];
export const GEOLOCATE_KEYS = ["follow"];
export const ATTRIBUTION_KEYS = ["compact"];
export const LAYER_SWITCHER_KEYS = ["position", "open", "title", "allowAdd"];
export const BASEMAP_SWITCHER_KEYS = ["position"];
export const LEGEND_CONTROL_KEYS = ["position", "open"];
export const COORDINATES_KEYS = ["crs"];
export const CRS_KEYS = ["code", "label", "def"];
export const SEARCH_KEYS = [
  "enabled",
  "provider",
  "url",
  "country",
  "bias",
  "limit",
  "minLength",
  "placeholder",
  "coordinates",
];
export const PROVIDER_NAMES = ["photon", "nominatim"];
export const PROVIDER_KEYS = ["url", "format", "labelField"];
export const PROVIDER_FORMATS = ["geojson", "nominatim"];
export const THEME_KEYS = ["mode", "primary", "radius", "font"];
export const THEME_MODES = ["auto", "light", "dark"];
export const THEME_RADII = ["none", "sm", "md", "lg"];
export const I18N_KEYS = ["locale", "fallback", "overrides"];
export const PERMALINK_KEYS = ["param"];
export const PRINT_KEYS = ["formats", "sizes", "dpi", "elements"];
export const PRINT_FORMATS = ["png", "pdf"];
export const PRINT_SIZES = ["current", "A4-landscape", "A4-portrait", "A3-landscape", "A3-portrait"];
export const PRINT_ELEMENTS = ["title", "legend", "scalebar", "attribution", "date"];

/* ------------------------------- primitives ------------------------------- */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isLonLat(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (v[0] as number) >= -180 &&
    (v[0] as number) <= 180 &&
    (v[1] as number) >= -90 &&
    (v[1] as number) <= 90
  );
}

function isBounds(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * A typo in a key is the most common config bug and used to be invisible until
 * someone wondered why a setting did nothing. It is a *warning*, not an error:
 * C5 promises that a config carrying keys this version does not know still
 * opens the map.
 */
function checkKeys(obj: Record<string, unknown>, allowed: string[], path: string, err: Err): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      err(
        `${path}.${key}`,
        `unknown key "${key}" — ignored; allowed here: ${allowed.join(", ")}`,
        "warning",
      );
    }
  }
}

function expectString(v: unknown, path: string, err: Err): void {
  if (v !== undefined && typeof v !== "string") err(path, "must be a string");
}

function expectBoolean(v: unknown, path: string, err: Err): void {
  if (v !== undefined && typeof v !== "boolean") err(path, "must be true or false");
}

function expectNumber(v: unknown, path: string, err: Err, min?: number, max?: number): void {
  if (v === undefined) return;
  if (typeof v !== "number" || !Number.isFinite(v)) return err(path, "must be a number");
  if (min !== undefined && max !== undefined && (v < min || v > max)) {
    err(path, `must be a number between ${min} and ${max}`);
  }
}

function expectEnum(v: unknown, values: string[], path: string, err: Err): void {
  if (v !== undefined && (typeof v !== "string" || !values.includes(v))) {
    err(path, `must be one of ${values.map((x) => `"${x}"`).join(" | ")}`);
  }
}

/** `false` or an object of the given shape — the recurring "off or configured" pattern */
function expectToggleObject(
  v: unknown,
  path: string,
  err: Err,
  allowed: string[],
  shape?: (o: Record<string, unknown>) => void,
): void {
  if (v === undefined || typeof v === "boolean") return;
  if (!isObject(v)) return err(path, "must be true, false, or an options object");
  checkKeys(v, allowed, path, err);
  shape?.(v);
}

/* --------------------------- transport policy (N6) -------------------------- */

const LOOPBACK = /^(localhost|[^.]+\.localhost|127(\.\d+){3}|\[::1\]|::1)$/i;

/** true when the embedding page itself is plain http (intranet deployments) */
function pageIsInsecure(): boolean {
  return typeof location !== "undefined" && location.protocol === "http:";
}

/**
 * Every URL in a config is fetched by the browser, so `http://` is not a style
 * question: on an https page it is blocked as mixed content and the layer stays
 * empty with only a console message. Fail here instead (N6). Relative URLs
 * inherit the page's scheme and are always fine; loopback hosts and plain-http
 * pages are the documented exceptions.
 */
function checkUrl(value: unknown, path: string, err: Err): void {
  if (typeof value !== "string") return;
  const url = value.startsWith("pmtiles://") ? value.slice("pmtiles://".length) : value;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return; // relative
  if (scheme === "https" || scheme === "data" || scheme === "blob") return;
  if (scheme === "http") {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* a template with placeholders — treat as remote */
    }
    if (LOOPBACK.test(host) || pageIsInsecure()) return;
    err(
      path,
      `use https: an http URL is blocked as mixed content on an https page ` +
        `(allowed for localhost, or when the page itself is served over http)`,
    );
    return;
  }
  err(path, `unsupported URL scheme "${scheme}:" — use https, a relative URL, or pmtiles://`);
}

/* -------------------------------- validation ------------------------------- */

export function validateConfig(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const err: Err = (path, message, severity) =>
    (severity === "warning" ? warnings : errors).push({ path, message });

  if (!isObject(input)) {
    err("$", "config must be a JSON object");
    return { valid: false, errors, warnings };
  }

  checkKeys(input, CONFIG_KEYS, "$", err);

  if (input.version !== 1) {
    err("$.version", `"version" must be 1 (got ${JSON.stringify(input.version)})`);
  }
  expectString(input.$schema, "$.$schema", err);
  expectString(input.extends, "$.extends", err);

  /* ids are one namespace across basemaps and layers: the share state and the
     JS API address both by id, so a collision silently targets the wrong thing */
  const ids = new Map<string, string>();
  const claimId = (id: unknown, path: string): void => {
    if (typeof id !== "string") return err(path, "must be a string");
    if (!id) return err(path, "must not be empty");
    const first = ids.get(id);
    if (first) err(path, `duplicate id "${id}" — already used by ${first}`);
    else ids.set(id, path);
  };

  /* meta */
  if (input.meta !== undefined) {
    if (!isObject(input.meta)) err("$.meta", "meta must be an object");
    else {
      checkKeys(input.meta, META_KEYS, "$.meta", err);
      expectString(input.meta.title, "$.meta.title", err);
      expectString(input.meta.description, "$.meta.description", err);
    }
  }

  /* basemaps */
  if (!Array.isArray(input.basemaps) || input.basemaps.length === 0) {
    err("$.basemaps", 'at least one basemap is required, e.g. { "type": "style", "url": "…" }');
  } else {
    input.basemaps.forEach((bm, i) => {
      const p = `$.basemaps[${i}]`;
      if (!isObject(bm)) return err(p, "basemap must be an object");
      checkKeys(bm, BASEMAP_KEYS, p, err);
      if (typeof bm.type !== "string" || !BASEMAP_TYPES.includes(bm.type)) {
        err(`${p}.type`, `basemap type must be one of ${BASEMAP_TYPES.join(" | ")}`);
      } else if (bm.type !== "empty" && typeof bm.url !== "string") {
        err(`${p}.url`, `a "${bm.type}" basemap needs a "url"`);
      }
      if (bm.id !== undefined) claimId(bm.id, `${p}.id`);
      expectString(bm.title, `${p}.title`, err);
      expectString(bm.attribution, `${p}.attribution`, err);
      expectBoolean(bm.default, `${p}.default`, err);
      expectNumber(bm.tileSize, `${p}.tileSize`, err, 1, 4096);
      expectNumber(bm.minZoom, `${p}.minZoom`, err, 0, 24);
      expectNumber(bm.maxZoom, `${p}.maxZoom`, err, 0, 24);
      checkUrl(bm.url, `${p}.url`, err);
      checkUrl(bm.thumbnail, `${p}.thumbnail`, err);
    });
  }

  /* map */
  if (input.map !== undefined) {
    if (!isObject(input.map)) {
      err("$.map", "map must be an object");
    } else {
      const m = input.map;
      checkKeys(m, MAP_KEYS, "$.map", err);
      if (m.center !== undefined && !isLonLat(m.center))
        err("$.map.center", "center must be [lon, lat] in WGS84 ranges");
      if (m.bounds !== undefined && !isBounds(m.bounds))
        err("$.map.bounds", "bounds must be [west, south, east, north]");
      if (m.maxBounds !== undefined && !isBounds(m.maxBounds))
        err("$.map.maxBounds", "maxBounds must be [west, south, east, north]");
      for (const k of ["zoom", "minZoom", "maxZoom"] as const) {
        const v = m[k];
        if (v !== undefined && (typeof v !== "number" || v < 0 || v > 24))
          err(`$.map.${k}`, `${k} must be a number between 0 and 24`);
      }
      expectNumber(m.bearing, "$.map.bearing", err, -360, 360);
      expectNumber(m.pitch, "$.map.pitch", err, 0, 85);
      expectBoolean(m.hash, "$.map.hash", err);
      expectEnum(m.projection, PROJECTIONS, "$.map.projection", err);
    }
  }

  /* layers (recursive) */
  if (input.layers !== undefined) {
    if (!Array.isArray(input.layers)) {
      err("$.layers", "layers must be an array");
    } else {
      validateLayers(input.layers, "$.layers", err, claimId);
    }
  }

  validateControls(input.controls, err);
  validateSearch(input.search, err);
  validatePrint(input.print, err);

  /* theme */
  if (input.theme !== undefined) {
    if (!isObject(input.theme)) err("$.theme", "theme must be an object");
    else {
      checkKeys(input.theme, THEME_KEYS, "$.theme", err);
      expectEnum(input.theme.mode, THEME_MODES, "$.theme.mode", err);
      expectEnum(input.theme.radius, THEME_RADII, "$.theme.radius", err);
      expectString(input.theme.primary, "$.theme.primary", err);
      expectString(input.theme.font, "$.theme.font", err);
    }
  }

  /* i18n */
  if (input.i18n !== undefined) {
    if (!isObject(input.i18n)) err("$.i18n", "i18n must be an object");
    else {
      checkKeys(input.i18n, I18N_KEYS, "$.i18n", err);
      expectString(input.i18n.locale, "$.i18n.locale", err);
      expectString(input.i18n.fallback, "$.i18n.fallback", err);
      const ov = input.i18n.overrides;
      if (ov !== undefined) {
        if (!isObject(ov)) err("$.i18n.overrides", "overrides must be an object of locale → strings");
        else {
          for (const [locale, strings] of Object.entries(ov)) {
            if (!isObject(strings)) {
              err(`$.i18n.overrides.${locale}`, "must be an object of key → text");
            } else {
              for (const [key, text] of Object.entries(strings)) {
                expectString(text, `$.i18n.overrides.${locale}.${key}`, err);
              }
            }
          }
        }
      }
    }
  }

  /* permalink */
  if (input.permalink !== undefined && typeof input.permalink !== "boolean") {
    if (!isObject(input.permalink)) {
      err("$.permalink", 'permalink must be true, false, or { "param": "…" }');
    } else {
      checkKeys(input.permalink, PERMALINK_KEYS, "$.permalink", err);
      const param = input.permalink.param;
      if (param !== undefined && (typeof param !== "string" || !/^[A-Za-z0-9_-]+$/.test(param))) {
        err("$.permalink.param", "param must be a hash-safe name ([A-Za-z0-9_-])");
      }
    }
  }

  const valid = errors.length === 0;
  return valid
    ? { valid, errors, warnings, config: input as unknown as Map0Config }
    : { valid, errors, warnings };
}

/* --------------------------------- layers --------------------------------- */

function validateLayers(
  layers: unknown[],
  basePath: string,
  err: Err,
  claimId: (id: unknown, path: string) => void,
): void {
  layers.forEach((layer, i) => {
    const p = `${basePath}[${i}]`;
    if (!isObject(layer)) return err(p, "layer must be an object");
    const type = layer.type;
    if (typeof type !== "string" || !LAYER_TYPES.includes(type)) {
      return err(`${p}.type`, `layer type must be one of ${LAYER_TYPES.join(" | ")}`);
    }
    checkKeys(layer, LAYER_KEYS[type]!, p, err);

    if (type === "group") {
      expectString(layer.title, `${p}.title`, err);
      expectBoolean(layer.collapsed, `${p}.collapsed`, err);
      if (!Array.isArray(layer.children)) err(`${p}.children`, 'a "group" needs a "children" array');
      else validateLayers(layer.children, `${p}.children`, err, claimId);
      return;
    }

    /* common leaf-layer fields */
    if (layer.id !== undefined) claimId(layer.id, `${p}.id`);
    expectString(layer.title, `${p}.title`, err);
    expectBoolean(layer.visible, `${p}.visible`, err);
    expectString(layer.attribution, `${p}.attribution`, err);
    expectNumber(layer.minZoom, `${p}.minZoom`, err, 0, 24);
    expectNumber(layer.maxZoom, `${p}.maxZoom`, err, 0, 24);
    if (layer.bounds !== undefined && !isBounds(layer.bounds))
      err(`${p}.bounds`, "bounds must be [west, south, east, north]");
    if (
      layer.opacity !== undefined &&
      (typeof layer.opacity !== "number" || layer.opacity < 0 || layer.opacity > 1)
    ) {
      err(`${p}.opacity`, "opacity must be a number between 0 and 1");
    }
    if (layer.metadata !== undefined) {
      if (!isObject(layer.metadata)) err(`${p}.metadata`, 'metadata must be { "url": "…", "title": "…" }');
      else {
        checkKeys(layer.metadata, ["url", "title"], `${p}.metadata`, err);
        expectString(layer.metadata.url, `${p}.metadata.url`, err);
        expectString(layer.metadata.title, `${p}.metadata.title`, err);
        checkUrl(layer.metadata.url, `${p}.metadata.url`, err);
      }
    }
    validateLegend(layer.legend, p, err);

    switch (type) {
      case "wms":
        if (typeof layer.url !== "string") err(`${p}.url`, 'a "wms" layer needs a "url"');
        if (typeof layer.layers !== "string")
          err(`${p}.layers`, 'a "wms" layer needs "layers" (WMS LAYERS parameter)');
        expectEnum(layer.version, WMS_VERSIONS, `${p}.version`, err);
        expectString(layer.styles, `${p}.styles`, err);
        expectString(layer.format, `${p}.format`, err);
        expectBoolean(layer.transparent, `${p}.transparent`, err);
        expectNumber(layer.tileSize, `${p}.tileSize`, err, 1, 4096);
        if (layer.params !== undefined) {
          if (!isObject(layer.params)) err(`${p}.params`, "params must be an object of vendor parameters");
          else
            for (const [k, v] of Object.entries(layer.params))
              expectString(v, `${p}.params.${k}`, err);
        }
        if (layer.info !== undefined && layer.info !== false) {
          if (!isObject(layer.info)) err(`${p}.info`, "info must be false or a popup object");
          else {
            checkKeys(layer.info, WMS_INFO_KEYS, `${p}.info`, err);
            validatePopupShape(layer.info, `${p}.info`, err);
          }
        }
        break;
      case "wmts":
        if (typeof layer.url !== "string")
          err(`${p}.url`, 'a "wmts" layer needs a "url" (GetCapabilities URL)');
        if (typeof layer.layer !== "string")
          err(`${p}.layer`, 'a "wmts" layer needs a "layer" (identifier from the capabilities)');
        expectString(layer.matrixSet, `${p}.matrixSet`, err);
        expectString(layer.style, `${p}.style`, err);
        expectString(layer.format, `${p}.format`, err);
        break;
      case "raster":
        if (typeof layer.url !== "string")
          err(`${p}.url`, 'a "raster" layer needs a "url" ({z}/{x}/{y} template)');
        expectNumber(layer.tileSize, `${p}.tileSize`, err, 1, 4096);
        break;
      case "cog":
        if (typeof layer.url !== "string")
          err(`${p}.url`, 'a "cog" layer needs a "url" (Cloud Optimized GeoTIFF in EPSG:3857)');
        if (layer.color !== undefined && layer.hillshade !== undefined && layer.hillshade !== false)
          err(`${p}.hillshade`, '"color" and "hillshade" are mutually exclusive — pick one rendering');
        expectToggleObject(
          layer.hillshade,
          `${p}.hillshade`,
          err,
          HILLSHADE_KEYS,
          (o) => {
            expectNumber(o.exaggeration, `${p}.hillshade.exaggeration`, err, 0, 1);
            expectNumber(o.illuminationDirection, `${p}.hillshade.illuminationDirection`, err, 0, 359);
            expectString(o.shadowColor, `${p}.hillshade.shadowColor`, err);
            expectString(o.highlightColor, `${p}.hillshade.highlightColor`, err);
            expectString(o.accentColor, `${p}.hillshade.accentColor`, err);
          },
        );
        if (layer.color !== undefined) {
          if (!isObject(layer.color)) {
            err(`${p}.color`, 'color must be { "scheme", "min", "max", "continuous"?, "reverse"? }');
          } else {
            const c = layer.color;
            checkKeys(c, COG_COLOR_KEYS, `${p}.color`, err);
            if (typeof c.scheme !== "string" || !c.scheme)
              err(`${p}.color.scheme`, 'color needs a "scheme" (ramp name, e.g. "BrewerSpectral7")');
            if (typeof c.min !== "number" || !Number.isFinite(c.min))
              err(`${p}.color.min`, 'color needs a numeric "min" (value of the first ramp color)');
            if (typeof c.max !== "number" || !Number.isFinite(c.max))
              err(`${p}.color.max`, 'color needs a numeric "max" (value of the last ramp color)');
            if (typeof c.min === "number" && typeof c.max === "number" && !(c.min < c.max))
              err(`${p}.color.max`, '"max" must be greater than "min"');
            expectBoolean(c.continuous, `${p}.color.continuous`, err);
            expectBoolean(c.reverse, `${p}.color.reverse`, err);
          }
        }
        break;
      case "geojson":
        if (layer.data === undefined)
          err(`${p}.data`, 'a "geojson" layer needs "data" (URL or inline GeoJSON)');
        else if (typeof layer.data !== "string" && !isObject(layer.data))
          err(`${p}.data`, '"data" must be a URL string or a GeoJSON object');
        else checkUrl(layer.data, `${p}.data`, err);
        if (layer.style !== undefined && !isObject(layer.style) && !Array.isArray(layer.style))
          err(`${p}.style`, "style must be a paint object or an array of style-spec layers");
        if (
          layer.cluster !== undefined &&
          typeof layer.cluster !== "boolean" &&
          !isObject(layer.cluster)
        )
          err(`${p}.cluster`, "cluster must be true, false, or an options object");
        if (isObject(layer.cluster)) {
          checkKeys(layer.cluster, CLUSTER_KEYS, `${p}.cluster`, err);
          expectBoolean(layer.cluster.enabled, `${p}.cluster.enabled`, err);
          expectNumber(layer.cluster.radius, `${p}.cluster.radius`, err, 1, 1000);
          expectNumber(layer.cluster.maxZoom, `${p}.cluster.maxZoom`, err, 0, 24);
        }
        expectString(layer.promoteId, `${p}.promoteId`, err);
        validatePopup(layer.popup, `${p}.popup`, err);
        validateHover(layer.hover, `${p}.hover`, err);
        break;
      case "vector":
        if (typeof layer.url !== "string")
          err(`${p}.url`, 'a "vector" layer needs a "url" (TileJSON, tile template, or pmtiles://)');
        if (!Array.isArray(layer.style))
          err(`${p}.style`, 'a "vector" layer needs "style": an array of MapLibre layer objects');
        else
          layer.style.forEach((s, j) => {
            if (!isObject(s) || typeof s.type !== "string")
              err(`${p}.style[${j}]`, 'a style layer needs at least a "type"');
          });
        expectString(layer.sourceLayer, `${p}.sourceLayer`, err);
        validatePopup(layer.popup, `${p}.popup`, err);
        validateHover(layer.hover, `${p}.hover`, err);
        break;
    }
    if (type !== "geojson") checkUrl(layer.url, `${p}.url`, err);
  });
}

function validateLegend(legend: unknown, p: string, err: Err): void {
  if (legend === undefined || legend === false || legend === "auto") return;
  if (typeof legend === "string") return checkUrl(legend, `${p}.legend`, err);
  if (!Array.isArray(legend)) {
    return err(`${p}.legend`, 'legend must be "auto", false, an image URL, or an array of entries');
  }
  legend.forEach((entry, j) => {
    if (!isObject(entry) || typeof entry.label !== "string") {
      return err(`${p}.legend[${j}]`, 'a legend entry needs at least a "label"');
    }
    checkKeys(entry, LEGEND_ENTRY_KEYS, `${p}.legend[${j}]`, err);
    expectString(entry.color, `${p}.legend[${j}].color`, err);
    expectEnum(entry.shape, LEGEND_SHAPES, `${p}.legend[${j}].shape`, err);
    checkUrl(entry.image, `${p}.legend[${j}].image`, err);
  });
}

function validatePopupShape(popup: Record<string, unknown>, path: string, err: Err): void {
  expectString(popup.title, `${path}.title`, err);
  expectString(popup.content, `${path}.content`, err);
  expectString(popup.maxWidth, `${path}.maxWidth`, err);
  expectString(popup.format, `${path}.format`, err);
  if (popup.fields !== undefined) {
    if (!Array.isArray(popup.fields)) err(`${path}.fields`, "fields must be an array");
    else
      popup.fields.forEach((f, j) => {
        if (!isObject(f) || typeof f.key !== "string")
          err(`${path}.fields[${j}]`, 'a field needs a "key"');
        else {
          checkKeys(f, FIELD_KEYS, `${path}.fields[${j}]`, err);
          expectString(f.label, `${path}.fields[${j}].label`, err);
        }
      });
  }
}

function validatePopup(popup: unknown, path: string, err: Err): void {
  if (popup === undefined || popup === false) return;
  if (!isObject(popup)) return err(path, "popup must be false or an object");
  checkKeys(popup, POPUP_KEYS, path, err);
  validatePopupShape(popup, path, err);
}

function validateHover(hover: unknown, path: string, err: Err): void {
  if (hover === undefined || hover === false) return;
  if (!isObject(hover) || typeof hover.content !== "string") {
    return err(path, 'hover must be false or { "content": "template" }');
  }
  checkKeys(hover, HOVER_KEYS, path, err);
}

/* -------------------------------- controls -------------------------------- */

function validateControls(controls: unknown, err: Err): void {
  if (controls === undefined) return;
  if (!isObject(controls)) return err("$.controls", "controls must be an object");
  checkKeys(controls, CONTROL_KEYS, "$.controls", err);

  for (const k of ["navigation", "fullscreen", "globe", "home", "print", "measure"] as const) {
    expectBoolean(controls[k], `$.controls.${k}`, err);
  }
  expectToggleObject(controls.scale, "$.controls.scale", err, SCALE_KEYS, (o) => {
    expectNumber(o.maxWidth, "$.controls.scale.maxWidth", err, 20, 500);
    expectEnum(o.unit, SCALE_UNITS, "$.controls.scale.unit", err);
  });
  expectToggleObject(controls.geolocate, "$.controls.geolocate", err, GEOLOCATE_KEYS, (o) => {
    expectBoolean(o.follow, "$.controls.geolocate.follow", err);
  });
  expectToggleObject(controls.attribution, "$.controls.attribution", err, ATTRIBUTION_KEYS, (o) => {
    if (o.compact !== undefined && typeof o.compact !== "boolean" && o.compact !== "auto")
      err("$.controls.attribution.compact", 'compact must be true, false, or "auto"');
  });
  expectToggleObject(
    controls.layerSwitcher,
    "$.controls.layerSwitcher",
    err,
    LAYER_SWITCHER_KEYS,
    (o) => {
      expectEnum(o.position, POSITIONS, "$.controls.layerSwitcher.position", err);
      if (o.open !== undefined && typeof o.open !== "boolean" && o.open !== "auto")
        err("$.controls.layerSwitcher.open", 'open must be true, false, or "auto"');
      expectString(o.title, "$.controls.layerSwitcher.title", err);
      expectBoolean(o.allowAdd, "$.controls.layerSwitcher.allowAdd", err);
    },
  );
  expectToggleObject(controls.basemapSwitcher, "$.controls.basemapSwitcher", err, BASEMAP_SWITCHER_KEYS, (o) => {
    expectEnum(o.position, POSITIONS, "$.controls.basemapSwitcher.position", err);
  });
  expectToggleObject(controls.legend, "$.controls.legend", err, LEGEND_CONTROL_KEYS, (o) => {
    expectEnum(o.position, POSITIONS, "$.controls.legend.position", err);
    expectBoolean(o.open, "$.controls.legend.open", err);
  });
  expectToggleObject(controls.coordinates, "$.controls.coordinates", err, COORDINATES_KEYS, (o) => {
    if (o.crs === undefined) return;
    if (!Array.isArray(o.crs)) return err("$.controls.coordinates.crs", "crs must be an array");
    o.crs.forEach((entry, i) => {
      const p = `$.controls.coordinates.crs[${i}]`;
      if (!isObject(entry) || typeof entry.code !== "string")
        return err(p, 'a CRS entry needs a "code", e.g. { "code": "EPSG:31256" }');
      checkKeys(entry, CRS_KEYS, p, err);
      expectString(entry.label, `${p}.label`, err);
      expectString(entry.def, `${p}.def`, err);
    });
  });
}

/* --------------------------------- search --------------------------------- */

function validateSearch(search: unknown, err: Err): void {
  if (search === undefined) return;
  if (!isObject(search)) return err("$.search", "search must be an object");
  checkKeys(search, SEARCH_KEYS, "$.search", err);
  expectBoolean(search.enabled, "$.search.enabled", err);
  expectBoolean(search.bias, "$.search.bias", err);
  expectBoolean(search.coordinates, "$.search.coordinates", err);
  expectString(search.country, "$.search.country", err);
  expectString(search.placeholder, "$.search.placeholder", err);
  expectNumber(search.limit, "$.search.limit", err, 1, 50);
  expectNumber(search.minLength, "$.search.minLength", err, 1, 20);
  expectString(search.url, "$.search.url", err);
  checkUrl(search.url, "$.search.url", err);

  const provider = search.provider;
  if (provider === undefined) return;
  if (isObject(provider)) {
    checkKeys(provider, PROVIDER_KEYS, "$.search.provider", err);
    if (typeof provider.url !== "string")
      err("$.search.provider.url", "a custom geocoder needs a url template with {query}");
    else if (!provider.url.includes("{query}"))
      err("$.search.provider.url", 'the url template must contain the "{query}" placeholder');
    else checkUrl(provider.url, "$.search.provider.url", err);
    expectEnum(provider.format, PROVIDER_FORMATS, "$.search.provider.format", err);
    expectString(provider.labelField, "$.search.provider.labelField", err);
  } else if (typeof provider !== "string" || !PROVIDER_NAMES.includes(provider)) {
    err("$.search.provider", 'provider must be "photon", "nominatim", or a { url, format } object');
  }
}

/* ---------------------------------- print --------------------------------- */

function validatePrint(print: unknown, err: Err): void {
  if (print === undefined) return;
  if (!isObject(print)) return err("$.print", "print must be an object");
  checkKeys(print, PRINT_KEYS, "$.print", err);
  const list = (value: unknown, path: string, allowed: string[]): void => {
    if (value === undefined) return;
    if (!Array.isArray(value)) return err(path, "must be an array");
    value.forEach((v, i) => expectEnum(v, allowed, `${path}[${i}]`, err));
  };
  list(print.formats, "$.print.formats", PRINT_FORMATS);
  list(print.sizes, "$.print.sizes", PRINT_SIZES);
  list(print.elements, "$.print.elements", PRINT_ELEMENTS);
  if (print.dpi !== undefined) {
    if (!Array.isArray(print.dpi)) err("$.print.dpi", "dpi must be an array of numbers");
    else print.dpi.forEach((v, i) => expectNumber(v, `$.print.dpi[${i}]`, err, 72, 600));
  }
}
