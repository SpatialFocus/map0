import { expect, it, vi } from "vitest";
import { normalizeSingleLayer } from "@map0/schema";
import type { MapGeoJSONFeature } from "maplibre-gl";
import { GeoJsonAdapter, type NormalizedGeoJson } from "./geojson.js";

async function mounted(cluster: boolean, fullStyle = false) {
  const specs = new Map<string, object>();
  const expansion = vi.fn(async () => 10);
  const map = {
    addSource: vi.fn(),
    addLayer: (spec: { id: string }) => specs.set(spec.id, spec),
    getLayer: (id: string) => specs.get(id),
    getSource: () => ({ getClusterExpansionZoom: expansion }),
    setLayoutProperty: vi.fn(),
    on: vi.fn(),
    queryRenderedFeatures: vi.fn(() => [] as MapGeoJSONFeature[]),
    easeTo: vi.fn(),
  };
  const adapter = new GeoJsonAdapter(normalizeSingleLayer({
    type: "geojson", id: "counts", cluster,
    data: { type: "FeatureCollection", features: [] },
    ...(fullStyle ? { style: [{ type: "circle" }] } : {}),
  }, []) as NormalizedGeoJson);
  await adapter.mount({ map: map as never, accent: "#123456" });
  const hit = (properties: Record<string, unknown>, layer = "m0l-counts-circle") => ({
    source: "m0s-counts", layer: { id: layer },
    geometry: { type: "Point", coordinates: [16, 48] }, properties,
  }) as MapGeoJSONFeature;
  return { adapter, map, expansion, hit };
}

it.each([false, true])("keeps ordinary count attributes in feature info with clustering %s", async cluster => {
  const { adapter, map, hit } = await mounted(cluster);
  const plain = hit({ name: "Survey", point_count: 5 });
  map.queryRenderedFeatures.mockReturnValue([plain]);
  expect(adapter.isCluster(plain)).toBe(false);
  const info = await adapter.featureInfo({ point: { x: 0, y: 0 }, lngLat: { lng: 0, lat: 0 } } as never);
  expect(info?.features).toEqual([{ name: "Survey", point_count: 5 }]);
  await adapter.expandCluster(plain);
  expect(map.easeTo).not.toHaveBeenCalled();
});

it.each([false, true])("recognises generated clusters with full style %s", async fullStyle => {
  const { adapter, map, expansion, hit } = await mounted(true, fullStyle);
  const cluster = hit({ cluster: true, cluster_id: 7, point_count: 12 },
    fullStyle ? "m0l-counts-0" : "m0l-counts-cluster");
  expect(adapter.isCluster(cluster)).toBe(true);
  map.queryRenderedFeatures.mockReturnValue([cluster]);
  expect(await adapter.featureInfo({ point: { x: 0, y: 0 } } as never)).toBeNull();
  await adapter.expandCluster(cluster);
  expect(expansion).toHaveBeenCalledWith(7);
  expect(map.easeTo).toHaveBeenCalledWith({ center: [16, 48], zoom: 10 });
  expect(adapter.isCluster({ ...cluster, source: "another-source" })).toBe(false);
  expect(adapter.isCluster({ ...cluster, layer: { id: "another-layer" } } as never)).toBe(false);
});

it("does not interpret cluster-like properties when clustering is disabled", async () => {
  const { adapter, hit } = await mounted(false);
  expect(adapter.isCluster(hit({ cluster: true, cluster_id: 7, point_count: 12 }))).toBe(false);
});
