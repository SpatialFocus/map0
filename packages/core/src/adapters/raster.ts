import type { NormalizedLayer, RasterLayerDef } from "@map0/schema";
import { SourceAdapter } from "./types.js";

type NormalizedRaster = RasterLayerDef & NormalizedLayer & { type: "raster" };

export class RasterAdapter extends SourceAdapter<NormalizedRaster> {
  private srcId = `m0s-${this.def.id}`;
  private lyrId = `m0l-${this.def.id}`;

  get sourceIds(): string[] {
    return [this.srcId];
  }
  get layerIds(): string[] {
    return [this.lyrId];
  }

  protected addToMap(): void {
    const { map } = this.ctx;
    map.addSource(this.srcId, {
      type: "raster",
      tiles: [this.def.url],
      tileSize: this.def.tileSize ?? 256,
      ...(this.def.attribution ? { attribution: this.def.attribution } : {}),
    });
    map.addLayer({
      id: this.lyrId,
      type: "raster",
      source: this.srcId,
      ...(this.def.minZoom !== undefined ? { minzoom: this.def.minZoom } : {}),
      ...(this.def.maxZoom !== undefined ? { maxzoom: this.def.maxZoom } : {}),
      paint: { "raster-opacity": 1 },
    });
    this.opacityEntries = [[this.lyrId, "raster-opacity", 1]];
  }
}
