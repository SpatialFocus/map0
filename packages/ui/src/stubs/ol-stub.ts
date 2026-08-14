/**
 * Build-time stub for ogc-client's OPTIONAL OpenLayers/proj4 peer dependencies.
 * Only `WmtsEndpoint.getOpenLayersTileGrid()` needs them — map0 never calls it
 * (MapLibre has no OL tile grids). Aliased in vite.config.ts so the library
 * bundle builds without pulling in OpenLayers.
 */
export function createFromCapabilitiesMatrixSet(): never {
  throw new Error("map0: OpenLayers tile-grid support is not bundled");
}
export function get(): null {
  return null;
}
export function register(): void {
  /* no-op */
}
export function fromEPSGCode(): never {
  throw new Error("map0: OpenLayers tile-grid support is not bundled");
}
export default {};
