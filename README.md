# map0

> **Working title.** A modern, embeddable, JSON-configurable web map client built on
> [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
> One script tag + one JSON config = a full-featured map on any web page.

**Status: specification phase** (started 2026-08-14). No code yet.

## The idea in one paragraph

MapLibre made cartography declarative (the style spec is JSON). map0 extends the same idea to the
*map client*: basemaps, overlay tree/TOC, legends, feature popups, print, globe, GPS, theming — all
declared in a single, schema-validated JSON document that lives in a CMS field. It renders straight
into the page (web component / script tag — no iframe, no backend) and looks like 2026: pretty,
responsive, themable, accessible. Think "Masterportal's configure-everything philosophy" ×
"MapLibre's rendering & DX" ÷ "the complexity".

## Documents

| Doc | Content |
|---|---|
| [01-vision.md](docs/01-vision.md) | Problem, vision, target users, design principles, non-goals, positioning |
| [02-landscape.md](docs/02-landscape.md) | Prior-art research (verified 2026-08-14), comparison table, gap analysis, what to borrow |
| [03-requirements.md](docs/03-requirements.md) | Functional & non-functional requirements (MoSCoW) |
| [04-configuration.md](docs/04-configuration.md) | **The heart:** config philosophy + full annotated JSON example |
| [05-maplibre-capabilities.md](docs/05-maplibre-capabilities.md) | MapLibre v6 capability map, build-vs-reuse matrix per feature |
| [06-architecture.md](docs/06-architecture.md) | Technical architecture (packaging, layering, repo layout) |
| [07-roadmap.md](docs/07-roadmap.md) | Milestones M0 (spike) → M3 (ecosystem) |
| [08-decisions.md](docs/08-decisions.md) | Decision log: the five key decisions + secondary open items |

Reading order for newcomers: 01 → 04 → 03. For the "why not X?" discussion: 02.

## Key research findings (2026-08-14)

- **The gap is real:** no established project combines MapLibre + single-JSON config + iframe-free
  embedding + SDI features. Closest neighbors each hold one corner (MapComponents, Origo,
  EOxElements, TerriaJS). Details in [02-landscape.md](docs/02-landscape.md).
- **MapLibre v6** (2026-07): ESM-only, WebGL2 required; globe + terrain + built-in controls since v5.
  Rendering remains Web-Mercator-only — services must serve 3857/WebMercatorQuad.
- **Ecosystem is ready:** watergis export/legend/terradraw, Terra Draw, pmtiles,
  @camptocamp/ogc-client cover the hard plumbing; the assembled client is what's missing.

## Reference material

- Masterportal checkout for comparison: `C:\P\masterportal` (v3.25.0) — analyzed in
  [02-landscape.md](docs/02-landscape.md) §Deep dive.

## Conventions

- All project documentation in **English**.
- Config examples target live Austrian SDI services (basemap.at) where possible; placeholder
  `*.example.gv.at` URLs mark illustrative endpoints.
