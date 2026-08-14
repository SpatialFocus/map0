/** WGS84 ↔ EPSG:3857 helpers (only what WMS request building needs). */

const R = 6378137;
const MAX_LAT = 85.051129;

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const x = (lng * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
  return [x, y];
}
