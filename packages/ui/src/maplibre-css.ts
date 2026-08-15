/**
 * MapLibre's stylesheet as a string, in its own module so it is loaded together
 * with the engine rather than sitting in the entry chunk (~12 KB gzip).
 */
import css from "maplibre-gl/dist/maplibre-gl.css?inline";

export default css;
