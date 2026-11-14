import { vi } from "vitest";

type LayerSpec = { id: string; filter?: unknown };

/**
 * The slice of a MapLibre map the LayerManager and the adapters touch — enough
 * to mount layers in a unit test, with no WebGL and no DOM. Adding a source
 * twice throws, like the real map.
 */
export function fakeMap() {
  const sources = new Map<string, unknown>();
  /* in style order, bottom first */
  let specs: LayerSpec[] = [];
  const find = (id: string) => specs.find((spec) => spec.id === id);
  return {
    /* like MapLibre: the filter lives on the layer, getFilter hands out a copy */
    setFilter: vi.fn((id: string, filter: unknown) => {
      const spec = find(id);
      if (spec) spec.filter = filter ?? undefined;
    }),
    getFilter: (id: string) => structuredClone(find(id)?.filter),
    on: vi.fn(),
    off: vi.fn(),
    getZoom: () => 5,
    addSource: (id: string, source: unknown) => {
      if (sources.has(id)) throw new Error("duplicate source");
      sources.set(id, source);
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    /* like MapLibre: on top, or below the layer named `before` */
    addLayer: (spec: LayerSpec, before?: string) => {
      const at = before === undefined ? -1 : specs.findIndex((other) => other.id === before);
      if (at < 0) specs.push(spec);
      else specs.splice(at, 0, spec);
    },
    getLayer: (id: string) => {
      const spec = find(id);
      return spec && { ...spec, serialize: () => structuredClone(spec) };
    },
    getLayersOrder: () => specs.map((spec) => spec.id),
    removeLayer: (id: string) => {
      specs = specs.filter((spec) => spec.id !== id);
    },
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
  };
}
