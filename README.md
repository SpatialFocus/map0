# map0

> A modern, embeddable, JSON-configurable web map client built on
> [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
> One script tag + one JSON config = a full-featured map on any web page.
>
> **[map0.net](https://map0.net)** — site and [live demos](https://map0.net/demos).

**Status:** approaching the M1 milestone — layer tree, WMS/WMTS/vector tiles/GeoJSON, feature info,
legends, search, measuring, print, permalink, theming and i18n all work against live services.
Published as an early preview (`map0-viewer` 0.0.2 on npm, MIT); APIs and the config schema are
still v0 and will change without a deprecation path until 1.0. See
[07-roadmap.md](docs/07-roadmap.md).

## The idea in one paragraph

MapLibre made cartography declarative (the style spec is JSON). map0 extends the same idea to the
*map client*: basemaps, overlay tree/TOC, legends, feature popups, print, globe, GPS, theming — all
declared in a single, schema-validated JSON document that lives in a CMS field. It renders straight
into the page (web component / script tag — no iframe, no backend) and looks like 2026: pretty,
responsive, themable, accessible.

```html
<script type="module" src="map0.js"></script>
<map0-viewer config-src="my-map.map0.json" style="height:520px"></map0-viewer>
```

## Using it in a page

Self-hosted — `node_modules/map0-viewer/dist/` is a folder you copy next to your page:

```bash
npm install map0-viewer   # prebuilt bundle, MapLibre included, no dependencies
```

…or straight from a CDN, nothing to install:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/map0-viewer@0.0.2/dist/map0.js"></script>
```

See [packages/map0/README.md](packages/map0/README.md) for the whole integration, and
[docs/09-engineering-notes.md](docs/09-engineering-notes.md) for how the package is released.

## Working on map0

Prerequisites: Node ≥ 22 and pnpm (`corepack enable` is enough — the version is pinned via
`packageManager`).

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:5173/demos — the demo gallery**. Nineteen single-topic demos, each
with a live map against real services, a written explanation, and the exact config that produced it:

| Group | Demos |
|---|---|
| Data sources | WMS · WMTS · Vector tiles · GeoJSON & clustering |
| Map features | Popups & hover · Legend · Search · Measure · Coordinates · Print & export · Add layers · Share & permalink · Globe |
| Configuration | Minimal config · Theming · Languages · Config inheritance |
| Integration | Script tag embed (built bundle — run `pnpm demo:standalone` first) · Lazy loading |

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
A page pays **~23 KB gzip** for the element itself; the engine and MapLibre (~316 KB) load when the
map approaches the viewport, and capabilities parsing, proj4, PMTiles, measuring and the dialogs
only when those features are used. `pnpm size` prints the breakdown and fails when the page tier
grows.

## Documents

| Doc | Content |
|---|---|
| [01-vision.md](docs/01-vision.md) | Problem, vision, target users, design principles, non-goals, positioning |
| [02-landscape.md](docs/02-landscape.md) | Prior-art research, comparison table, gap analysis, engine choice (MapLibre vs OL vs deck.gl) |
| [03-requirements.md](docs/03-requirements.md) | Functional & non-functional requirements (MoSCoW) |
| [04-configuration.md](docs/04-configuration.md) | **The heart:** config philosophy + full annotated JSON example |
| [05-maplibre-capabilities.md](docs/05-maplibre-capabilities.md) | MapLibre v6 capability map, build-vs-reuse matrix, field notes from M0 |
| [06-architecture.md](docs/06-architecture.md) | Technical architecture (packaging, layering, adapters, security) |
| [07-roadmap.md](docs/07-roadmap.md) | **Status: what is done, what is left**, milestones M0 → M2 |
| [08-decisions.md](docs/08-decisions.md) | Decision log D-01…D-05 + open items |
| [09-engineering-notes.md](docs/09-engineering-notes.md) | Invariants, field notes on MapLibre and real SDI services, debugging playbook |
| [10-review-fixes.md](docs/10-review-fixes.md) | External review findings, verdicts and what was changed in response |

## Conventions

- All project documentation and code in **English**.
- Config examples target live Austrian SDI services (basemap.at, Stadt Wien OGD) where possible;
  placeholder `*.example.gv.at` URLs mark illustrative endpoints.
- A config key without documentation is not done; schema changes update
  [04-configuration.md](docs/04-configuration.md) in the same change.

## Licence

MIT — see [LICENSE](LICENSE). The published bundle contains third-party code (MapLibre GL JS
verbatim, others compiled in); their licences are reproduced in
[packages/map0/THIRD-PARTY-NOTICES.md](packages/map0/THIRD-PARTY-NOTICES.md), regenerated on every
`pnpm build:npm`.
