/**
 * Measuring distance and area (F9.1).
 *
 * Deliberately measure-only: click to add a vertex, drag one to adjust,
 * double-click to finish. No drawing modes, no annotation model — if map0 ever
 * grows real annotations, Terra Draw is the right dependency for that, and this
 * module can stay as it is.
 *
 * Everything it draws is ordinary style layers, so the look follows the theme.
 * Labels are DOM markers rather than symbol layers on purpose: text layers need
 * a glyph source, which a raster basemap does not have.
 */
import { Marker, type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import type { OverlayIds } from "./basemaps.js";
import {
  centroid,
  formatArea,
  formatLength,
  lineLength,
  midpoint,
  ringArea,
  type Position,
} from "./geodesy.js";
import { Signal } from "./signals.js";

export type MeasureMode = "distance" | "area";

export interface MeasureState {
  mode: MeasureMode;
  points: Position[];
  /** metres, or square metres in area mode */
  value: number;
  /** the value, formatted for the active locale */
  text: string;
  /** area mode also reports the perimeter */
  perimeter?: string;
  finished: boolean;
}

const SRC = "m0s-measure";
const L_FILL = "m0l-measure-fill";
const L_CASING = "m0l-measure-casing";
const L_LINE = "m0l-measure-line";
const L_VERTEX = "m0l-measure-vertex";

export class MeasureController {
  readonly state = new Signal<MeasureState | null>(null);

  private points: Position[] = [];
  private cursor: Position | null = null;
  private mode: MeasureMode = "distance";
  private finished = false;
  private active = false;
  private dragIndex: number | null = null;
  private labels: Marker[] = [];
  private listeners: Array<() => void> = [];

  constructor(
    private readonly map: MapLibreMap,
    private readonly accent: string,
    private readonly locale: string,
  ) {}

  get ids(): OverlayIds {
    return {
      sources: new Set([SRC]),
      layers: new Set([L_FILL, L_CASING, L_LINE, L_VERTEX]),
    };
  }

  /* -------------------------------- lifecycle ------------------------------- */

  start(mode: MeasureMode): void {
    this.stop();
    this.mode = mode;
    this.points = [];
    this.cursor = null;
    this.finished = false;
    this.active = true;
    this.ensureLayers();
    this.map.getCanvas().style.cursor = "crosshair";
    this.map.doubleClickZoom.disable();

    const on = <T>(type: string, handler: (e: T) => void): void => {
      this.map.on(type as never, handler as never);
      this.listeners.push(() => this.map.off(type as never, handler as never));
    };

    on<MapMouseEvent>("click", (e) => this.onClick(e));
    on<MapMouseEvent>("mousemove", (e) => this.onMove(e));
    on<MapMouseEvent>("dblclick", (e) => {
      e.preventDefault();
      this.finish();
    });
    on<MapMouseEvent>("mousedown", (e) => this.onVertexDown(e));

    const onKey = (event: KeyboardEvent): void => {
      if (!this.active) return;
      /* the listener is on window, so it also hears the search box and dialogs —
         composedPath sees through the shadow root that retargets event.target */
      const target = event.composedPath()[0];
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") this.stop();
      else if (event.key === "Enter") this.finish();
      else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        this.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    this.listeners.push(() => window.removeEventListener("keydown", onKey));

    this.publish();
  }

  /** finish the current measurement but keep it on the map */
  finish(): void {
    if (!this.active || this.points.length < (this.mode === "area" ? 3 : 2)) return;
    this.finished = true;
    this.cursor = null;
    this.map.getCanvas().style.cursor = "";
    this.render();
    this.publish();
  }

  /** remove the measurement and leave measure mode */
  stop(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
    this.active = false;
    this.finished = false;
    this.points = [];
    this.cursor = null;
    this.clearLabels();
    if (this.map.getSource(SRC)) this.setData([]);
    this.map.getCanvas().style.cursor = "";
    this.map.doubleClickZoom.enable();
    this.state.value = null;
  }

  undo(): void {
    if (this.points.length === 0) return;
    this.points.pop();
    this.finished = false;
    this.render();
    this.publish();
  }

  destroy(): void {
    this.stop();
  }

  /* ------------------------------- interaction ------------------------------ */

  private onClick(e: MapMouseEvent): void {
    if (this.finished || this.dragIndex !== null) return;
    const point: Position = [e.lngLat.lng, e.lngLat.lat];
    const last = this.points[this.points.length - 1];
    /* the second click of a double-click lands on the same spot — ignore it */
    if (last && Math.abs(last[0] - point[0]) < 1e-9 && Math.abs(last[1] - point[1]) < 1e-9) return;
    this.points.push(point);
    this.render();
    this.publish();
  }

  private onMove(e: MapMouseEvent): void {
    if (this.dragIndex !== null) {
      this.points[this.dragIndex] = [e.lngLat.lng, e.lngLat.lat];
      this.render();
      this.publish();
      return;
    }
    if (this.finished || this.points.length === 0) return;
    this.cursor = [e.lngLat.lng, e.lngLat.lat];
    this.render();
    this.publish();
  }

  /** grab a vertex: suppress map panning until the pointer is released */
  private onVertexDown(e: MapMouseEvent): void {
    const hits = this.map.queryRenderedFeatures(e.point, { layers: [L_VERTEX] });
    const index = hits[0]?.properties?.index;
    if (typeof index !== "number") return;
    e.preventDefault();
    this.dragIndex = index;
    this.map.dragPan.disable();
    this.map.getCanvas().style.cursor = "grabbing";
    const onUp = (): void => {
      this.dragIndex = null;
      this.map.dragPan.enable();
      this.map.getCanvas().style.cursor = this.finished ? "" : "crosshair";
      this.map.off("mouseup", onUp);
    };
    this.map.on("mouseup", onUp);
  }

  /**
   * The cursor only counts once it has left the vertex just placed — otherwise
   * every click would add a zero-length segment with a "0 m" label.
   */
  private get liveCursor(): Position | null {
    if (!this.cursor || this.finished) return null;
    const last = this.points[this.points.length - 1];
    if (last && Math.abs(last[0] - this.cursor[0]) < 1e-7 && Math.abs(last[1] - this.cursor[1]) < 1e-7) {
      return null;
    }
    return this.cursor;
  }

  /* -------------------------------- rendering ------------------------------- */

  private ensureLayers(): void {
    if (this.map.getSource(SRC)) return;
    this.map.addSource(SRC, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] } as never,
    });
    this.map.addLayer({
      id: L_FILL,
      type: "fill",
      source: SRC,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": this.accent, "fill-opacity": 0.18 },
    } as never);
    /* a white casing under the coloured line keeps it readable on any basemap */
    this.map.addLayer({
      id: L_CASING,
      type: "line",
      source: SRC,
      filter: ["!=", ["geometry-type"], "Point"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 },
    } as never);
    this.map.addLayer({
      id: L_LINE,
      type: "line",
      source: SRC,
      filter: ["!=", ["geometry-type"], "Point"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": this.accent,
        "line-width": 2.5,
        /* the segment to the cursor is dashed until it is committed */
        "line-dasharray": ["case", ["get", "preview"], ["literal", [1.5, 1.5]], ["literal", [1, 0]]],
      },
    } as never);
    this.map.addLayer({
      id: L_VERTEX,
      type: "circle",
      source: SRC,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5.5,
        "circle-color": "#ffffff",
        "circle-stroke-color": this.accent,
        "circle-stroke-width": 2.5,
      },
    } as never);
  }

  private setData(features: unknown[]): void {
    (this.map.getSource(SRC) as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features,
    } as never);
  }

  private render(): void {
    const committed = this.points;
    const cursor = this.liveCursor;
    const withCursor = cursor ? [...committed, cursor] : [...committed];
    const features: unknown[] = [];

    if (this.mode === "area" && withCursor.length >= 3) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...withCursor, withCursor[0]!]] },
      });
    }
    if (withCursor.length >= 2) {
      const ring = this.mode === "area" && this.finished ? [...withCursor, withCursor[0]!] : withCursor;
      /* split off the uncommitted segment so it can be dashed */
      const solid = cursor ? committed : ring;
      if (solid.length >= 2) {
        features.push({
          type: "Feature",
          properties: { preview: false },
          geometry: { type: "LineString", coordinates: solid },
        });
      }
      if (cursor && committed.length >= 1) {
        const preview = [committed[committed.length - 1]!, cursor];
        if (this.mode === "area" && committed.length >= 2) preview.push(committed[0]!);
        features.push({
          type: "Feature",
          properties: { preview: true },
          geometry: { type: "LineString", coordinates: preview },
        });
      }
    }
    committed.forEach((p, index) => {
      features.push({ type: "Feature", properties: { index }, geometry: { type: "Point", coordinates: p } });
    });

    this.setData(features);
    this.renderLabels(withCursor);
  }

  private clearLabels(): void {
    for (const marker of this.labels) marker.remove();
    this.labels = [];
  }

  private renderLabels(points: Position[]): void {
    this.clearLabels();
    if (points.length < 2) return;

    const addLabel = (at: Position, text: string, kind: "segment" | "total"): void => {
      const el = document.createElement("div");
      el.className = `m0-measure-label${kind === "total" ? " m0-measure-total" : ""}`;
      el.textContent = text;
      this.labels.push(new Marker({ element: el }).setLngLat(at).addTo(this.map));
    };

    if (this.mode === "distance") {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        addLabel(midpoint(a, b), formatLength(lineLength([a, b]), this.locale), "segment");
      }
      addLabel(points[points.length - 1]!, formatLength(lineLength(points), this.locale), "total");
    } else if (points.length >= 3) {
      addLabel(centroid(points), formatArea(ringArea(points), this.locale), "total");
    }
  }

  private publish(): void {
    const cursor = this.liveCursor;
    const points = cursor ? [...this.points, cursor] : this.points;
    if (this.mode === "distance") {
      const value = lineLength(points);
      this.state.value = {
        mode: this.mode,
        points: this.points,
        value,
        text: formatLength(value, this.locale),
        finished: this.finished,
      };
    } else {
      const value = points.length >= 3 ? ringArea(points) : 0;
      this.state.value = {
        mode: this.mode,
        points: this.points,
        value,
        text: formatArea(value, this.locale),
        perimeter:
          points.length >= 3
            ? formatLength(lineLength([...points, points[0]!]), this.locale)
            : undefined,
        finished: this.finished,
      };
    }
  }
}
