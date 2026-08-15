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

Then open **http://localhost:5173/demos — the demo gallery**. Sixteen single-topic demos, each
with a live map against real services, a written explanation, and the exact config that produced it:

| Group | Demos |
|---|---|
| Data sources | WMS · WMTS · Vector tiles · GeoJSON & clustering |
| Map features | Popups & hover · Legend · Coordinates · Print & export · Add layers · Share & permalink · Globe |
| Configuration | Minimal config · Theming · Languages · Config inheritance |
| Integration | Script tag embed (built bundle — run `pnpm demo:standalone` first) |

More commands:

```bash
pnpm test                       # unit tests (Vitest)
pnpm typecheck                  # strict TypeScript project build
pnpm build                      # library bundle → packages/ui/dist/
pnpm demo:standalone            # build + copy the bundle for the standalone demo page
node e2e/verify-demos.mjs       # headless smoke run over every demo, with screenshots
node e2e/verify-demos.mjs wms   # …or just one (dev server must be running)
```

## Repository layout

```
packages/schema   config types v0, validation (JSON-path errors), defaults
packages/core     headless engine: basemap manager, source adapters (wms/raster/geojson/vector),
                  feature info, i18n — no DOM UI
packages/ui       the <map0-viewer> web component (Lit) + panels, popups, theming
examples/         landing page, /demos gallery and demo pages
examples/public/  demo configs and data served as-is
e2e/              headless smoke verification (grows into the Playwright suite in M1)
docs/             specification
```

Distribution note: `packages/ui/dist/` is a flat folder — `map0.js`, its chunks, and MapLibre's
three files shipped verbatim. Deploy the folder as a unit; the embed stays one script tag.
Roughly **58 KB gzip** of map0 plus **275 KB** of MapLibre load up front; capabilities parsing
(ogc-client), proj4, PMTiles and the dialogs load on first use. `pnpm size` prints the breakdown
and fails when the eager part outgrows its budget.

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
