# 02 — Landscape & Prior Art

> Status: researched 2026-08-14 (live verification via GitHub/npm/project docs + local Masterportal
> checkout at `C:\P\masterportal`, v3.25.0).

## TL;DR

**No established project today combines MapLibre GL JS + single-JSON-document configuration +
iframe-free embedding (script tag / web component) + SDI-grade client features** (TOC, legends, OGC
services, metadata links). Established SDI clients are all OpenLayers- or Cesium-based; the
MapLibre-native world has component libraries, widgets and hosted platforms, but no portal-grade
configurable, embeddable client. **The gap map0 targets is real.**

## Comparison

| Project | Engine | Config | Embedding | License | Activity | MapLibre + JSON + embeddable + modern? |
|---|---|---|---|---|---|---|
| [Masterportal](https://www.masterportal.org) | OpenLayers (+Cesium) | JSON files ×5 (registry indirection) | instance + **iframe**/postMessage | MIT | v3.25.0, 08/2026 | ✗ engine, ✗ embedding |
| [MapStore](https://github.com/geosolutions-it/MapStore2) | OL + Leaflet (+Cesium) | JSON + admin backend (Java) | iframe, heavyweight JS API | BSD-2 | 2026.02, 07/2026 | ✗ full portal, ✗ engine |
| [MapComponents](https://github.com/mapcomponents/react-map-components-maplibre) (WhereGroup) | **MapLibre** | React/JSX code — no JSON doc | React npm lib only | MIT | 1.8.20, 06/2026 | **half** — right engine & features, wrong config/embedding model |
| [Wegue](https://github.com/wegue-oss/wegue) | OL 10 | **one app-conf.json** ✓ | standalone app | BSD-2 | v2.1 2024; Vue3 master active | ✗ engine, small community |
| [Origo](https://github.com/origo-map/origo) (SE) | OL 10 | **`Origo('index.json')`** ✓ | **script tag + div** ✓ | BSD-2 | v2.10, active 08/2026 | **half** — right config+embed pattern, OL engine, dated UI |
| [QWC2](https://github.com/qgis/qwc2) | OL 10 | JSON, QGIS-Server-generated | standalone | BSD-2 | 2026.08 | ✗ QGIS-bound |
| [Mapbender](https://mapbender.org) | OL | admin backend (PHP/DB) | server app, iframe | MIT | 4.2.6, 06/2026 | ✗ architecture class |
| [Oskari](https://www.oskari.org) (FI) | OL 10 (+Cesium) | admin UI + DB | **iframe + RPC** | MIT/EUPL | 3.3.0, 04/2026 | ✗ platform, iframe |
| [TerriaJS](https://github.com/TerriaJS/terriajs) (AU) | Cesium + Leaflet | **JSON init/catalog files** — richest schema in class | standalone app | Apache-2.0 | 8.12.5, 07/2026 | ✗ engine, heavy — but the config-schema reference |
| [VC Map](https://github.com/virtualcitySYSTEMS/map-ui) (DE) | OL + Cesium fork | **JSON "modules"**, runtime-serializable ✓ | standalone/npm | MIT | 6.3.11, 07/2026 | ✗ engine; most modern JSON-config architecture |
| [EOxElements](https://github.com/EOX-A/EOxElements) (AT!) | OL 10 (eox-map) | JSON attrs on **Lit web components** ✓ | **true web components, CDN** ✓ | MIT | map 2.7.2, 08/2026 | **half** — best embedding model, OL engine, EO focus, no portal TOC |
| [geoadmin web-mapviewer](https://github.com/geoadmin/web-mapviewer) (CH) | OL 2D + Cesium 3D (MapLibre only as OL sublayer) | URL params + swisstopo backend | SPA + iframe embed | BSD-3 | active 08/2026 | ✗ national viewer, not reusable |
| [Lizmap](https://github.com/3liz/lizmap-web-client) / [G3W-Suite](https://github.com/g3w-suite/g3w-admin) | OL 10 | QGIS project/plugin + server | standalone, iframe | MPL-2.0 | active | ✗ QGIS publishing systems |
| [Tailormap](https://github.com/Tailormap/tailormap-viewer) (NL) | OL 10 | admin backend (Spring/Postgres) | standalone Angular app | MIT | 12.8.2, 07/2026 | ✗ backend-configured |
| [UNDP GeoHub](https://github.com/UNDP-Data/geohub) | **MapLibre 5** | portal/DB-managed | hosted platform | BSD-3 | active 08/2026 | ✗ platform, not embeddable client |
| [mviewer](https://github.com/mviewer/mviewer) (FR) | OL | **XML** file + studio generator | standalone, iframe | GPL-3 | active | ✗ XML, OL, GPL |
| [MapML.js](https://github.com/Maps4HTML/MapML.js) (W3C) | Leaflet | declarative HTML markup | **custom element** ✓ | W3C | 0.18, active | ✗ minimal features; validates the WC direction |

Early/unverified curiosities found: **maplibre-yaml** (declarative YAML/JSON config layer over
MapLibre incl. web-component embedding — very immature, org/license unverifiable; watch it) and
**@honua/sdk-js** (beta "open GIS SDK for MapLibre": OGC API/WFS/WMS/STAC plumbing; repo not
locatable). Both confirm demand for exactly this abstraction; neither is a usable foundation today.

Commercial UX references (inspiration only): **Felt** (the UX benchmark: layer panel, share/embed
flow), **Atlas.co** (no-code GIS on MapLibre), **con terra map.apps** (app = JSON manifest of
bundles — the commercial DACH-gov analogue of map0's idea), **ArcGIS Experience Builder / Instant
Apps** (template-first "configure, don't code" onboarding).

## Deep dive: lessons from Masterportal (local checkout analysis)

Masterportal v3 is technically modern under the hood (Vue 3.5, Vite, OL 10.9, monthly releases) —
the pain is the **configuration model and distribution**, not the JS stack:

1. **Five config file kinds per portal** (`config.js`, `config.json`, `services.json`,
   `rest-services.json`, `style_v3.json`) with **ID indirection**: one working WFS layer spans up to
   four files; references are unvalidated (typo → layer silently missing); values are duplicated and
   overridable across files.
2. **~18,500 lines of config documentation** (config.json.md alone: 7,460 lines / 1,555 option rows,
   plus a German mirror kept in sync by hooks). 47 options are flagged "expert". The doc set *is* the
   learning curve.
3. **Theming = Sass variable overrides + rebuild** — no runtime theming; README lists theming as an
   open v3 gap.
4. **Deployment is pre-npm**: download zip, unzip into Apache htdocs, copy the Basic folder. Addons
   require cloning a second repo into the tree + 5-file Vuex boilerplate. Three repos are
   version-bumped in lockstep per release.
5. What it gets **right** (to keep): everything-is-config philosophy; central *service registry*
   reusable across portals; CSW/metadata coupling per layer; huge tool inventory proving the demand
   (46 modules; WMS/WMTS/WMSTime/WFS/OAF/GeoJSON/VectorTile/SensorThings/GeoTIFF/3D).

**map0's answers:** one JSON document, services inline (an optional `extends` base config replaces
the registry *without* mandating it), MapLibre style spec instead of a bespoke style language,
runtime CSS-variable theming, npm/CDN distribution, and a deliberately small v1 module set.

## What to borrow from whom

| From | Borrow |
|---|---|
| **TerriaJS** | init-file layering (`extends`), typed catalog items (`type` discriminator per source) |
| **Origo** | one-liner bootstrap (`Origo('index.json')` → our custom element / `createMap`), controls-as-config |
| **VC Map** | runtime-mutable, serializable config modules; clean plugin API contract |
| **Masterportal** | SDI feature checklist; metadata/CSW coupling; config migrator tooling; (optionally) org-wide shared base configs |
| **EOxElements** | Lit web components + JSON attributes + CDN distribution + Storybook-style docs |
| **MapComponents** | reference implementations of MapLibre layer tree / WMS handling / PDF export (candidate dependency or code reference) |
| **Wegue** | minimal flat config ergonomics |
| **Felt / Instant Apps / map.apps** | onboarding UX: sensible defaults, template gallery, "copy embed snippet" flow |

## Strategic conclusions

1. **Build is justified.** Nobody occupies "MapLibre-native + one JSON doc + CMS-native embedding".
   The nearest neighbors each hold one corner: MapComponents (engine+features), Origo (config+embed
   pattern), EOxElements (embedding tech), TerriaJS/VC Map (config schema).
2. **Globe is a differentiator**: native in MapLibre since v5 — every OL-based incumbent needs a
   Cesium bolt-on for this.
3. **Known weak spots to plan for**: OGC plumbing on MapLibre (WMTS resolution, GetFeatureInfo, WFS —
   see [05-maplibre-capabilities.md](05-maplibre-capabilities.md)) and the TOC/group/scale-range/legend
   **layer model on top of MapLibre's flat style model — that layer model is precisely map0's core value.**
4. **Ecosystem timing is good**: watergis export/legend/terradraw plugins matured 2025-26, Terra Draw
   became the drawing standard, ogc-client covers capabilities parsing, and MapLibre v6 cleaned up
   distribution (ESM, WebGL2). The building blocks are ready; the assembled product is missing.
5. FOSSGIS 2026 program check: no competing MapLibre client framework announced in the DACH community.

## Engine choice: MapLibre vs OpenLayers vs deck.gl

> Added 2026-08-14 after the project owner asked: *is MapLibre a sound foundation when practically
> every established SDI client uses OpenLayers — and what about deck.gl?*

### Why the incumbents are all on OpenLayers

Cohort effect, not a fresh evaluation: Masterportal, MapStore, Oskari, Origo, Mapbender et al. were
architected 2010–2016 — years before MapLibre existed (Mapbox GL JS fork, Dec 2020). OpenLayers was
the only serious OGC-grade option then, and INSPIRE-era requirements (national CRS, GML, WFS)
matched its strengths, so the choice was right *for them, then* — and engines are almost never
swapped later. Meanwhile the post-2020 generation of mapping products (Felt, Atlas.co, kepler.gl,
UNDP GeoHub, effectively every mainstream mapping SaaS) builds on GL engines. The SDI client world
lags the web-mapping mainstream by roughly five years; that lag is precisely map0's opening.

### Honest scorecard

| Criterion | OpenLayers 10 | MapLibre GL v6 |
|---|---|---|
| Arbitrary/national CRS rendering | ✔ native | ✗ Mercator + globe only (on roadmap, unimplemented) |
| OGC plumbing built in (WMS/WMTS/WFS/GML) | ✔ | partial — raster templates fine; GFI/WMTS/WFS need own code (bounded, see [05](05-maplibre-capabilities.md)) |
| Feature editing / WFS-T | ✔ mature | weak (Terra Draw covers drawing, not transactional editing) |
| Runs without WebGL | ✔ canvas 2D | ✗ WebGL2 required |
| Scale-true client print | ✔ simpler (sync canvas; e.g. camptocamp inkmap) | hidden-clone re-render, "export what you see" |
| Vector tiles + style-spec cartography | bolt-on (`ol-mapbox-style`), fidelity/perf lag | ✔ native reference implementation |
| Globe | ✗ (requires Cesium bolt-on) | ✔ built-in since v5 |
| Terrain / hillshade / sky (GPU) | limited | ✔ core |
| Rendering feel: 60 fps pan/rotate/tilt, fractional zoom, collision-managed labels — esp. mobile | good | ✔ excellent — the "modern map" feel |
| Declarative JSON styling language | flat-style syntax exists, little ecosystem | ✔ style spec + tooling (Maputnik; basemap.at ships official MapLibre styles) |
| Fit with map0's config-first philosophy | styling = code | ✔ styling = JSON — same paradigm as the map0 config itself |
| Web-dev familiarity / hiring pool | GIS niche | ✔ mainstream |

### The call for map0

map0's stated differentiators (hübsch/modern/responsive, globe, vector-tile-first, everything-JSON)
are exactly MapLibre's column. Built on OpenLayers, map0 would be *another OL client* competing
head-on with Masterportal/Origo/QWC2 with less maturity — on MapLibre it occupies the empty niche
this research establishes. The costs are known and accepted:

- **OGC plumbing is own code** — quantified and bounded in [05-maplibre-capabilities.md](05-maplibre-capabilities.md); `@camptocamp/ogc-client` carries the parsing.
- **Mercator-only** — accepted as a product constraint (D-02 final): services that cannot serve
  EPSG:3857/WebMercatorQuad are out of scope; the add-layer dialog checks and communicates this.

Reconsider OpenLayers only if one of these ever becomes a hard requirement: native national-CRS
rendering · WFS-T editing · survey-grade scale-true client printing · non-WebGL2 device support.
Per the project owner (2026-08-14): none applies.

### deck.gl — complement, not alternative

deck.gl is a GPU **data-visualization layer framework**, not a map-client foundation: it brings no
basemap cartography, no label placement/collision engine, no style spec, and no OGC service
handling. Idiomatic use is deck.gl **on top of** MapLibre via `@deck.gl/mapbox`'s `MapboxOverlay`
(overlaid or interleaved) — the two are designed to compose, and kepler.gl/Felt-class products use
exactly this pairing. deck.gl excels at massive point sets (GPU instancing), aggregations
(hex/grid/heatmap), animated arcs/trips, and 3D extrusions.

**map0 stance:** not the base engine; keep the adapter registry open for an optional `deck` layer
type as an M3 candidate for big-data layers (100k+ features, animated flows). Building the whole
client on deck.gl alone would mean re-inventing the cartographic half of the stack.

(CesiumJS becomes relevant only if true 3D city models / 3D Tiles ever become a core goal — a
different product class, explicitly a non-goal in [01-vision.md](01-vision.md).)
