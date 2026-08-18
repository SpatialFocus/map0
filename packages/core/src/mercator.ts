/** WGS84 ↔ EPSG:3857 helpers (only what WMS/WMTS request building needs). */

const R = 6378137;
const MAX_LAT = 85.051129;

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const x = (lng * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
  return [x, y];
}

/** clamped to ±180 / ±85.051129 so float noise at the world edge stays valid */
export function mercatorToLngLat(x: number, y: number): [number, number] {
  const lng = (x / R / Math.PI) * 180;
  const lat = ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / Math.PI) * 180;
  return [Math.max(-180, Math.min(180, lng)), Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))];
}
