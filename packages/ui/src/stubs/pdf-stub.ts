/**
 * Build-time stub for jsPDF's OPTIONAL rendering dependencies (html2canvas, canvg).
 * They back `doc.html()` and SVG rasterisation; map0 only ever calls `addImage`
 * with a canvas it composed itself, so shipping them would add ~110 KB gzip of
 * code that is never fetched. Aliased in vite.config.ts.
 */
function unavailable(): never {
  throw new Error("map0: jsPDF's HTML/SVG rendering is not bundled — export composes a canvas");
}

export default unavailable;
export const html2canvas = unavailable;
export const Canvg = { fromString: unavailable, from: unavailable };
export const presets = {};
