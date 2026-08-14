import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Feature } from "geojson";
import type { OverlayIds } from "./basemaps.js";

const EMPTY = { type: "FeatureCollection", features: [] } as const;

/** Selection highlight for clicked vector features (F5.7). */
export class HighlightManager {
  readonly sourceId = "m0s-highlight";
  readonly layerIds = ["m0l-highlight-fill", "m0l-highlight-line", "m0l-highlight-circle"];

  constructor(
    private readonly map: MapLibreMap,
    private readonly accent: string,
  ) {}

  get ids(): OverlayIds {
    return { sources: new Set([this.sourceId]), layers: new Set(this.layerIds) };
  }

  private ensure(): void {
    if (this.map.getSource(this.sourceId)) return;
    this.map.addSource(this.sourceId, { type: "geojson", data: EMPTY as never });
    this.map.addLayer({
      id: "m0l-highlight-fill",
      type: "fill",
      source: this.sourceId,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": this.accent, "fill-opacity": 0.22 },
    } as never);
    this.map.addLayer({
      id: "m0l-highlight-line",
      type: "line",
      source: this.sourceId,
      paint: { "line-color": this.accent, "line-width": 2.5 },
    } as never);
    this.map.addLayer({
      id: "m0l-highlight-circle",
      type: "circle",
      source: this.sourceId,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 10,
        "circle-color": this.accent,
        "circle-opacity": 0.25,
        "circle-stroke-color": this.accent,
        "circle-stroke-width": 2.5,
      },
    } as never);
  }

  set(features: Feature[]): void {
    this.ensure();
    (this.map.getSource(this.sourceId) as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features,
    } as never);
  }

  clear(): void {
    if (this.map.getSource(this.sourceId)) this.set([]);
  }
}
