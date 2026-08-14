import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { LayerManager } from "./layers.js";
import type { Emitter } from "./signals.js";
import type { FeatureInfoResult } from "./adapters/types.js";
import type { CoreEvents } from "./events.js";

/** Wire the click → feature-info pipeline (vector query + WMS GetFeatureInfo in parallel). */
export function wireFeatureInfo(
  map: MapLibreMap,
  layers: LayerManager,
  emitter: Emitter<CoreEvents>,
): () => void {
  let requestSeq = 0;

  const onClick = async (e: MapMouseEvent) => {
    const adapters = layers.queryable;
    if (adapters.length === 0) return;
    const seq = ++requestSeq;
    const settled = await Promise.allSettled(
      adapters.map((a) => a.featureInfo!({ lngLat: e.lngLat, point: e.point })),
    );
    if (seq !== requestSeq) return; // a newer click superseded this one
    const results: FeatureInfoResult[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) results.push(s.value);
      if (s.status === "rejected") console.warn("[map0] feature info failed", s.reason);
    }
    if (results.length > 0) {
      emitter.emit("featureclick", { lngLat: [e.lngLat.lng, e.lngLat.lat], results });
    }
  };

  const onMove = (e: MapMouseEvent) => {
    const ids: string[] = [];
    for (const a of layers.queryable) {
      for (const id of a.interactiveLayerIds) if (map.getLayer(id)) ids.push(id);
    }
    if (ids.length === 0) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: ids });
    map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : "";
  };

  map.on("click", onClick as never);
  map.on("mousemove", onMove as never);
  return () => {
    map.off("click", onClick as never);
    map.off("mousemove", onMove as never);
  };
}
