# 07 — Roadmap & Status

> Phases, not dates. Status as of 2026-08-19.
> Legend: ✅ done · 🟡 partial · ⬜ open. Requirement IDs refer to
> [03-requirements.md](03-requirements.md).

## Where we are

**M0 (walking skeleton) is complete. M1 (MVP) is close** — the map, the layer tree, feature info,
legends, print, search, measuring and the whole configuration mechanism work against live Austrian
SDI services, and the package is published (`map0-viewer` on npm, usable via the jsDelivr CDN).
What is left is mostly polish: a published JSON Schema and an accessibility pass.

| Area | Status |
|---|---|
| Data sources | ✅ WMS, WMTS, vector tiles/PMTiles, GeoJSON, COG (RGB, single-band ramps, hillshade), style & raster basemaps · ⬜ WFS, OGC API Features (deferred to v1.x per D-03) |
| Layer tree | ✅ groups, visibility, opacity, status, zoom hints, zoom-to-layer, metadata links, runtime add/remove · ⬜ drag reorder, filter box, radio groups |
| Feature info | ✅ GetFeatureInfo + vector query, templates, field tables, multi-hit, hover, highlight, coordinates · ⬜ mobile bottom sheet |
| Legend | ✅ service, style-derived, hand-written; in print |
| Print | ✅ PNG, PDF (real paper sizes), print view, DPI, configurable sheet · ⬜ server adapter for scale-true output |
| Sharing | ✅ permalink incl. user-added layers · ⬜ embed-snippet helper |
| Search | ✅ type-ahead geocoding, pluggable providers, coordinate input |
| Measuring | ✅ distance & area, geodesic, draggable vertices |
| Configuration | ✅ one document, validation with JSON-path errors (unknown keys, unique ids, https policy), `extends`, theming, i18n + overrides · 🟡 published JSON Schema |
| Performance | ✅ 23 KB page tier, engine and features load on demand, CI budget |
| Accessibility | 🟡 keyboard operation, focus trap, reduced motion · ⬜ audit, DOM-mirrored results |
| Packaging | ✅ MIT licence, name, npm package `map0-viewer` published (prebuilt bundle + third-party notices), CDN via jsDelivr, demo site at map0.net · ⬜ TypeScript types |

## M0 — Walking skeleton ✅

- ✅ Monorepo, TypeScript strict, Vite, Vitest, CI
- ✅ Config schema v0 + validation + friendly error panel
- ✅ Basemaps (style, raster, empty) + switcher that survives style changes
- ✅ WMS with GetFeatureInfo, GeoJSON with template popups
- ✅ Controls: zoom, scale, fullscreen, geolocate, globe
- ✅ Theming v0, light/dark
- ✅ Demo configs against live services
- ✅ **Exit criterion met:** one script tag + one JSON on a plain HTML page

## M1 — MVP (v1.0)

### Done

- ✅ **WMTS** resolved from capabilities, incl. dead-mirror probing (F1.2, D-03)
- ✅ **Vector tiles / PMTiles** overlays with style-spec layers (F1.1, D-03)
- ✅ **Legend panel** — service legends, style-derived swatches, config entries (F4.1–F4.4)
- ✅ **Add-layer dialog** — WMS/WMTS URL → capabilities → picker; runtime add/remove (F3.1, F3.3, F3.5)
- ✅ **Print & export** — composed sheet, PNG, PDF on real A4/A3 pages, print view (F7.1–F7.3)
- ✅ **Popups** — templates, field tables, multi-hit, sanitisation (F5.1–F5.3)
- ✅ **Hover tooltips, selection highlight, zoom-to-layer** (F5.4, F5.7, F2.2)
- ✅ **Coordinate readout** in WGS 84 / GK / UTM with proj4 (F5.6)
- ✅ **Share & permalink** incl. user-added layers (F10.1, F2.8)
- ✅ **i18n** de/en + per-locale overrides (F11.1–F11.3)
- ✅ **Config inheritance** via `extends` (C6)
- ✅ **Error toasts** and TOC zoom-range hints (F2.5)
- ✅ **Code splitting + lazy loading** — 23 KB page tier, MapLibre deferred until the map is in view, size budget in CI (N1)
- ✅ **Dialog focus trap + Escape** (N4, partial)
- ✅ **Search** — type-ahead geocoding with Photon/Nominatim/custom providers, coordinate input (F8.1, F8.2)
- ✅ **Measure** — distance and area on the sphere, draggable vertices (F9.1)
- ✅ **Demo site** — 20 single-topic demos with docs and live configs

### Remaining for v1.0

- ⬜ **Published JSON Schema** + config reference generated from it (C3, N12) — generated from the
  key tables in `packages/schema/src/validate.ts`, so schema and validator cannot drift
- ✅ **Unknown-key warnings** (C5 — reported, never fatal), id uniqueness, nested shapes and the
  https policy in the validator (N6)
- ⬜ **Accessibility pass** — audit, keyboard TOC review, DOM-mirrored feature results (N4)
- ⬜ **Mobile popup as bottom sheet** below 640 px (F5.5)
- ⬜ **TOC filter box** for configs with many layers (F2.7)
- ✅ **npm package** `map0-viewer` published (prebuilt bundle, `pnpm build:npm`), CDN via
  jsDelivr, install docs in the package README · ⬜ TypeScript types (N11)
- ✅ **License (MIT) and name (map0)** decided (O-01, O-02) · ⬜ repo governance (O-07)
- ⬜ **Visual regression** on the demo pages (N9)
- ✅ **Deterministic browser smoke test in CI** — element lifecycle, z-order and the built bundle,
  network-free (`pnpm smoke`); see [10-review-fixes.md](10-review-fixes.md)

## M1.x — Power features

- ⬜ **WFS and OGC API Features** layer types (deferred from D-03)
- ⬜ **Drag-and-drop reorder** in the TOC (F2.6)
- ⬜ **GeoJSON/GPX by URL and file drop** (F3.2)
- ⬜ **Terrain** (F1.8)
- ⬜ **Auth hooks** for protected services (C8)
- ⬜ **React wrapper** (`@map0/react`)
- ✅ **COG** layers (2026-08-19) — `type: "cog"`: RGB/grayscale imagery, single-band color
  ramps with auto-derived legend, and DEM hillshade (`hillshade` key → raster-dem + hillshade
  layer); bounds from the file header, decoder loaded on demand
  (@geomatico/maplibre-cog-protocol, adopted at 0.9.x — see D-03 update) · 3D terrain itself
  stays with F1.8

## M2 — Ecosystem

- ⬜ **Catalog module** — GeoNetwork CSW / OGC API Records search (D-05, F3.4)
- ⬜ **Server-side print adapter** for scale-true PDF (D-04, F7.4)
- ⬜ **Visual config editor** — the CMS killer feature
- ⬜ **Drawing / annotations** (F9.2)
- ⬜ **Time-enabled layers** (WMS TIME)
- ⬜ **Optional deck.gl overlay adapter** for very large datasets
- ⬜ **Plugin API** for third-party adapters and panels

## Standing rules

- A config key without documentation is not done — schema changes update
  [04-configuration.md](04-configuration.md) in the same commit.
- New features get a demo page under `/demos` (that is also how they get verified).
- `node e2e/verify-demos.mjs` green and the console clean before committing.
- Anything learned the hard way goes into [09-engineering-notes.md](09-engineering-notes.md).
