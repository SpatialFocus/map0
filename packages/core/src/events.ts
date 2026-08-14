import type { FeatureInfoResult } from "./adapters/types.js";

export interface CoreEvents {
  ready: Record<string, never>;
  featureclick: { lngLat: [number, number]; results: FeatureInfoResult[] };
  error: { message: string; layerId?: string };
}
