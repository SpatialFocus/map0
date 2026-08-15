/**
 * Geodesic length and area on the sphere.
 *
 * Measuring in Web Mercator pixels would be wrong by the secant of the latitude
 * — about 50 % too long in Austria, and worse further north. These are the
 * spherical formulas instead: haversine for distance, the spherical excess of
 * the polygon for area. Accurate to roughly 0.5 % against WGS84 ellipsoidal
 * values, which is far below what anyone should measure by clicking on a map.
 */

const R = 6371008.8; // IUGG mean Earth radius, metres
const RAD = Math.PI / 180;

export type Position = [number, number]; // [lng, lat]

/** Great-circle distance between two positions, in metres. */
export function haversine(a: Position, b: Position): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a line, in metres. */
export function lineLength(points: Position[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Area of a closed ring, in square metres. Uses the spherical excess formula
 * (Chamberlain & Duquette); the ring is closed implicitly and winding order
 * does not matter because the result is taken as an absolute value.
 */
export function ringArea(points: Position[]): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % points.length]!;
    total += (p2[0] - p1[0]) * RAD * (2 + Math.sin(p1[1] * RAD) + Math.sin(p2[1] * RAD));
  }
  return Math.abs((total * R * R) / 2);
}

/* -------------------------------- formatting ------------------------------- */

const nf = (locale: string, digits: number): Intl.NumberFormat =>
  new Intl.NumberFormat(locale === "de" ? "de-AT" : "en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Metres → "845 m" / "12.4 km", picking the unit by magnitude. */
export function formatLength(metres: number, locale = "en"): string {
  if (metres < 1000) return `${nf(locale, metres < 10 ? 1 : 0).format(metres)} m`;
  return `${nf(locale, metres < 10_000 ? 2 : 1).format(metres / 1000)} km`;
}

/** Square metres → "640 m²" / "3.2 ha" / "18.5 km²". */
export function formatArea(squareMetres: number, locale = "en"): string {
  if (squareMetres < 10_000) return `${nf(locale, 0).format(squareMetres)} m²`;
  if (squareMetres < 1_000_000) return `${nf(locale, 2).format(squareMetres / 10_000)} ha`;
  return `${nf(locale, 2).format(squareMetres / 1_000_000)} km²`;
}

/** Midpoint of a segment, good enough for placing a label. */
export function midpoint(a: Position, b: Position): Position {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Centroid of a ring, for placing the area label. */
export function centroid(points: Position[]): Position {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}
