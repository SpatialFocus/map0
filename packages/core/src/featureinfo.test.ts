import { describe, expect, it, vi } from "vitest";
import { wireFeatureInfo } from "./featureinfo.js";
import { Emitter } from "./signals.js";
import { makeT } from "./i18n.js";
import type { CoreEvents } from "./events.js";

type Hit = { layer: string; properties: Record<string, unknown> };

/**
 * wireFeatureInfo against a fake map with one adapter: every pointer query
 * reports `hits`, top-most first.
 */
function harness(
  hits: Hit[],
  hover: unknown,
  { locale = "en", clusters = true }: { locale?: string; clusters?: boolean } = {},
) {
  const handlers = new Map<string, (e: unknown) => unknown>();
  const map = {
    on: (ev: string, fn: (e: unknown) => unknown) => handlers.set(ev, fn),
    off: vi.fn(),
    getLayer: () => ({}),
    getCanvas: () => ({ style: {} as Record<string, string> }),
    queryRenderedFeatures: () =>
      hits.map((h) => ({ layer: { id: h.layer }, properties: h.properties })),
  };
  const adapter = {
    def: { id: "stations", hover },
    interactiveLayerIds: ["m0l-stations-circle", "m0l-stations-cluster"],
    featureInfo: vi.fn(async () => null),
    expandCluster: clusters ? vi.fn(async () => {}) : undefined,
  };
  const layers = { queryable: [adapter], adapterForMapLayer: () => adapter };
  const emitter = new Emitter<CoreEvents>();
  const hovers: CoreEvents["featurehover"][] = [];
  const clicks: CoreEvents["featureclick"][] = [];
  emitter.on("featurehover", (p) => hovers.push(p));
  emitter.on("featureclick", (p) => clicks.push(p));
  const highlight = { set: vi.fn() };
  wireFeatureInfo(map as never, layers as never, emitter, highlight as never, makeT(locale));
  const move = () => handlers.get("mousemove")!({ point: { x: 10, y: 20 } });
  const click = () =>
    handlers.get("click")!({
      point: { x: 10, y: 20 },
      lngLat: { lng: -1.5, lat: 53.8 },
    }) as Promise<void>;
  return { move, click, hovers, clicks, adapter, highlight };
}

const CLUSTER: Hit = {
  layer: "m0l-stations-cluster",
  properties: { cluster: true, cluster_id: 7, point_count: 12, point_count_abbreviated: 12 },
};
const STATION: Hit = { layer: "m0l-stations-circle", properties: { name: "Leeds" } };

describe("hover tooltip", () => {
  it("renders the layer's template for a plain feature", () => {
    const h = harness([STATION], { content: "{{name}}" });
    h.move();
    expect(h.hovers).toEqual([{ point: [10, 20], html: "Leeds" }]);
  });

  it("shows the feature count over a cluster bubble instead of a blank template", () => {
    const h = harness([CLUSTER], { content: "{{name}}" });
    h.move();
    expect(h.hovers).toEqual([{ point: [10, 20], html: "12 features" }]);
  });

  it("translates the cluster count", () => {
    const h = harness([CLUSTER], { content: "{{name}}" }, { locale: "de" });
    h.move();
    expect(h.hovers[0]?.html).toBe("12 Objekte");
  });

  it("stays silent for clusters too when the layer has no hover template", () => {
    const h = harness([CLUSTER], undefined);
    h.move();
    expect(h.hovers).toEqual([]);
  });

  it("clears the tooltip once the pointer leaves the feature", () => {
    const hits: Hit[] = [{ layer: "m0l-stations-circle", properties: { name: "York" } }];
    const h = harness(hits, { content: "{{name}}" });
    h.move();
    hits.length = 0;
    h.move();
    h.move(); // no feature under the pointer and nothing shown: no further event
    expect(h.hovers).toEqual([{ point: [10, 20], html: "York" }, null]);
  });
});

describe("click on a cluster bubble", () => {
  it("zooms into the cluster instead of asking for feature info", async () => {
    const h = harness([CLUSTER, STATION], undefined);
    await h.click();
    expect(h.adapter.expandCluster).toHaveBeenCalledTimes(1);
    expect(h.adapter.expandCluster!.mock.calls[0]![0]).toMatchObject({
      properties: { cluster_id: 7 },
    });
    expect(h.adapter.featureInfo).not.toHaveBeenCalled();
  });

  it("reads to the UI like a click that hit nothing, so an open popup closes", async () => {
    const h = harness([CLUSTER], undefined);
    await h.click();
    expect(h.clicks).toEqual([{ lngLat: [-1.5, 53.8], results: [] }]);
    expect(h.highlight.set).toHaveBeenCalledWith([]);
  });

  it("leaves a plain feature on top of a cluster to the ordinary feature info", async () => {
    const h = harness([STATION, CLUSTER], undefined);
    await h.click();
    expect(h.adapter.expandCluster).not.toHaveBeenCalled();
    expect(h.adapter.featureInfo).toHaveBeenCalledTimes(1);
  });

  it("falls through to feature info when the adapter cannot expand clusters", async () => {
    const h = harness([CLUSTER], undefined, { clusters: false });
    await h.click();
    expect(h.adapter.featureInfo).toHaveBeenCalledTimes(1);
  });
});
