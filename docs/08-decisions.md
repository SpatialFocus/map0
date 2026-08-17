# 08 — Decisions & Open Questions

> Decision log. The five key questions were answered by the project owner on **2026-08-14**.

## D-01 · Packaging & tech basis — **DECIDED: Web component**

map0 ships as a framework-agnostic **custom element** (`<map0-viewer>`, built with Lit) + JSON
config; one `<script type="module">` tag, Shadow DOM style isolation. A headless `core` package
keeps a React/Vue wrapper cheap later (M2), without running the full multi-wrapper program now.
Rationale: works in any CMS without build step; the research (02-landscape) shows this niche is
empty (EOxElements proves the model, but on OpenLayers). Details: [06-architecture.md](06-architecture.md).

Alternatives rejected: React lib (CMS embedding awkward; MapComponents already exists),
vanilla widget (no style isolation), full core+wrappers (extra initial cost).

## D-02 · CRS / projections — **DECIDED (final): EPSG:3857 + globe accepted as product constraint**

Finalized 2026-08-14 (owner follow-up): Mercator-only is treated as an **inclusion criterion, not a
risk** — services that cannot serve EPSG:3857/WebMercatorQuad are simply not included in v1 maps.
No pre-verified target-service list is required (former O-09 closed). MapLibre renders 3857-only;
custom CRS is on the official roadmap but unimplemented (see
[05-maplibre-capabilities.md](05-maplibre-capabilities.md)). The config schema still reserves a
future `crs` extension point. Engine rationale (vs OpenLayers, vs deck.gl):
[02-landscape.md](02-landscape.md) §Engine choice.

### Service compatibility checklist (integrator tool — run when adding a service to a config)

| # | Check | How |
|---|---|---|
| 1 | WMS offers `CRS=EPSG:3857` (or 900913/102100) | GetCapabilities → `<CRS>` list of each needed layer |
| 2 | WMTS offers a WebMercatorQuad / GoogleMapsCompatible tile matrix set | GetCapabilities → TileMatrixSet links |
| 3 | Vector endpoints can deliver WGS84/CRS84 GeoJSON | WFS `srsName=EPSG:4326` / OGC API default CRS |
| 4 | Legends available (`GetLegendGraphic` or style/static) | capabilities / test request |
| 5 | GetFeatureInfo supports `application/json` (else GML/HTML fallback quality) | capabilities `GetFeatureInfo` formats |
| 6 | CORS headers present (client fetches capabilities/GFI directly) | `curl -I -H "Origin: https://example.org"` |
| 7 | Usable without API key, or key can be constrained per referer | service docs |

A service failing #1/#2 is **out of scope by decision** — it does not trigger an engine
re-evaluation. The add-layer dialog performs check #2 automatically and tells the user
(specced in [06-architecture.md](06-architecture.md)).

## D-03 · v1 source types — **DECIDED**

**v1 (Must):** WMS + WMTS incl. GetFeatureInfo & GetLegendGraphic · vector tiles (MVT/TileJSON) ·
style-JSON basemaps · GeoJSON (incl. clustering) · PMTiles.
**v1.x (Should, explicitly deferred):** OGC API Features · WFS. **Later:** COG, SensorThings, time-enabled WMS.

Requirement/priority tables in [03-requirements.md](03-requirements.md) and the layer type matrix in
[04-configuration.md](04-configuration.md) are updated accordingly.

## D-04 · Print scope — **DECIDED: client-side first**

v1: browser print layout + high-res PNG/PDF export (title, legend, scale bar, north arrow,
attribution, date) — fully client-side ("export what you see", not survey-grade scale).
A `PrintProvider` interface reserves the slot for a later scale-true server adapter
(maplibre-native renderer / MapFish) in M2+.

## D-05 · Catalog / metadata integration — **DECIDED: config links + URL import**

v1: dataset-detail links are per-layer URLs in the config (works with any catalog software);
users add services by pasting a URL (capabilities parsing via @camptocamp/ogc-client).
Catalog *search* (CSW / OGC API Records) becomes an optional M2 module.

**Catalog context (resolved 2026-08-14, former O-08):** the SDI runs **GeoNetwork** almost
everywhere. Dataset-detail links follow the GeoNetwork pattern
`…/geonetwork/srv/<lang>/catalog.search#/metadata/<uuid>` (the config example in
[04-configuration.md](04-configuration.md) already shows this shape). The M2 catalog module
therefore targets GeoNetwork first: CSW 2.0.2 and, where available, OGC API Records.

## Secondary open items

| ID | Item | Proposal / status |
|---|---|---|
| O-01 | License | **resolved 2026-08-17: MIT.** Supersedes the Apache-2.0 proposal — the shortest, most familiar licence for an embeddable client wins on adoption, and the engine below us (MapLibre, BSD-3-Clause) sets the same expectation. Accepted trade-off: no explicit patent grant. Root `LICENSE`; the published tarball carries it plus `THIRD-PARTY-NOTICES.md`. |
| O-02 | Product name + npm/domain availability | **resolved 2026-08-16:** the name is **map0** — "map" plus the zero code it takes to get one. npm (2026-08-17): the batteries-included bundle is published as **`map0-viewer`** — the registry rejects the unscoped `map0` under its typosquatting heuristic ("too similar to mcp1, hapi, tap, tape"; normalised, `map0` reads as *mapo*), even though the name is unregistered. Not appealable via the CLI; only npm support can release it, so the short name stays a wish, not a plan. The `map0` **org** is reserved for the later `@map0/*` split. Assembly: `pnpm build:npm`, see [09-engineering-notes.md](09-engineering-notes.md) §release. Domain: **map0.net** (secured 2026-08-17, serves the demo site — O-04). |
| O-03 | Which CMS(s) must be proven first? | **resolved 2026-08-14:** none for now — the reference embed is a **plain static HTML page** ("if it runs there, it runs in any CMS"). Org context: headless CMS (Squidex, Strapi) → map0 embeds into custom frontends built on top; raises the value of the M2 React wrapper. |
| O-04 | Hosting of demo/docs site | **resolved 2026-08-16:** Azure Static Web Apps — `pnpm build:site` → `dist-site/`, uploaded by `.github/workflows/deploy-site.yml`; served at **map0.net** (O-02). Legal pages (imprint, privacy — the demos call third-party services) still to follow. |
| O-05 | Browser floor | evergreen + WebGL2 (MapLibre v6 requirement) — confirm against portal analytics |
| O-06 | Geocoder default | **resolved 2026-08-15:** Photon (OSM, built for type-ahead, CORS-open) as the default, plus a provider interface — `"nominatim"` built in, and any gazetteer via a URL template. Public Photon instances carry fair-use expectations, so production installs self-host it or point at their own service. |
| O-07 | Repository home (GitHub org?) & governance | decide before M0 ends |
| O-08 | Catalog software + dataset-detail URL pattern | **resolved 2026-08-14:** GeoNetwork (see D-05) |
| O-09 | Target service list for the D-02 checklist | **closed 2026-08-14:** moot — 3857 capability is an inclusion criterion, not a precondition (see D-02) |
