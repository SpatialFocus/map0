import type { NormalizedLayer } from "@map0/schema";
import type { SourceAdapter } from "./types.js";
import { CogAdapter } from "./cog.js";
import { GeoJsonAdapter } from "./geojson.js";
import { GeoParquetAdapter } from "./geoparquet.js";
import { RasterAdapter } from "./raster.js";
import { VectorAdapter } from "./vector.js";
import { WfsAdapter } from "./wfs.js";
import { WmsAdapter } from "./wms.js";
import { WmtsAdapter } from "./wmts.js";

type AdapterFactory = (def: NormalizedLayer) => SourceAdapter;

/** Public extension point: register additional layer types (docs/06-architecture.md). */
const factories = new Map<string, AdapterFactory>([
  ["wms", (def) => new WmsAdapter(def as never)],
  ["wmts", (def) => new WmtsAdapter(def as never)],
  ["wfs", (def) => new WfsAdapter(def as never)],
  ["raster", (def) => new RasterAdapter(def as never)],
  ["cog", (def) => new CogAdapter(def as never)],
  ["geojson", (def) => new GeoJsonAdapter(def as never)],
  ["geoparquet", (def) => new GeoParquetAdapter(def as never)],
  ["vector", (def) => new VectorAdapter(def as never)],
]);

export function registerAdapter(type: string, factory: AdapterFactory): void {
  factories.set(type, factory);
}

export function createAdapter(def: NormalizedLayer): SourceAdapter | null {
  const factory = factories.get(def.type);
  return factory ? factory(def) : null;
}
