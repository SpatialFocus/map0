# map0

> **Working title.** A modern, embeddable, JSON-configurable web map client built on
> [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
> One script tag + one JSON config = a full-featured map on any web page.

**Status:** M0 spike — the walking skeleton works (TOC, WMS + GetFeatureInfo, GeoJSON/clustering,
basemap switching, globe, theming, i18n). No release yet; APIs and the config schema are still v0.

## The idea in one paragraph

MapLibre made cartography declarative (the style spec is JSON). map0 extends the same idea to the
*map client*: basemaps, overlay tree/TOC, legends, feature popups, print, globe, GPS, theming — all
declared in a single, schema-validated JSON document that lives in a CMS field. It renders straight
into the page (web component / script tag — no iframe, no backend) and looks like 2026: pretty,
responsive, themable, accessible. Think "Masterportal's configure-everything philosophy" ×
"MapLibre's rendering & DX" ÷ "the complexity".

```html
<script type="module" src="map0.js"></script>
<map0-viewer config-src="my-map.map0.json" style="height:520px"></map0-viewer>
```

## Getting started

Prerequisites: Node ≥ 22 and pnpm (`corepack enable` is enough — the version is pinned via
`packageManager`).

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:5173 — the example gallery**. It contains:

- **Wien — WMS + GetFeatureInfo**: basemap.at vector + Orthofoto, Stadt Wien OGD WMS overlays,
  click-info popups, TOC with groups/opacity/metadata links
- **GeoJSON & Cluster**: ~2,400 drinking fountains (WFS→GeoJSON, clustered), local demo zones with
  popup templates, custom theming
- **Globe**: MapLibre globe projection, inline GeoJSON, dark theme
- **Minimal config**: the contract — `version` + one basemap inline in the HTML must yield a full map
- **Standalone**: the same Vienna map running from the **built bundle** instead of dev aliases
  (run `pnpm demo:standalone` first)

More commands:

```bash
pnpm test                  # unit tests (Vitest)
pnpm typecheck             # strict TypeScript project build
pnpm build                 # library bundle → packages/ui/dist/
pnpm demo:standalone       # build + copy the bundle for the standalone demo page
node e2e/verify-demos.mjs  # headless smoke run with screenshots (dev server must be running)
```

## Repository layout

```
packages/schema   config types v0, validation (JSON-path errors), defaults
packages/core     headless engine: basemap manager, source adapters (wms/raster/geojson/vector),
                  feature info, i18n — no DOM UI
packages/ui       the <map0-viewer> web component (Lit) + panels, popups, theming
examples/         demo gallery + demo configs against live Austrian SDI services
e2e/              headless smoke verification (grows into the Playwright suite in M1)
docs/             specification
```

Distribution note: `packages/ui/dist/` ships `map0.js` **plus** MapLibre's worker files
(`maplibre-gl-worker.mjs`, `maplibre-gl-shared.mjs`) — deploy them side by side.

## Documents

| Doc | Content |
|---|---|
| [01-vision.md](docs/01-vision.md) | Problem, vision, target users, design principles, non-goals, positioning |
| [02-landscape.md](docs/02-landscape.md) | Prior-art research, comparison table, gap analysis, engine choice (MapLibre vs OL vs deck.gl) |
| [03-requirements.md](docs/03-requirements.md) | Functional & non-functional requirements (MoSCoW) |
| [04-configuration.md](docs/04-configuration.md) | **The heart:** config philosophy + full annotated JSON example |
| [05-maplibre-capabilities.md](docs/05-maplibre-capabilities.md) | MapLibre v6 capability map, build-vs-reuse matrix, field notes from M0 |
| [06-architecture.md](docs/06-architecture.md) | Technical architecture (packaging, layering, adapters, security) |
| [07-roadmap.md](docs/07-roadmap.md) | Milestones M0 (spike) → M3 (ecosystem) |
| [08-decisions.md](docs/08-decisions.md) | Decision log D-01…D-05 + open items |

Reading order for newcomers: 01 → 04 → 03.

## Conventions

- All project documentation and code in **English**.
- Config examples target live Austrian SDI services (basemap.at, Stadt Wien OGD) where possible;
  placeholder `*.example.gv.at` URLs mark illustrative endpoints.
- A config key without documentation is not done; schema changes update
  [04-configuration.md](docs/04-configuration.md) in the same change.
