import type { FeatureInfoResult } from "./adapters/types.js";

export interface CoreEvents {
  ready: Record<string, never>;
  featureclick: { lngLat: [number, number]; results: FeatureInfoResult[] };
  /** hover tooltip payload (html is a rendered template — UI must sanitize); null = hide */
  featurehover: { point: [number, number]; html: string } | null;
  error: { message: string; layerId?: string };
}
