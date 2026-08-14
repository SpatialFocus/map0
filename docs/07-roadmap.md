# 07 — Roadmap

> Status: draft · 2026-08-14 · Phases, not dates. Adjust after decisions D-01…D-05 are settled.

## M0 — Spike / walking skeleton (~2–3 weeks of focused work)

Goal: validate the architecture and the config idea end-to-end, produce something demoable.

- Repo scaffold (monorepo, TypeScript strict, Vite, Vitest/Playwright, CI)
- Config schema **v0** (draft) + validation + friendly error panel
- Map core: style-URL basemap, raster basemap, basemap switcher (minimal)
- TOC v0: flat list + groups, visibility, opacity
- WMS overlay incl. GetFeatureInfo popup; GeoJSON overlay with template popup
- Controls: zoom, scale, fullscreen, geolocate, globe toggle
- Theming v0: primary color, light/dark
- **3 real demo configs** against live services (basemap.at vector, one WMS with legend+GFI, one GeoJSON/PMTiles)
- Exit criteria: "one script tag + one JSON" works on a plain HTML page and in one real CMS page.

## M1 — MVP (v1.0)

Everything **Must** in [03-requirements.md](03-requirements.md):

- Config schema **v1 frozen** + published JSON Schema + docs generated from it
- TOC complete (status badges, info dialogs, metadata links, radio groups)
- Legend panel (GetLegendGraphic + config overrides)
- Popups complete (multi-hit, templates, sanitization, mobile bottom sheet)
- Add-layer via service URL (WMS/WMTS capabilities parsing)
- Print view + PNG export (client-side)
- i18n de/en; a11y pass (WCAG 2.1 AA); container-query responsive layout
- npm + CDN release, doc site with live playground, embed guide for CMS
- Demo gallery ("show, don't tell" — this is the marketing)

## M2 — Power features (v1.x)

- Share/permalink state; user layer persistence
- Search/geocoding (pluggable adapters), coordinate search
- Measure module (Terra Draw), vector-style legends
- WFS / OGC API Features sources; PMTiles/COG polish
- Client-side PDF export; server print adapter (if D-04 says so)
- Catalog integration module (CSW / OGC API Records, if D-05 says so)
- React wrapper (if D-01 demands it); terrain
- `extends` shared configs; auth hooks for protected services

## M3 — Ecosystem (post v1.x, evaluate by adoption)

- **Visual config editor** (generates/edits the JSON; the CMS killer feature)
- Drawing/annotations, attribute search
- Time-enabled layers (WMS TIME) / simple animation
- Additional locales, community plugin API
- Optional companion services (print server recipe, capabilities proxy recipe)

## Standing tracks (every milestone)

- Visual regression suite green on all demo configs
- Bundle-size budget enforced in CI
- Docs updated in the same PR as the feature ("config key without docs = not done")
