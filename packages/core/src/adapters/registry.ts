import type { NormalizedLayer } from "@map0/schema";
import type { SourceAdapter } from "./types.js";
import { GeoJsonAdapter } from "./geojson.js";
import { RasterAdapter } from "./raster.js";
import { VectorAdapter } from "./vector.js";
import { WmsAdapter } from "./wms.js";

type AdapterFactory = (def: NormalizedLayer) => SourceAdapter;

/** Public extension point: register additional layer types (docs/06-architecture.md). */
const factories = new Map<string, AdapterFactory>([
  ["wms", (def) => new WmsAdapter(def as never)],
  ["raster", (def) => new RasterAdapter(def as never)],
  ["geojson", (def) => new GeoJsonAdapter(def as never)],
  ["vector", (def) => new VectorAdapter(def as never)],
]);

export function registerAdapter(type: string, factory: AdapterFactory): void {
  factories.set(type, factory);
}

export function createAdapter(def: NormalizedLayer): SourceAdapter | null {
  const factory = factories.get(def.type);
  return factory ? factory(def) : null;
}
