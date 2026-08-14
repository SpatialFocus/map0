/** Bounding box of any GeoJSON value — [west, south, east, north] or null. */
export function geojsonBounds(input: unknown): [number, number, number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let found = false;

  const visitCoords = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      const [lng, lat] = value as [number, number];
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        found = true;
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);
      }
      return;
    }
    for (const item of value) visitCoords(item);
  };

  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const obj = node as Record<string, unknown>;
    if (obj.coordinates) visitCoords(obj.coordinates);
    if (Array.isArray(obj.features)) obj.features.forEach(visit);
    if (Array.isArray(obj.geometries)) obj.geometries.forEach(visit);
    if (obj.geometry) visit(obj.geometry);
  };

  visit(input);
  return found ? [west, south, east, north] : null;
}
