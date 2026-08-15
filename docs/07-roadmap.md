# 07 — Roadmap & Status

> Phases, not dates. Status as of 2026-08-15.
> Legend: ✅ done · 🟡 partial · ⬜ open. Requirement IDs refer to
> [03-requirements.md](03-requirements.md).

## Where we are

**M0 (walking skeleton) is complete. M1 (MVP) is roughly two thirds done** — the map, the layer tree,
feature info, legends, print and the whole configuration mechanism work against live Austrian SDI
services. What M1 still needs is mostly polish and packaging: a published JSON Schema, an
accessibility pass, and an actual npm/CDN release.

| Area | Status |
|---|---|
| Data sources | ✅ WMS, WMTS, vector tiles/PMTiles, GeoJSON, style & raster basemaps · ⬜ WFS, OGC API Features (deferred to v1.x per D-03) |
| Layer tree | ✅ groups, visibility, opacity, status, zoom hints, zoom-to-layer, metadata links, runtime add/remove · ⬜ drag reorder, filter box, radio groups |
| Feature info | ✅ GetFeatureInfo + vector query, templates, field tables, multi-hit, hover, highlight, coordinates · ⬜ mobile bottom sheet |
| Legend | ✅ service, style-derived, hand-written; in print |
| Print | ✅ PNG + print view, DPI, layout · ⬜ client PDF, server adapter |
| Sharing | ✅ permalink incl. user-added layers · ⬜ embed-snippet helper |
| Configuration | ✅ one document, validation with JSON-path errors, `extends`, theming, i18n + overrides · 🟡 published JSON Schema |
| Performance | ✅ 20 KB page tier, lazy engine/features, CI budget |
| Accessibility | 🟡 keyboard operation, focus trap, reduced motion · ⬜ audit, DOM-mirrored results |
| Packaging | 🟡 built bundle + demo site · ⬜ npm/CDN release, license, name |

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
- ✅ **Print & export** — composed sheet, PNG, print view (F7.1, F7.2)
- ✅ **Popups** — templates, field tables, multi-hit, sanitisation (F5.1–F5.3)
- ✅ **Hover tooltips, selection highlight, zoom-to-layer** (F5.4, F5.7, F2.2)
- ✅ **Coordinate readout** in WGS 84 / GK / UTM with proj4 (F5.6)
- ✅ **Share & permalink** incl. user-added layers (F10.1, F2.8)
- ✅ **i18n** de/en + per-locale overrides (F11.1–F11.3)
- ✅ **Config inheritance** via `extends` (C6)
- ✅ **Error toasts** and TOC zoom-range hints (F2.5)
- ✅ **Code splitting** — 20 KB page tier, lazy engine/MapLibre/features, size budget in CI (N1)
- ✅ **Dialog focus trap + Escape** (N4, partial)
- ✅ **Demo site** — 17 single-topic demos with docs and live configs

### Remaining for v1.0

- ⬜ **Published JSON Schema** + config reference generated from it (C3, N12)
- ⬜ **Unknown-key warnings** on config load (C5)
- ⬜ **Accessibility pass** — audit, keyboard TOC review, DOM-mirrored feature results (N4)
- ⬜ **Mobile popup as bottom sheet** below 640 px (F5.5)
- ⬜ **TOC filter box** for configs with many layers (F2.7)
- ⬜ **npm package + CDN build**, install docs (N11)
- ⬜ **Decide license and name**, set up the repo home (O-01, O-02, O-07)
- ⬜ **Visual regression** on the demo pages (N9)

## M1.x — Power features

- ⬜ **Search / geocoding** with pluggable adapters, coordinate search (F8.1, F8.2)
- ⬜ **Measure module** on Terra Draw (F9.1)
- ⬜ **WFS and OGC API Features** layer types (deferred from D-03)
- ⬜ **Client-side PDF** in the print dialog (F7.3) — jsPDF, lazily loaded
- ⬜ **Drag-and-drop reorder** in the TOC (F2.6)
- ⬜ **GeoJSON/GPX by URL and file drop** (F3.2)
- ⬜ **Terrain** (F1.8)
- ⬜ **Auth hooks** for protected services (C8)
- ⬜ **React wrapper** (`@map0/react`)
- ⬜ **COG** layers, once the protocol library reaches 1.0

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
