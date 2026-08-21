import type { FeatureInfoResult } from "./adapters/types.js";

export interface CoreEvents {
  ready: Record<string, never>;
  featureclick: { lngLat: [number, number]; results: FeatureInfoResult[] };
  /** hover tooltip payload (html is a rendered template — UI must sanitize); null = hide */
  featurehover: { point: [number, number]; html: string } | null;
  /** right-click / long-press coordinate readout (F5.6) */
  coordinates: {
    lngLat: [number, number];
    entries: Array<{ code: string; label: string; text: string }>;
  };
  /** anything that went wrong on the map; `sourceId` is set for MapLibre source/tile errors */
  error: { message: string; layerId?: string; sourceId?: string; control?: "geolocate" };
}
