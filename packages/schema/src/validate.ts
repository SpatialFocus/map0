/**
 * Hand-rolled structural validation for config v0.
 * Produces friendly, JSON-path-addressed errors (rendered by the UI error panel).
 * Will be superseded by a published JSON Schema in M1 — see docs/07-roadmap.md.
 */
import type { Map0Config } from "./types.js";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** typed view of the input; only safe to use when valid === true */
  config?: Map0Config;
}

const BASEMAP_TYPES = ["style", "raster", "empty"];
const LAYER_TYPES = ["group", "wms", "raster", "geojson", "vector"];

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

export function validateConfig(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  if (!isObject(input)) {
    err("$", "config must be a JSON object");
    return { valid: false, errors };
  }

  if (input.version !== 1) {
    err("$.version", `"version" must be 1 (got ${JSON.stringify(input.version)})`);
  }

  /* basemaps */
  if (!Array.isArray(input.basemaps) || input.basemaps.length === 0) {
    err("$.basemaps", 'at least one basemap is required, e.g. { "type": "style", "url": "…" }');
  } else {
    input.basemaps.forEach((bm, i) => {
      const p = `$.basemaps[${i}]`;
      if (!isObject(bm)) return err(p, "basemap must be an object");
      if (typeof bm.type !== "string" || !BASEMAP_TYPES.includes(bm.type)) {
        err(`${p}.type`, `basemap type must be one of ${BASEMAP_TYPES.join(" | ")}`);
      } else if (bm.type !== "empty" && typeof bm.url !== "string") {
        err(`${p}.url`, `a "${bm.type}" basemap needs a "url"`);
      }
    });
  }

  /* map */
  if (input.map !== undefined) {
    if (!isObject(input.map)) {
      err("$.map", "map must be an object");
    } else {
      const m = input.map;
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
      if (m.projection !== undefined && m.projection !== "mercator" && m.projection !== "globe")
        err("$.map.projection", 'projection must be "mercator" or "globe"');
    }
  }

  /* layers (recursive) */
  if (input.layers !== undefined) {
    if (!Array.isArray(input.layers)) {
      err("$.layers", "layers must be an array");
    } else {
      validateLayers(input.layers, "$.layers", err);
    }
  }

  /* theme */
  if (input.theme !== undefined && isObject(input.theme)) {
    const mode = input.theme.mode;
    if (mode !== undefined && !["auto", "light", "dark"].includes(mode as string))
      err("$.theme.mode", 'theme.mode must be "auto" | "light" | "dark"');
  }

  const valid = errors.length === 0;
  return valid
    ? { valid, errors, config: input as unknown as Map0Config }
    : { valid, errors };
}

function validateLayers(
  layers: unknown[],
  basePath: string,
  err: (path: string, message: string) => void,
): void {
  layers.forEach((layer, i) => {
    const p = `${basePath}[${i}]`;
    if (!isObject(layer)) return err(p, "layer must be an object");
    const type = layer.type;
    if (typeof type !== "string" || !LAYER_TYPES.includes(type)) {
      return err(`${p}.type`, `layer type must be one of ${LAYER_TYPES.join(" | ")}`);
    }
    switch (type) {
      case "group":
        if (!Array.isArray(layer.children))
          err(`${p}.children`, 'a "group" needs a "children" array');
        else validateLayers(layer.children, `${p}.children`, err);
        break;
      case "wms":
        if (typeof layer.url !== "string") err(`${p}.url`, 'a "wms" layer needs a "url"');
        if (typeof layer.layers !== "string")
          err(`${p}.layers`, 'a "wms" layer needs "layers" (WMS LAYERS parameter)');
        if (
          layer.version !== undefined &&
          layer.version !== "1.1.1" &&
          layer.version !== "1.3.0"
        )
          err(`${p}.version`, 'wms version must be "1.1.1" or "1.3.0"');
        break;
      case "raster":
        if (typeof layer.url !== "string")
          err(`${p}.url`, 'a "raster" layer needs a "url" ({z}/{x}/{y} template)');
        break;
      case "geojson":
        if (layer.data === undefined)
          err(`${p}.data`, 'a "geojson" layer needs "data" (URL or inline GeoJSON)');
        else if (typeof layer.data !== "string" && !isObject(layer.data))
          err(`${p}.data`, '"data" must be a URL string or a GeoJSON object');
        break;
      case "vector":
        if (typeof layer.url !== "string")
          err(`${p}.url`, 'a "vector" layer needs a "url" (TileJSON, tile template, or pmtiles://)');
        if (!Array.isArray(layer.style))
          err(`${p}.style`, 'a "vector" layer needs "style": an array of MapLibre layer objects');
        break;
    }
    if (
      layer.opacity !== undefined &&
      (typeof layer.opacity !== "number" || layer.opacity < 0 || layer.opacity > 1)
    ) {
      err(`${p}.opacity`, "opacity must be a number between 0 and 1");
    }
  });
}
