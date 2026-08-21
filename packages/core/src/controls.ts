import {
  AttributionControl,
  FullscreenControl,
  GeolocateControl,
  GlobeControl,
  NavigationControl,
  ScaleControl,
} from "maplibre-gl";
import type { IControl, Map as MapLibreMap } from "maplibre-gl";
import type { NormalizedConfig } from "@map0/schema";
import type { Translate } from "./i18n.js";

class HomeControl implements IControl {
  private container?: HTMLElement;

  constructor(
    private readonly goHome: () => void,
    private readonly label: string,
  ) {}

  onAdd(): HTMLElement {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = this.label;
    btn.setAttribute("aria-label", this.label);
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/></svg>';
    btn.addEventListener("click", this.goHome);
    div.appendChild(btn);
    this.container = div;
    return div;
  }

  onRemove(): void {
    this.container?.remove();
  }
}

export interface InitialView {
  center?: [number, number];
  zoom?: number;
  bounds?: [number, number, number, number];
}

/**
 * The same probe MapLibre runs internally (it is not exported): no geolocation
 * on the navigator, or a permission already denied — an insecure origin, a
 * user's earlier "never" — means the button could not possibly do anything.
 * MapLibre then renders it greyed-out with a slash, which on a phone (no
 * tooltip) just reads as broken; we leave the button out entirely instead.
 *
 * Awaited BEFORE the map is created (see buildCore): an await between map
 * creation and the style.load hook would miss the event entirely on a basemap
 * that loads instantly (type "empty").
 */
export async function geolocationAvailable(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return false;
  if (!navigator.permissions?.query) return true;
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state !== "denied";
  } catch {
    return true; // iOS ≤16 rejects the query yet supports geolocation
  }
}

export function applyControls(
  map: MapLibreMap,
  cfg: NormalizedConfig,
  t: Translate,
  fullscreenContainer: HTMLElement | undefined,
  initialView: InitialView,
  geolocateAvailable: boolean,
  onGeolocateError?: (message: string) => void,
): void {
  const c = cfg.controls;

  if (c.navigation) {
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-left");
  }
  if (c.fullscreen) {
    map.addControl(
      new FullscreenControl(
        fullscreenContainer ? { container: fullscreenContainer } : {},
      ),
      "top-left",
    );
  }
  if (c.geolocate && geolocateAvailable) {
    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: c.geolocate.follow,
      showUserLocation: true,
    });
    /* a fix can still fail at runtime (denied on the prompt, no signal):
       without this the tap just does nothing */
    geolocate.on("error", () => onGeolocateError?.(t("geolocate.failed")));
    map.addControl(geolocate, "top-left");
  }
  if (c.globe) {
    map.addControl(new GlobeControl(), "top-left");
  }
  if (c.home) {
    map.addControl(
      new HomeControl(() => {
        if (initialView.bounds) {
          map.fitBounds(initialView.bounds, { padding: 24 });
        } else if (initialView.center) {
          map.easeTo({ center: initialView.center, zoom: initialView.zoom });
        }
      }, t("control.home")),
      "top-left",
    );
  }
  if (c.scale) {
    map.addControl(
      new ScaleControl({ maxWidth: c.scale.maxWidth, unit: c.scale.unit }),
      "bottom-left",
    );
  }
  if (c.attribution) {
    map.addControl(
      new AttributionControl(
        c.attribution.compact === "auto" ? {} : { compact: c.attribution.compact },
      ),
      "bottom-right",
    );
  }
}
