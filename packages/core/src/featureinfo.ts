import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { LayerManager } from "./layers.js";
import type { Emitter } from "./signals.js";
import type { FeatureInfoResult } from "./adapters/types.js";
import type { CoreEvents } from "./events.js";
import type { HighlightManager } from "./highlight.js";
import { renderTemplate } from "./template.js";

/**
 * Wire click → feature info (+ selection highlight) and hover → tooltip.
 * `isLocked` lets a modal map interaction (measuring) take over the pointer:
 * clicking to set a vertex must not also open a popup underneath it.
 */
export function wireFeatureInfo(
  map: MapLibreMap,
  layers: LayerManager,
  emitter: Emitter<CoreEvents>,
  highlight: HighlightManager,
  isLocked: () => boolean = () => false,
): () => void {
  let requestSeq = 0;

  const onClick = async (e: MapMouseEvent) => {
    if (isLocked()) return;
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
    highlight.set(results.flatMap((r) => r.highlightFeatures ?? []));
    if (results.length > 0) {
      emitter.emit("featureclick", { lngLat: [e.lngLat.lng, e.lngLat.lat], results });
    }
  };

  let hoverActive = false;
  const onMove = (e: MapMouseEvent) => {
    if (isLocked()) {
      if (hoverActive) {
        emitter.emit("featurehover", null);
        hoverActive = false;
      }
      return;
    }
    const ids: string[] = [];
    for (const a of layers.queryable) {
      for (const id of a.interactiveLayerIds) if (map.getLayer(id)) ids.push(id);
    }
    if (ids.length === 0) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: ids });
    map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : "";

    /* hover tooltip (F5.4): first hit whose layer configures one */
    let payload: { point: [number, number]; html: string } | null = null;
    for (const hit of hits) {
      const adapter = layers.adapterForMapLayer(hit.layer.id);
      const hover = (adapter?.def as { hover?: { content: string } | false } | undefined)?.hover;
      if (hover && hover.content) {
        payload = {
          point: [e.point.x, e.point.y],
          html: renderTemplate(hover.content, (hit.properties ?? {}) as Record<string, unknown>),
        };
        break;
      }
    }
    if (payload || hoverActive) {
      emitter.emit("featurehover", payload);
      hoverActive = payload !== null;
    }
  };

  const onLeave = () => {
    if (hoverActive) {
      emitter.emit("featurehover", null);
      hoverActive = false;
    }
  };

  map.on("click", onClick as never);
  map.on("mousemove", onMove as never);
  map.on("mouseout", onLeave as never);
  return () => {
    map.off("click", onClick as never);
    map.off("mousemove", onMove as never);
    map.off("mouseout", onLeave as never);
  };
}
