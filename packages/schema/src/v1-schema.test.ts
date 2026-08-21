/**
 * v1.json — the published JSON Schema (https://map0.net/schema/v1.json) — is
 * written by hand, because its descriptions ARE the editor documentation and a
 * generator cannot write those. What it must never do is drift from the runtime
 * validator, so this file locks every key set and enum in v1.json to the tables
 * exported by validate.ts: add a key there and a test here fails until v1.json
 * documents it — and vice versa.
 *
 * The schema is also compiled with ajv and run against every demo config, so a
 * broken $ref or an over-strict shape fails here, not in someone's editor.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_KEYS,
  BASEMAP_KEYS,
  BASEMAP_SWITCHER_KEYS,
  BASEMAP_TYPES,
  CLUSTER_KEYS,
  COG_COLOR_CLASS_KEYS,
  COG_COLOR_KEYS,
  CONFIG_KEYS,
  CONTROL_KEYS,
  COORDINATES_KEYS,
  CRS_KEYS,
  FIELD_KEYS,
  GEOLOCATE_KEYS,
  HILLSHADE_KEYS,
  HOVER_KEYS,
  I18N_KEYS,
  LAYER_KEYS,
  LAYER_SWITCHER_KEYS,
  LAYER_TYPES,
  LEGEND_CONTROL_KEYS,
  LEGEND_ENTRY_KEYS,
  LEGEND_SHAPES,
  MAP_KEYS,
  META_KEYS,
  METADATA_KEYS,
  PERMALINK_KEYS,
  POPUP_KEYS,
  POSITIONS,
  PRINT_ELEMENTS,
  PRINT_FORMATS,
  PRINT_KEYS,
  PRINT_SIZES,
  PROJECTIONS,
  PROVIDER_FORMATS,
  PROVIDER_KEYS,
  PROVIDER_NAMES,
  SCALE_KEYS,
  SCALE_UNITS,
  SEARCH_KEYS,
  THEME_KEYS,
  THEME_MODES,
  THEME_RADII,
  WMS_INFO_KEYS,
  WMS_VERSIONS,
  validateConfig,
} from "./validate.js";

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL("../v1.json", import.meta.url)), "utf8"),
) as Record<string, any>;

/** "meta.properties.title" → schema.definitions.meta.properties.title ("<root>" = the schema itself) */
function def(path: string): any {
  const [head, ...rest] = path.split(".");
  let node: any = head === "<root>" ? schema : schema.definitions[head!];
  for (const step of rest) {
    node = node?.[step];
    if (node === undefined) throw new Error(`v1.json has nothing at "${path}"`);
  }
  return node;
}

/* ------------------------- key sets ↔ validator tables ------------------------- */

const KEY_TABLES: Array<[definition: string, keys: readonly string[]]> = [
  ["<root>", CONFIG_KEYS],
  ["meta", META_KEYS],
  ["map", MAP_KEYS],
  ["basemap", BASEMAP_KEYS],
  ["groupLayer", LAYER_KEYS.group!],
  ["wmsLayer", LAYER_KEYS.wms!],
  ["wmtsLayer", LAYER_KEYS.wmts!],
  ["rasterLayer", LAYER_KEYS.raster!],
  ["cogLayer", LAYER_KEYS.cog!],
  ["geojsonLayer", LAYER_KEYS.geojson!],
  ["vectorLayer", LAYER_KEYS.vector!],
  ["popup", POPUP_KEYS],
  ["wmsInfo", WMS_INFO_KEYS],
  ["field", FIELD_KEYS],
  ["hover", HOVER_KEYS],
  ["metadata", METADATA_KEYS],
  ["legendEntry", LEGEND_ENTRY_KEYS],
  ["cogColor", COG_COLOR_KEYS],
  ["cogColorClass", COG_COLOR_CLASS_KEYS],
  ["hillshadeOptions", HILLSHADE_KEYS],
  ["clusterOptions", CLUSTER_KEYS],
  ["controls", CONTROL_KEYS],
  ["scaleOptions", SCALE_KEYS],
  ["geolocateOptions", GEOLOCATE_KEYS],
  ["attributionOptions", ATTRIBUTION_KEYS],
  ["layerSwitcherOptions", LAYER_SWITCHER_KEYS],
  ["basemapSwitcherOptions", BASEMAP_SWITCHER_KEYS],
  ["legendControlOptions", LEGEND_CONTROL_KEYS],
  ["coordinatesOptions", COORDINATES_KEYS],
  ["crs", CRS_KEYS],
  ["search", SEARCH_KEYS],
  ["customGeocoder", PROVIDER_KEYS],
  ["print", PRINT_KEYS],
  ["theme", THEME_KEYS],
  ["i18n", I18N_KEYS],
  ["permalinkOptions", PERMALINK_KEYS],
];

describe("v1.json keys match the validator tables", () => {
  it.each(KEY_TABLES)("%s", (definition, keys) => {
    const properties = def(`${definition}.properties`);
    expect(Object.keys(properties).sort()).toEqual([...keys].sort());
  });

  it("every object with a key table rejects unknown keys", () => {
    for (const [definition] of KEY_TABLES) {
      expect(def(definition).additionalProperties, `${definition}.additionalProperties`).toBe(false);
    }
  });
});

/* --------------------------- enums ↔ validator enums --------------------------- */

const ENUMS: Array<[path: string, values: readonly unknown[]]> = [
  ["basemap.properties.type.enum", BASEMAP_TYPES],
  ["map.properties.projection.enum", PROJECTIONS],
  ["wmsLayer.properties.version.enum", WMS_VERSIONS],
  ["legendEntry.properties.shape.enum", LEGEND_SHAPES],
  ["scaleOptions.properties.unit.enum", SCALE_UNITS],
  ["layerSwitcherOptions.properties.position.enum", POSITIONS],
  ["basemapSwitcherOptions.properties.position.enum", POSITIONS],
  ["legendControlOptions.properties.position.enum", POSITIONS],
  ["theme.properties.mode.enum", THEME_MODES],
  ["theme.properties.radius.enum", THEME_RADII],
  ["search.properties.provider.oneOf.0.enum", PROVIDER_NAMES],
  ["customGeocoder.properties.format.enum", PROVIDER_FORMATS],
  ["print.properties.formats.items.enum", PRINT_FORMATS],
  ["print.properties.sizes.items.enum", PRINT_SIZES],
  ["print.properties.elements.items.enum", PRINT_ELEMENTS],
];

describe("v1.json enums match the validator enums", () => {
  it.each(ENUMS)("%s", (path, values) => {
    expect(def(path)).toEqual(values);
  });

  it("the layer oneOf covers exactly the validator's layer types", () => {
    const branches = def("layer.oneOf") as Array<{ $ref: string }>;
    const types = branches.map(
      (b) => def(`${b.$ref.replace("#/definitions/", "")}.properties.type.const`) as string,
    );
    expect(types.sort()).toEqual([...LAYER_TYPES].sort());
  });

  it("requires config version 1", () => {
    expect(def("<root>.properties.version.const")).toBe(1);
  });
});

/* --------------------- required keys (mirror validateConfig) --------------------- */

/* These literals restate what validateConfig enforces in code (it has no
   required-keys table) — they exist so an accidental edit to v1.json's
   `required` arrays cannot pass unnoticed. */
describe("v1.json required keys", () => {
  it("root: version always, basemaps unless the config extends a base", () => {
    expect(def("<root>.required")).toEqual(["version"]);
    expect(def("<root>.if.required")).toEqual(["extends"]);
    expect(def("<root>.else.required")).toEqual(["basemaps"]);
  });

  it("basemap: url unless type is \"empty\"", () => {
    expect(def("basemap.required")).toEqual(["type"]);
    expect(def("basemap.else.required")).toEqual(["url"]);
  });

  it.each([
    ["groupLayer", ["type", "children"]],
    ["wmsLayer", ["type", "url", "layers"]],
    ["wmtsLayer", ["type", "url", "layer"]],
    ["rasterLayer", ["type", "url"]],
    ["cogLayer", ["type", "url"]],
    ["geojsonLayer", ["type", "data"]],
    ["vectorLayer", ["type", "url", "style"]],
  ])("%s requires %j", (definition, required) => {
    expect(def(`${definition}.required`)).toEqual(required);
  });
});

/* ------------------------------ behaves as a schema ------------------------------ */

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema); // compiling resolves every $ref — a broken one throws here

const errors = () => JSON.stringify(validate.errors, null, 2);

describe("v1.json validates configs", () => {
  it("accepts the minimal config", () => {
    const ok = validate({
      version: 1,
      basemaps: [{ type: "style", url: "https://example.org/style.json" }],
    });
    expect(ok, errors()).toBe(true);
  });

  it("accepts a config that omits basemaps because it extends a base", () => {
    expect(validate({ version: 1, extends: "/configs/_base.map0.json" }), errors()).toBe(true);
    expect(validate({ version: 1 })).toBe(false);
  });

  it("rejects a wms layer without url/layers", () => {
    expect(
      validate({
        version: 1,
        basemaps: [{ type: "empty" }],
        layers: [{ type: "wms", title: "broken" }],
      }),
    ).toBe(false);
  });

  it("flags unknown keys (the runtime validator only warns — the editor squiggle is the point)", () => {
    expect(
      validate({
        version: 1,
        basemaps: [{ type: "empty" }],
        basemapz: [],
      }),
    ).toBe(false);
  });

  /* every demo config on map0.net carries a $schema line — they must all pass,
     and (extends-fragments aside) the runtime validator must agree */
  const configsDir = new URL("../../../site/public/configs/", import.meta.url);
  const demoConfigs = readdirSync(configsDir).filter(
    (f) => f.endsWith(".map0.json") && !f.startsWith("_"), // _base is a fragment, not a config
  );

  it.each(demoConfigs.map((f) => [f]))("accepts the demo config %s", (file) => {
    const config = JSON.parse(readFileSync(new URL(file, configsDir), "utf8"));
    expect(validate(config), errors()).toBe(true);
    if (typeof config.extends !== "string") {
      expect(validateConfig(config).errors).toEqual([]);
    }
  });
});
