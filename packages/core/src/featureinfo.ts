import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { LayerManager } from "./layers.js";
import type { Emitter } from "./signals.js";
import type { FeatureInfoResult } from "./adapters/types.js";
import type { CoreEvents } from "./events.js";
import type { HighlightManager } from "./highlight.js";
import type { Translate } from "./i18n.js";
import { escapeHtml, renderTemplate } from "./template.js";

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
  t: Translate,
  isLocked: () => boolean = () => false,
): () => void {
  let requestSeq = 0;

  /** MapLibre layer ids of every visible, queryable adapter — the hit-test set */
  const interactiveIds = (): string[] => {
    const ids: string[] = [];
    for (const a of layers.queryable) {
      for (const id of a.interactiveLayerIds) if (map.getLayer(id)) ids.push(id);
    }
    return ids;
  };

  const onClick = async (e: MapMouseEvent) => {
    if (isLocked()) return;
    const adapters = layers.queryable;
    if (adapters.length === 0) return;
    const seq = ++requestSeq;

    /* a cluster bubble on top has no popup to offer — it zooms in until it breaks
       apart. To the UI it is still a click that hit nothing: whatever the previous
       click opened goes away */
    const ids = interactiveIds();
    const top = ids.length > 0 ? map.queryRenderedFeatures(e.point, { layers: ids })[0] : undefined;
    const clusterOwner =
      top && "point_count" in (top.properties ?? {})
        ? layers.adapterForMapLayer(top.layer.id)
        : undefined;
    if (top && clusterOwner?.expandCluster) {
      highlight.set([]);
      emitter.emit("featureclick", { lngLat: [e.lngLat.lng, e.lngLat.lat], results: [] });
      await clusterOwner.expandCluster(top);
      return;
    }

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
    /* emitted on a miss as well (empty `results`): the UI has to know that a
       tap landed on nothing so it can put away what the previous tap opened —
       an anchored popup closes itself on any map click, a bottom sheet cannot */
    emitter.emit("featureclick", { lngLat: [e.lngLat.lng, e.lngLat.lat], results });
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
    const ids = interactiveIds();
    if (ids.length === 0) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: ids });
    map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : "";

    /* hover tooltip (F5.4): first hit whose layer configures one */
    let payload: { point: [number, number]; html: string } | null = null;
    for (const hit of hits) {
      const adapter = layers.adapterForMapLayer(hit.layer.id);
      const hover = (adapter?.def as { hover?: { content: string } | false } | undefined)?.hover;
      if (!hover || !hover.content) continue;
      const props = (hit.properties ?? {}) as Record<string, unknown>;
      /* a cluster bubble carries MapLibre's aggregate properties, not the author's —
         their template would render blank, so say how many features it stands for */
      const html =
        "point_count" in props
          ? `${escapeHtml(props.point_count)} ${escapeHtml(t("popup.cluster"))}`
          : renderTemplate(hover.content, props);
      payload = { point: [e.point.x, e.point.y], html };
      break;
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
