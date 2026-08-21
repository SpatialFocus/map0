/**
 * Optional peer dependencies that map0 never uses, stubbed for both builds:
 * the library bundle (packages/ui) and the demo site (site/).
 *
 * ogc-client can hand its WMTS capabilities to OpenLayers, and jsPDF can render
 * HTML/SVG — neither path exists in map0. Without these aliases a production
 * build fails on `ol/proj/proj4`, which pnpm leaves unresolved because it is an
 * unmet optional peer. Keep this list in one place: two build configs drifting
 * apart shows up as a green dev server and a red release build.
 */
import { fileURLToPath } from "node:url";

const stub = (p) => fileURLToPath(new URL(`../packages/ui/src/stubs/${p}`, import.meta.url));

export const optionalPeerStubs = {
  "ol/tilegrid/WMTS": stub("ol-stub.ts"),
  "ol/proj/proj4": stub("ol-stub.ts"),
  "ol/proj": stub("ol-stub.ts"),
  /* NOT dompurify: jsPDF and our popup renderer share that one for real. */
  html2canvas: stub("pdf-stub.ts"),
  canvg: stub("pdf-stub.ts"),
};
