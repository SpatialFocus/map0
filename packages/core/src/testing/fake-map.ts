import { vi } from "vitest";

/**
 * The slice of a MapLibre map the LayerManager and the adapters touch — enough
 * to mount layers in a unit test, with no WebGL and no DOM. Adding a source
 * twice throws, like the real map.
 */
export function fakeMap() {
  const sources = new Map<string, unknown>();
  const specs = new Map<string, { id: string }>();
  return {
    on: vi.fn(),
    off: vi.fn(),
    getZoom: () => 5,
    addSource: (id: string, source: unknown) => {
      if (sources.has(id)) throw new Error("duplicate source");
      sources.set(id, source);
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: { id: string }) => specs.set(spec.id, spec),
    getLayer: (id: string) => specs.get(id),
    removeLayer: (id: string) => specs.delete(id),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
  };
}
