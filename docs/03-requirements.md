# 03 — Requirements

> Status: draft · 2026-08-14 · MoSCoW: **M**ust (v1) / **S**hould (v1.x) / **C**ould (later) / — out of scope.
> Items marked `→ D-xx` trace to a decision in [08-decisions.md](08-decisions.md) (all five decided 2026-08-14).
> Source-type scope per D-03: v1 = WMS/WMTS/GFI + vector tiles/GeoJSON/PMTiles; WFS & OGC API Features deferred to v1.x.

## 1. Functional requirements

### F1 — Map core

| ID | Requirement | Prio |
|---|---|---|
| F1.1 | Basemap from a MapLibre **style URL** (vector tiles), e.g. basemap.at `bmapv` | M |
| F1.2 | Raster basemaps: XYZ template, WMTS, WMS | M |
| F1.3 | Multiple configured basemaps with a **basemap switcher** (exclusive selection, thumbnails) | M |
| F1.4 | **Globe view** toggle (MapLibre globe projection) | M |
| F1.5 | Initial view: center/zoom or bounds; bearing/pitch optional | M |
| F1.6 | Constraints: min/max zoom, max bounds | M |
| F1.7 | Multiple independent map instances per page | M |
| F1.8 | 3D **terrain** (DEM source + exaggeration) | S |
| F1.9 | View state in URL hash (opt-in, must not clash with host page routing) | S |

### F2 — Layer tree / TOC (the heart of the client)

| ID | Requirement | Prio |
|---|---|---|
| F2.1 | Overlay tree with **nestable groups**, defined by config order (top of list = top of map) | M |
| F2.2 | Per layer: visibility toggle, **opacity slider**, zoom-to-extent | M |
| F2.3 | Group behaviors: toggle-all, collapsed state, optional radio (exclusive) groups | M |
| F2.4 | Per-layer info menu: abstract, attribution, **metadata/dataset link**, legend link → D-05 | M |
| F2.5 | Layer status feedback in TOC: loading indicator, error badge, "not visible at this zoom" hint | M |
| F2.6 | User **re-ordering** of overlays (drag & drop, touch-capable) | S |
| F2.7 | Filter/search box inside the TOC (for configs with many layers) | S |
| F2.8 | Persist user TOC changes into the shareable state (see F11) | S |

### F3 — Add & manage layers at runtime

| ID | Requirement | Prio |
|---|---|---|
| F3.1 | "Add layer" dialog: paste a service URL (WMS/WMTS), client parses capabilities, user picks layers | M → D-03 |
| F3.2 | Add GeoJSON by URL; drag & drop a local GeoJSON/KML/GPX file | S |
| F3.3 | Remove/rename user-added layers; clearly distinguished from configured layers | M |
| F3.4 | Catalog search (CSW / OGC API Records) as source for adding layers | C → D-05 |
| F3.5 | User-added layers survive in the share/permalink state (not in the page config) | S |

### F4 — Legend

| ID | Requirement | Prio |
|---|---|---|
| F4.1 | Legend panel aggregating all visible overlay legends, collapsible | M |
| F4.2 | WMS: automatic `GetLegendGraphic`; overridable via config (image URL or structured entries) | M |
| F4.3 | Vector layers: legend generated from style (symbol/line/fill swatches) where feasible | S |
| F4.4 | Legend included in print/export output | M |

### F5 — Feature info & overlays (popups)

| ID | Requirement | Prio |
|---|---|---|
| F5.1 | Click → feature info for queryable layers: vector features (client-side) and WMS **GetFeatureInfo** | M |
| F5.2 | Configurable popup content: property table (with include/exclude & labels) or **template** with `{{property}}` placeholders; sanitized HTML; media (images, links) | M |
| F5.3 | Multi-hit handling: several features/layers at one click → grouped/tabbed popup | M |
| F5.4 | Hover tooltip option per layer (short template) | S |
| F5.5 | Popup modes: anchored popup, docked panel on mobile (bottom sheet) | M |
| F5.6 | Coordinate readout / "what's here?" (right-click / long-press), copy coordinates | S |
| F5.7 | Feature highlight on selection | S |

### F6 — Controls

| ID | Requirement | Prio |
|---|---|---|
| F6.1 | Zoom in/out, compass/reset-north, pitch reset | M |
| F6.2 | Scale bar (metric) | M |
| F6.3 | **Fullscreen** control | M |
| F6.4 | **Geolocate/GPS**: show position + accuracy circle, optional follow mode; HTTPS-only; only on user action | M |
| F6.5 | Globe/2D toggle control | M |
| F6.6 | Attribution control, auto-collected from active sources, always visible (legal requirement) | M |
| F6.7 | "Home" (initial extent) button | S |
| F6.8 | Overview/mini map | C |
| F6.9 | Every control individually enable/disable/position-able via config | M |

### F7 — Print & export

| ID | Requirement | Prio |
|---|---|---|
| F7.1 | Print view: composed layout (title, map, legend, scale bar, attribution, date) via browser print dialog | M → D-04 |
| F7.2 | High-resolution **PNG export** (configurable DPI/size) | M |
| F7.3 | Client-side **PDF export** of the print layout | S |
| F7.4 | True-to-scale server-side PDF (MapFish Print or similar) as optional adapter | C → D-04 |

### F8 — Search & geocoding

| ID | Requirement | Prio |
|---|---|---|
| F8.1 | Search box with pluggable geocoder adapters (Nominatim/Photon/custom endpoint URL template) | S |
| F8.2 | Coordinate input search (lat/lon, configurable CRS display via proj4) | S |
| F8.3 | Search within configured vector layers (attribute search) | C |

### F9 — Measure & draw

| ID | Requirement | Prio |
|---|---|---|
| F9.1 | Measure distance/area (Terra Draw based module) | S |
| F9.2 | Simple annotations (point/line/polygon/text), export as GeoJSON | C |
| F9.3 | Feature editing / WFS-T | — |

### F10 — Sharing

| ID | Requirement | Prio |
|---|---|---|
| F10.1 | Share current state (view, layer visibility/opacity/order, user-added layers) as URL parameter/fragment | S |
| F10.2 | "Copy embed snippet" helper | C |

### F11 — Internationalization

| ID | Requirement | Prio |
|---|---|---|
| F11.1 | UI languages **de + en** built in; locale auto-detect + config override | M |
| F11.2 | All UI strings overridable per config (`i18n.overrides`) | S |
| F11.3 | Additional locales loadable as JSON without rebuild | S |
| F11.4 | RTL text plugin for map labels (Arabic/Hebrew) loadable on demand | C |

### F12 — Theming & layout

| ID | Requirement | Prio |
|---|---|---|
| F12.1 | Design tokens via config/CSS custom properties: primary color, radius, font, density | M |
| F12.2 | Light / dark / auto mode | M |
| F12.3 | Layout presets: full-page app-like vs. compact embedded widget; panel placement | M |
| F12.4 | Logo/title slot, custom links (imprint, data privacy) | S |
| F12.5 | Custom CSS escape hatch (documented, semver-stable part names) | S |

## 2. Configuration system requirements

| ID | Requirement | Prio |
|---|---|---|
| C1 | **Single JSON document** configures one map completely (see [04-configuration.md](04-configuration.md)) | M |
| C2 | Config delivery: inline `<script type="application/json">`, attribute URL (`config-src`), or JS object | M |
| C3 | Published, versioned **JSON Schema**; editor autocomplete via `$schema`; runtime validation with human-readable errors rendered in place of the map (fail loud, fail helpful) | M |
| C4 | Every key optional except the minimal core; documented defaults | M |
| C5 | Config `version` field with forward-compatible parsing (unknown keys → console warning, not failure) | M |
| C6 | Shared/partial configs: `"extends": "<url>"` to inherit an org-wide base config (basemaps, theming) | S |
| C7 | Runtime API mirrors config: everything settable via JS after init; config export of current state | S |
| C8 | Auth hooks for protected services: request-transform callback / static headers per source (no secrets in config!) | S |

## 3. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| N1 | Bundle size | core UI ≤ ~100 KB gz (excl. maplibre-gl); print/measure/add-layer lazy-loaded modules |
| N2 | Performance | map interactive < 2 s on mid-range mobile, 4G, vector basemap; 60 fps pan/zoom |
| N3 | Responsive | 320 px – 4K; touch-first interactions; panels become bottom sheets < 640 px; **container queries**, not viewport queries (widget may sit in a CMS column) |
| N4 | Accessibility | WCAG 2.1 AA for all UI; full keyboard operation of TOC/controls/popups; visible focus; prefers-reduced-motion respected |
| N5 | Browser support | evergreen (Chrome/Edge/Firefox last 2, Safari ≥ 16.4); no IE |
| N6 | Security | sanitize all config-provided & service-provided HTML (popups, abstracts, legends); https-only defaults; CSP-compatible (document required `worker-src blob:` etc.); no eval |
| N7 | Privacy | zero telemetry; no external calls except configured services; geolocation strictly user-initiated |
| N8 | Isolation | Shadow DOM (or equivalent) so host-page CSS and map0 CSS never collide; multiple instances OK |
| N9 | Quality | TypeScript strict; unit tests (Vitest) + E2E/visual tests (Playwright) on demo configs; semver; changelog |
| N10 | Licensing | permissive OSS (Apache-2.0 proposed → D-open); all deps compatible |
| N11 | Delivery | npm package + prebuilt CDN bundle (ESM + IIFE); self-hostable (no forced CDN); SSR-safe imports |
| N12 | Docs | doc site with live examples; config reference auto-generated from JSON Schema; "recipes" per service type |

## 4. Explicitly out of scope (v1)

- User accounts, saved maps, server-side persistence
- Feature editing (WFS-T), routing, complex geoprocessing
- Native rendering of non-Mercator CRS (see D-02)
- 3D building/mesh layers (3D Tiles) — revisit post-v1
- Time slider / WMS-T animation — candidate for v1.x, not v1
