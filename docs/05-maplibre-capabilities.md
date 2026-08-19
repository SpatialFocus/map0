# 05 — MapLibre Capability & Ecosystem Map

> Status: researched 2026-08-14 (live web check) · Basis for build-vs-reuse decisions per feature.
> MapLibre GL JS current version: **v6.3.0** (2026-08-10). v6.0.0 (2026-07-22) went **ESM-only** and
> requires **WebGL2**; the v5 line (globe release, 2024-12-31) ended at 5.24.0.

## Engine facts that shape map0

| Fact | Consequence for map0 |
|---|---|
| **v6 is ESM-only** (UMD bundle dropped), ES2022 target | Our CDN build must be `<script type="module">`; fits the web-component plan. |
| **WebGL2 mandatory** since v6 | Browser floor effectively evergreen; matches N5. Older kiosk devices need v5 pin (we target v6). |
| **Globe projection + built-in `GlobeControl`** since v5; runtime-switchable, terrain works on globe | F1.4 is nearly free. |
| **Terrain, sky/atmosphere** in core | F1.8 config key maps 1:1. |
| Rendering is **Web Mercator only** (plus globe). Custom-CRS is an official roadmap item ([maplibre#168](https://github.com/maplibre/maplibre-gl-js/issues/168), [roadmap](https://maplibre.org/roadmap/maplibre-gl-js/non-mercator-projection/)) but **not implemented** as of mid-2026 | Confirms decision D-02: services must serve 3857 (WMS) / WebMercatorQuad (WMTS); vector data in 4326/CRS84. Design the schema so a future `crs` key can be added without breakage. |
| `MapOptions.locale` localizes all built-in control strings | Pipe map0's i18n dictionary through it (F11). |
| `Hash` URL-state built in (`#map=z/lat/lon`) | F1.9, but we implement our own param to avoid clashing with host-page routing. |
| Bundle: **~253 KB min+gzip**, BSD-3-Clause, no telemetry/API keys | Fine for public sector; our N1 budget is on top of this. |
| `setStyle()` destroys runtime overlays → use `transformStyle` to re-inject | The **basemap switcher** must be built on this pattern; core architectural detail. |

## Consuming sources & services

| Source | Support | Pattern / gotchas |
|---|---|---|
| Vector tiles (MVT) | native | Happy path. (MLT format is experimental — ignore for now.) |
| Style JSON basemap | native | `transformStyle` on switch (see above). |
| XYZ / TileJSON | native | — |
| GeoJSON | native | Built-in clustering (`cluster*`), `promoteId`, incremental `updateData`. |
| **WMS** | via raster source | GetMap template with `{bbox-epsg-3857}`; pin `CRS=EPSG:3857` (dodges the 1.3.0 axis-order trap); `transparent=true`; tiled requests can hammer un-cached servers — make `tileSize` configurable, document caching. **GetFeatureInfo: hand-rolled** (bbox+I/J computation, `info_format=application/json` preferred, GML/HTML fallback). |
| **WMTS** | via raster source | No capabilities support in core: resolve capabilities → rewrite ResourceURL/KVP template (`{TileMatrix}→{z}` …). Only 3857-compatible matrix sets. |
| **WFS** | via GeoJSON | `GetFeature` + `outputFormat=application/json` + `srsName=EPSG:4326`; paging via `startIndex`/`count`. |
| **OGC API Features** | via GeoJSON | Cleanest modern fit: `/items` is GeoJSON natively; bbox + paging. |
| OGC API Tiles/Maps | via templates | WebMercatorQuad template plugs into vector/raster sources directly. |
| **PMTiles** | protocol plugin | [pmtiles](https://github.com/protomaps/PMTiles) v4.5 (active, 2026-08) via `addProtocol` — first-class. |
| COG | protocol plugin | [@geomatico/maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol) — **adopted 2026-08-19** as `type: "cog"` at 0.9.x (pinned ^0.9.2, lazy chunk; see D-03 update). EPSG:3857 only, no reprojection. |

**Key helper library:** [@camptocamp/ogc-client](https://github.com/camptocamp/ogc-client) — capabilities
parsing for WMS, WFS, WMTS, OGC API Records/Features, TMS, STAC (worker-based). Actively developed
(Camptocamp, commits Aug 2026). This powers F3.1 (add-layer dialog) and the WMTS resolver. Small
community — budget for upstream contributions. (Fallback: `@loaders.gl/wms`.)

## Feature → build-vs-reuse matrix

| map0 feature | Reuse | Build ourselves | Verdict |
|---|---|---|---|
| Zoom/compass, scale, fullscreen, geolocate, attribution, terrain, globe | Built-in controls (`NavigationControl`, `ScaleControl`, `FullscreenControl`, `GeolocateControl`, `AttributionControl`, `TerrainControl`, `GlobeControl`) | restyle via CSS | **Reuse**, restyled |
| Layer switcher / TOC | nothing production-grade exists | ✔ core product logic | **Build** (expected — this *is* map0) |
| Basemap switcher | `maplibre-gl-basemaps` stale (2025-01) | ✔ small, on `setStyle`+`transformStyle` | **Build** |
| Legend (vector) | [@watergis/maplibre-gl-legend](https://github.com/watergis/maplibre-gl-legend) 2.0.7 (2026-05) | style→swatch generator, integrated in our panel UI | **Hybrid**: borrow approach, render in our UI |
| Legend (WMS) | — | ✔ trivial `GetLegendGraphic` `<img>` | **Build** |
| Print/export | [@watergis/maplibre-gl-export](https://github.com/watergis/maplibre-gl-export) **5.0.0 (2026-07)**: PNG/JPG/PDF/SVG, DPI 96–400, paper sizes, scale bar + north arrow, v5/v6 compatible | layout UI in our design | **Reuse core technique** (hidden cloned map at target DPI); PDF is raster-in-PDF, not scale-true — matches D-04 option A |
| Measure | [@watergis/maplibre-gl-terradraw](https://github.com/watergis/maplibre-gl-terradraw) 1.15 (2026-08) | — | **Reuse** (module, lazy) |
| Draw | [Terra Draw](https://github.com/JamesLMilner/terra-draw) 1.32 + maplibre adapter — the ecosystem standard | — | **Reuse** (M2/M3) |
| Geocoding | [@maplibre/maplibre-gl-geocoder](https://github.com/maplibre/maplibre-gl-geocoder) 1.9.4 (2025-12), pluggable `geocoderApi` (Nominatim/Photon/custom) | possibly own UI for design consistency | **Reuse API pattern**, own UI shell |
| Swipe/compare | `@maplibre/maplibre-gl-compare` dormant (2023) | ✔ ~200 LOC if wanted | **Build later** (not in requirements) |
| Overview map | nothing on npm maintained | ✔ second `Map` + bounds rect | **Build** (C-prio) |
| Feature popups | built-in `Popup` + `queryRenderedFeatures` | template engine + sanitization + multi-hit UI | **Hybrid** |
| Inspect/debug | [@maplibre/maplibre-gl-inspect](https://github.com/maplibre/maplibre-gl-inspect) 1.8.2 | — | Dev-mode only |

## Framework wrappers (for D-01 context)

- **Web component**: no maintained MapLibre web-component wrapper exists (2024 toy packages only) →
  building map0 as a custom element (e.g. with **Lit**) is greenfield, no conflict, and fills a real gap.
- React: [react-map-gl](https://github.com/visgl/react-map-gl) v8 (dedicated `/maplibre` entry, active) — relevant if D-01 = React or for a later wrapper.
- Svelte: svelte-maplibre 2.0 / svelte-maplibre-gl (MIERUNE) — both active.
- Vue 3: @indoorequal/vue-maplibre-gl v9 (2026-08). Angular: official ngx-maplibre-gl v22.

## i18n / RTL

- RTL text: opt-in `setRTLTextPlugin` (lazy-loadable) — map0 config key `i18n.rtl: true|"auto"` (C-prio).
- UI strings: our dictionary + `MapOptions.locale` for built-ins.

## Accessibility (input for N4)

Canvas maps have structural a11y limits; map0 must add its own layer:
- Keyboard map nav exists (arrows/±/rotate); controls are labeled buttons. But **rendered features are
  not focusable/perceivable** by screen readers — popups/feature lists must be DOM-mirrored in map0 UI.
- Known upstream niggles: popup focus stealing ([#7082](https://github.com/maplibre/maplibre-gl-js/issues/7082)),
  `reduceMotion` not fully wired to `prefers-reduced-motion` ([#6691](https://github.com/maplibre/maplibre-gl-js/issues/6691)) — map0 sets `reduceMotion` from the media query itself.
- WCAG evaluation tracking: [maplibre#53](https://github.com/maplibre/maplibre-gl-js/issues/53).

## Print rendering techniques (input for D-04)

- **Client-side (v1)**: hidden cloned map at target size/DPI (`pixelRatio`), wait for `idle`,
  `canvas.toDataURL()`; compose title/legend/scale bar/north arrow in DOM/canvas; browser print + jsPDF.
  Caveat: cartographic scale approximate — "export what you see", not survey-grade.
- **Server-side (later)**: [maplibre-native](https://github.com/maplibre/maplibre-native) Node bindings
  (`@maplibre/maplibre-gl-native` 6.4.1) or [mbgl-renderer](https://www.npmjs.com/package/mbgl-renderer)
  as a static-map service → scale-true PDF adapter without changing the client architecture.

## Field notes from the M0 spike (2026-08-14, verified hands-on)

1. **MapLibre v6 worker architecture**: v6 spawns its worker from *separate dist files*
   (`maplibre-gl-worker.mjs` shim → imports `maplibre-gl-shared.mjs`), resolved **relative to the
   main bundle URL**. Consequences: (a) our dist must ship both files next to `map0.js`
   (handled by a build plugin); (b) in Vite dev, `optimizeDeps.exclude: ["maplibre-gl"]` is
   required — pre-bundling breaks the worker URL, the worker 404s and dies **silently**: raster
   still renders (main thread) while vector tiles/GeoJSON never appear. Diagnostic: check
   `page.workers()` / DevTools worker list.
   **Follow-up (code splitting):** because the worker needs `maplibre-gl-shared.mjs` on disk
   anyway, *bundling* MapLibre ships that half twice — once inside our bundle, once as the file.
   map0 therefore keeps `maplibre-gl` external and copies all three files verbatim into dist
   (~130 KB gz saved, and MapLibre stays cacheable across map0 releases).
2. **basemap.at styles need URL fixing**: the bmapv style declares a *relative* sprite path
   (`../sprites/sprite`, rejected by MapLibre v6) and its ESRI-style TileJSON returns *relative*
   `tiles` templates (`tile/{z}/{y}/{x}.pbf`) that MapLibre does not resolve → no tile requests at
   all. map0 core therefore (a) absolutizes `sprite`/`glyphs`/`tiles` against the style URL
   (brace-safe, no `URL()` encoding of `{z}`) and (b) fetches + inlines TileJSON sources.
   Both fixes live in `packages/core/src/basemaps.ts`.
3. **`map.isStyleLoaded()` is not a readiness signal** (stays false with any pending work);
   the UI dismisses its loading veil on the first rendered frame after `style.load` instead.

## Watch list

- **Custom-CRS roadmap item** — would change the national-grid story; keep `crs` extensible in schema (D-02).
- **MLT** (MapLibre Tiles, experimental `encoding:'mlt'`) — don't build on it yet.
- COG protocol maturing toward 1.0 — map0 adopted 0.9.x (pinned); review the changelog on every
  bump, `getCogMetadata` is documented as unstable upstream.
- **deck.gl interop** (`@deck.gl/mapbox` `MapboxOverlay`, overlaid/interleaved) — candidate for an
  optional `deck` big-data layer adapter in M3; complement, not engine alternative
  (see [02-landscape.md](02-landscape.md) §Engine choice).
