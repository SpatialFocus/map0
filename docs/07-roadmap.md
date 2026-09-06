# 07 — Roadmap & Status

> Phases, not dates. Status as of 2026-08-19.
> Legend: ✅ done · 🟡 partial · ⬜ open. Requirement IDs refer to
> [03-requirements.md](03-requirements.md).

## Where we are

**M0 (walking skeleton) is complete. M1 (MVP) is close** — the map, the layer tree, feature info,
legends, print, search, measuring and the whole configuration mechanism work against live Austrian
SDI services, and the package is published (`map0-viewer` on npm, usable via the jsDelivr CDN).
What is left is mostly polish: the accessibility pass, a filter box for large layer trees,
visual regression on the demo pages and repo governance.

| Area | Status |
|---|---|
| Data sources | ✅ WMS, WMTS, WFS (paged GetFeature → geojson pipeline), OGC API Features (next-link paging → geojson pipeline), vector tiles/PMTiles, GeoJSON, GeoParquet (decoded in the browser, geojson styling pipeline), COG (RGB, single-band ramps, explicit classes, hillshade), style & raster basemaps |
| Layer tree | ✅ groups, visibility, opacity, status, zoom hints, zoom-to-layer, metadata links, runtime add/remove (WMS/WMTS from capabilities, GeoJSON by URL, GeoJSON/KML/GPX files dropped on the map) · ⬜ drag reorder, filter box, radio groups |
| Feature info | ✅ GetFeatureInfo + vector query, templates, field tables, multi-hit, hover, highlight, coordinates, bottom sheet on narrow viewers |
| Legend | ✅ service, style-derived, hand-written; in print |
| Print | ✅ PNG, PDF (real paper sizes), print view, DPI, configurable sheet · ⬜ server adapter for scale-true output |
| Sharing | ✅ permalink incl. user-added layers · ⬜ embed-snippet helper |
| Search | ✅ type-ahead geocoding, pluggable providers, coordinate input |
| Measuring | ✅ distance & area, geodesic, draggable vertices |
| Configuration | ✅ one document, validation with JSON-path errors (unknown keys, unique ids, https policy), `extends`, theming, i18n + overrides, published JSON Schema with a generated key-by-key reference |
| Performance | ✅ 31 KB page tier, engine and features load on demand, CI budget |
| Accessibility | 🟡 keyboard operation, focus trap, reduced motion · ⬜ audit, DOM-mirrored results |
| Packaging | ✅ MIT licence, name, npm package `map0-viewer` published (prebuilt bundle + third-party notices), CDN via jsDelivr, demo site at map0.net, TypeScript declarations in the tarball |

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
- ✅ **Code splitting + lazy loading** — 31 KB page tier, MapLibre deferred until the map is in view, size budget in CI (N1)
- ✅ **Dialog focus trap + Escape** (N4, partial)
- ✅ **Search** — type-ahead geocoding with Photon/Nominatim/custom providers, coordinate input (F8.1, F8.2)
- ✅ **Measure** — distance and area on the sphere, draggable vertices (F9.1)
- ✅ **Demo site** — 21 single-topic demos with docs and live configs, including an online
  config validator

### Remaining for v1.0

- ✅ **Published JSON Schema** (C3) — hand-written `packages/schema/v1.json` (the descriptions are
  the editor documentation), served at <https://map0.net/schema/v1.json> and shipped in the npm
  tarball; key sets and enums are locked to the validator's tables by `v1-schema.test.ts`, so
  schema and validator cannot drift · ✅ **config reference generated from the schema** (N12,
  2026-09-05) — `docs/config-reference.md` is written from v1.json by `scripts/config-reference.mjs`
  (`pnpm docs:reference`); `config-reference.test.ts` fails while the page is stale, so descriptions
  are maintained once, in the schema
- ✅ **Unknown-key warnings** (C5 — reported, never fatal), id uniqueness, nested shapes and the
  https policy in the validator (N6)
- ⬜ **Accessibility pass** — audit, keyboard TOC review, DOM-mirrored feature results (N4)
- ✅ **Mobile popup as bottom sheet** below 640 px (F5.5, 2026-09-06) — `<map0-bottom-sheet>` in the
  lazy popup chunk; a ResizeObserver on the host decides by the element's own width, so embedded
  viewers behave; drag or tap the handle between 45 % and 90 %, Escape, the close button or a tap
  beside the features slide it out and return focus to the map; the anchored popup above 640 px is
  unchanged, no config key
- ⬜ **TOC filter box** for configs with many layers (F2.7)
- ✅ **npm package** `map0-viewer` published (prebuilt bundle, `pnpm build:npm`), CDN via
  jsDelivr, install docs in the package README · ✅ **TypeScript types** (N11, 2026-09-06) — `dist/map0.d.ts`,
  `dist/map0-ssr.d.ts` and the shared `dist/map0-types.d.ts` (dts-bundle-generator over `public.ts`,
  workspace packages inlined; `@types/geojson` is a dependency, `maplibre-gl` an optional peer for
  `api.map`); `e2e/verify-types.mjs` type-checks a strict consumer against the packed tarball
- ✅ **License (MIT) and name (map0)** decided (O-01, O-02) · ⬜ repo governance (O-07)
- ⬜ **Visual regression** on the demo pages (N9)
- ✅ **Deterministic browser smoke test in CI** — element lifecycle, z-order and the built bundle,
  network-free (`pnpm smoke`); see [10-review-fixes.md](10-review-fixes.md)

## M1.x — Power features

- ✅ **WFS** layer type (2026-09-02) — `type: "wfs"`: paged GetFeature (count/startIndex, silent-cap
  recovery via the server's reported total), `limit`/`pageSize`, vendor `params` (cql_filter),
  OWS-exception unwrapping, rendered through the geojson pipeline
- ✅ **OGC API Features** layer type (2026-09-02) — `type: "ogcapi-features"`: a collection URL is
  enough; items paged by following the response's `next` links (numberMatched is optional in the
  wild), `limit`/`pageSize`, `params` (bbox, datetime, CQL2 filter), JSON problem details as layer
  errors, rendered through the geojson pipeline
- ✅ **GeoParquet** layer type (2026-09-02) — `type: "geoparquet"`: whole-file fetch, decoded in the
  browser (hyparquet, lazy chunk; extra codecs only when needed), bbox from the file
  metadata, rendered through the geojson pipeline
- ✅ **`crs` on feature files** (2026-09-03) — geojson and geoparquet layers whose coordinates are
  not WGS84 are reprojected once on load with proj4 (built-in registry: Austrian GK M28/M31/M34 and
  Lambert, ETRS89 UTM 32/33N, LAEA Europe, Austria Lambert, WGS84 UTM zones; anything else via
  `{ code, def }`); GeoParquet resolves the CRS from its own `geo` metadata, legacy GeoJSON `crs`
  members in inline data are honoured. Rendering stays Web Mercator (D-02)
- ⬜ **Drag-and-drop reorder** in the TOC (F2.6)
- ✅ **GeoJSON/KML/GPX by URL and file drop** (F3.2, 2026-09-06) — the add-layer dialog takes a
  GeoJSON URL (same https policy as the config) and a file picker; files dropped on the map become
  geojson layers, one per file, with auto zoom (KML/GPX via `@tmcw/togeojson`, a lazy chunk; a legacy
  GeoJSON `crs` member is reprojected like everywhere else). Both gated by `allowAdd`; layers with
  inline data stay out of the share link
- ⬜ **Terrain** (F1.8)
- ⬜ **Auth hooks** for protected services (C8)
- ⬜ **React and Angular wrappers** (`@map0/react`, `@map0/angular`)
- ✅ **COG** layers (2026-08-19) — `type: "cog"`: RGB/grayscale imagery, single-band color
  ramps with auto-derived legend, and DEM hillshade (`hillshade` key → raster-dem + hillshade
  layer); bounds from the file header, decoder loaded on demand
  (@geomatico/maplibre-cog-protocol, adopted at 0.9.x — see D-03 update) · 3D terrain itself
  stays with F1.8 · **explicit classes** added 2026-08-20 (`color.classes`: exact values and
  [from, to) ranges with hand-picked colors and labels, for categorical/binary rasters a ramp
  cannot express)

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
