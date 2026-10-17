import { describe, expect, it, vi } from "vitest";
import { normalizeConfig, type LayerDef } from "@map0/schema";
import { LayerManager } from "./layers.js";

function fakeMap() {
  const sources = new Map();
  const specs = new Map();
  return {
    on: vi.fn(), off: vi.fn(), getZoom: () => 5,
    addSource: (id: string, source: unknown) => sources.set(id, source),
    getSource: (id: string) => sources.get(id), removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: { id: string }) => specs.set(spec.id, spec),
    getLayer: (id: string) => specs.get(id), removeLayer: (id: string) => specs.delete(id),
    setLayoutProperty: vi.fn(), setPaintProperty: vi.fn(),
  };
}

const layer = (id: string): LayerDef => ({ id, type: "geojson", data: { type: "FeatureCollection", features: [] } });

describe("exclusive groups in the core (F2.3)", () => {
  async function mounted() {
    const map = fakeMap();
    const manager = new LayerManager(map as never, normalizeConfig({
      version: 1,
      basemaps: [{ type: "empty" }],
      layers: [
        { type: "group", title: "Imagery", exclusive: true, children: [
          layer("ortho"),
          layer("hillshade"),
          { type: "group", title: "Historic", children: [layer("y1950"), layer("y1970")] },
        ] },
        layer("roads"),
      ],
    }));
    await manager.mountAll({ map: map as never, accent: "#123456" });
    const visible = () => Object.fromEntries(manager.state.value.map((s) => [s.id, s.visible]));
    return { manager, visible };
  }

  it("switches the other options off when one is switched on — for API callers too", async () => {
    const { manager, visible } = await mounted();
    manager.setVisibility("hillshade", true);
    expect(visible()).toEqual({ ortho: false, hillshade: true, y1950: false, y1970: false, roads: true });
    manager.setVisibility("y1970", true);
    expect(visible()).toEqual({ ortho: false, hillshade: false, y1950: false, y1970: true, roads: true });
    /* inside the chosen option the plain group behaves as usual */
    manager.setVisibility("y1950", true);
    expect(visible()).toMatchObject({ y1950: true, y1970: true });
    manager.destroy();
  });

  it("lets every option go dark — switching off touches nothing else", async () => {
    const { manager, visible } = await mounted();
    manager.setVisibility("ortho", false);
    expect(visible()).toEqual({ ortho: false, hillshade: false, y1950: false, y1970: false, roads: true });
    manager.destroy();
  });
});
