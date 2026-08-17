# 04 — Configuration Concept

> Status: draft · 2026-08-14 · The config **is** the product. This document defines its philosophy,
> shape, and a full annotated example. The normative JSON Schema will live in `packages/schema`.

## Principles

1. **One JSON document per map.** Everything — basemaps, layer tree, controls, popups, print,
   theming, i18n — in a single file/field. No companion files, no service registry.
2. **Minimal viable config is tiny.** Only `version` + one basemap is required. Everything else has
   documented defaults.
3. **Schema-first.** A published JSON Schema (`$schema` URL) gives CMS editors autocomplete &
   validation in any modern editor; map0 validates at runtime and renders *helpful* errors
   ("`layers[2].url` is missing — a `wms` layer needs a `url`") instead of a blank map.
4. **Declarative first, imperative escape hatch.** Whatever config can do, the JS API can do too
   (and more), but config never requires code.
5. **Forward compatible.** `version` field; unknown keys warn (console), never crash. Migrations
   documented per major.
6. **No secrets in config.** Configs live in public HTML/CMS fields. Auth for protected services is
   provided at runtime via the JS API (headers/token callback), never as config values.

## Embedding

```html
<!-- 1. once per page -->
<script type="module" src="https://cdn.example.com/map0/map0.js"></script>

<!-- 2a. config by URL -->
<map0-viewer config-src="/configs/city-env.map0.json" style="height:520px"></map0-viewer>

<!-- 2b. config inline (CMS-friendly: one blob pasted into the page) -->
<map0-viewer style="height:520px">
  <script type="application/json">
    { "version": 1, "basemaps": [ ... ], "layers": [ ... ] }
  </script>
</map0-viewer>
```

```js
// 2c. programmatic (SPAs, wrappers)
import { createMap } from "map0";
const app = createMap(document.querySelector("#map"), config);
app.on("featureclick", (e) => ...);
app.setLayerVisibility("noise-2024", false);
```

**`loading` is an attribute, not a config key.** The element waits until it is near the viewport
before fetching anything — including the config — so the switch that controls that cannot live
inside the config it would gate. It mirrors `<img loading>`:

```html
<map0-viewer config-src="…"></map0-viewer>                  <!-- lazy (default) -->
<map0-viewer config-src="…" loading="eager"></map0-viewer>  <!-- above the fold -->
```

*(Element/API names indicative; final naming in [06-architecture.md](06-architecture.md), pending D-01.)*

## Top-level shape

| Key | Purpose | Required |
|---|---|---|
| `$schema` | editor tooling | no |
| `version` | config schema major version (`1`) | **yes** |
| `extends` | URL of a base config to inherit (org-wide basemaps/theme); local keys win, arrays replace | no |
| `meta` | title/description of the map (used in print header, aria-label) | no |
| `map` | initial view & constraints | no |
| `basemaps[]` | exclusive background layers | **yes** (≥1) |
| `layers[]` | overlay tree (groups + layers); **top of the list = top of the map**, and runtime-added layers go above all of them | no |
| `controls` | which UI elements exist, where | no |
| `print` | what the print dialog offers: formats, paper sizes, resolutions, sheet elements | no |
| `search` | geocoder config | no |
| `print` | print/export layout options | no |
| `theme` | design tokens, light/dark | no |
| `i18n` | locale, string overrides (`overrides: { "<locale>": { "<key>": "<text>" } }`) | no |
| `permalink` | shareable state in the URL hash (F10.1): view, basemap, layer states, user-added layers; `true` or `{ "param": "map0" }` — opt-in, coexists with host hash routing. Two viewers on one page need **different** `param` values; a second viewer claiming the same one falls back to `map0-2` and says so in the console | no |

## Full annotated example

```jsonc
{
  "$schema": "https://map0.example.org/schema/v1.json",
  "version": 1,

  "meta": {
    "title": "Umweltkarte Musterstadt",
    "description": "Lärm, Luftgüte und Schutzgebiete der Stadt."
  },

  "map": {
    "center": [16.3725, 48.2083],          // lon, lat (WGS84)
    "zoom": 11,                            // alternatively: "bounds": [w, s, e, n]
    "minZoom": 6,
    "maxZoom": 20,
    "maxBounds": [9.4, 46.3, 17.3, 49.1],  // optional pan constraint (Austria)
    "projection": "mercator",              // "mercator" | "globe" (initial; toggle via control)
    "hash": false                          // opt-in URL-hash view sync
  },

  "basemaps": [
    {
      "id": "bmapv",
      "title": "basemap.at Standard",
      "type": "style",                     // MapLibre style JSON = vector basemap
      "url": "https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json",
      "thumbnail": "auto",                 // "auto" renders a mini preview, or an image URL
      "default": true
    },
    {
      "id": "ortho",
      "title": "Orthofoto",
      "type": "raster",                    // XYZ / WMTS-REST template
      "url": "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
      "tileSize": 256,
      "maxZoom": 19,
      "attribution": "© basemap.at"
    },
    { "id": "none", "title": "Kein Hintergrund", "type": "empty" }
  ],

  "layers": [
    {
      "type": "group",
      "title": "Umwelt",
      "collapsed": false,
      "children": [
        {
          "id": "noise-2024",
          "type": "wms",
          "title": "Lärmkarte 2024",
          "url": "https://sdi.example.gv.at/ows",
          "layers": "laerm_strasse_2024",   // comma-separated WMS LAYERS
          "format": "image/png",
          "opacity": 0.7,
          "visible": true,
          "minZoom": 9,
          "legend": "auto",                 // "auto" = GetLegendGraphic (WMS) / style-derived swatches
                                            // (vector) | false | image URL |
                                            // [{ "label", "color"?, "shape"?: square|line|circle, "image"? }]
          "info": {                         // enables GetFeatureInfo on click
            "format": "application/json",
            "title": "Lärm {{db_class}} dB",
            "fields": [
              { "key": "db_class", "label": "Pegelklasse" },
              { "key": "quelle",   "label": "Quelle" }
            ]
          },
          "metadata": {
            "url": "https://catalog.example.gv.at/geonetwork/srv/ger/catalog.search#/metadata/abc-123",
            "title": "Datensatzbeschreibung im Katalog"
          },
          "bounds": [16.18, 48.12, 16.55, 48.32],  // optional; enables "zoom to layer" (F2.2);
                                                   // auto-filled from capabilities for dialog-added layers
          "attribution": "© Stadt Musterstadt"
        },
        {
          "id": "trees",
          "type": "geojson",
          "title": "Stadtbäume",
          "data": "https://data.example.gv.at/trees.geojson",   // URL or inline FeatureCollection
          "cluster": { "enabled": true, "maxZoom": 15 },
          "style": {                        // simplified style; full MapLibre layers[] also allowed
            "circle-color": "#2e7d32",
            "circle-radius": 5,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff"
          },
          "popup": {
            "title": "{{baumart_de}}",
            "content": "<b>Pflanzjahr:</b> {{pflanzjahr}}<br><b>Höhe:</b> {{hoehe_m}} m"
          },                                // templates are sanitized before rendering
          "hover": { "content": "{{baumart_de}}" }
        },
        {
          "id": "zoning",
          "type": "vector",                 // vector tiles overlay
          "title": "Flächenwidmung",
          "url": "pmtiles://https://tiles.example.gv.at/widmung.pmtiles",
          "sourceLayer": "widmung",
          "style": [                        // MapLibre style-spec layers; source/source-layer injected
            { "type": "fill", "paint": { "fill-color": ["get", "farbe"], "fill-opacity": 0.45 } },
            { "type": "line", "paint": { "line-color": "#555", "line-width": 0.5 } }
          ],
          "popup": { "title": "{{widmung_text}}" },
          "visible": false
        }
      ]
    },
    {
      "id": "districts",
      "type": "ogcapi-features",            // also: "wfs" with typeNames/version
      "title": "Bezirksgrenzen",
      "url": "https://api.example.gv.at/ogc/collections/bezirke",
      "style": { "line-color": "#333333", "line-width": 1.2, "line-dasharray": [2, 2] },
      "visible": true,
      "queryable": false
    }
  ],

  "controls": {
    "navigation": true,                     // zoom + compass
    "scale": true,
    "fullscreen": true,
    "geolocate": { "follow": false },
    "globe": true,
    "home": true,
    "layerSwitcher": {
      "position": "top-right",
      "open": "auto",                       // open on desktop, collapsed on mobile
      "allowAdd": true                      // false disables the add-layer dialog (F3.1)
    },
    "legend": { "position": "bottom-right", "open": false },
    "print": true,                          // print & export dialog (F7): PNG download + print view
    "measure": true,                        // distance & area, measured on the sphere (F9.1)
    "coordinates": true,                    // right-click/long-press readout (F5.6); default:
                                            // WGS 84 + Austrian GK strip + UTM zone (auto-selected);
                                            // or { "crs": [{ "code", "label"?, "def"? (proj4) }] }
    "attribution": { "compact": "auto" }
  },

  "search": {
    "provider": "photon",                   // "photon" | "nominatim" | { url, format, labelField }
    "url": "https://photon.example.org/api",// self-hosted instance (optional)
    "country": "AT",                        // restrict results
    "bias": true,                           // prefer hits near the current view
    "limit": 8,
    "minLength": 3,
    "coordinates": true,                    // accept "48.2083, 16.3725" (latitude first)
    "placeholder": "Adresse oder Ort suchen…"
  },

  "print": {                                // what the dialog offers; all keys optional
    "formats": ["png", "pdf"],              // download buttons (browser print is always there)
    "sizes": ["current", "A4-landscape", "A4-portrait", "A3-landscape", "A3-portrait"],
    "dpi": [96, 150, 300],
    "elements": ["title", "legend", "scalebar", "attribution", "date"]  // parts of the sheet
  },

  "theme": {
    "mode": "auto",                         // "light" | "dark" | "auto"
    "primary": "#0e7490",
    "radius": "md",                         // none | sm | md | lg
    "font": "system-ui",
    "density": "comfortable"                // "comfortable" | "compact"
  },

  "i18n": {
    "locale": "auto",                       // auto-detect, fallback chain
    "fallback": "en",
    "overrides": { "de": { "layerSwitcher.title": "Kartenthemen" } }
  }
}
```

## Minimal config (must work!)

```json
{
  "version": 1,
  "basemaps": [
    { "type": "style", "url": "https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json" }
  ]
}
```

Result: full-quality map with default controls (zoom, attribution, fullscreen), default view
(basemap's center or world), light/dark auto theme. Every demo starts from here.

## Layer type matrix (per decision D-03, 2026-08-14)

| `type` | Source | Notes |
|---|---|---|
| `style` | MapLibre style URL | basemaps only |
| `raster` | XYZ/WMTS-REST template | basemap or overlay |
| `wms` | WMS 1.1.1/1.3.0 GetMap | tiled raster source; `info` enables GetFeatureInfo; `legend:"auto"` → GetLegendGraphic |
| `wmts` | capabilities URL + `layer` (+ optional `matrixSet`/`style`/`format`) | REST & KVP; picks the first WebMercator matrix set (D-02), bounds/legend from capabilities |
| `geojson` | URL or inline | clustering, simplified style or full style layers |
| `vector` | TileJSON / `{z}/{x}/{y}` / `pmtiles://` | needs `sourceLayer` + style layers |
| `wfs` | WFS 2.0 GetFeature → GeoJSON | **v1.x** (deferred per D-03); paging/limits; styled like `geojson` |
| `ogcapi-features` | OGC API Features collection | **v1.x** (deferred per D-03); limit/bbox; styled like `geojson` |
| `group` | — | nesting, collapse, exclusive option |

**Simplified style:** flat paint-property object (`circle-*`, `line-*`, `fill-*`, auto-derived per
geometry). **Full control:** pass a MapLibre `style: [ …layer objects… ]` array instead. Both are
valid; the simple form covers 80 % of admin needs, the full form keeps experts unblocked.

## Runtime layer management (F3)

The add-layer dialog (TOC "+", `controls.layerSwitcher.allowAdd`) lets users paste a WMS URL;
capabilities are parsed client-side (@camptocamp/ogc-client) and picked layers are added with
GetFeatureInfo, legend, metadata link and a zoom range derived from the service's
Max/MinScaleDenominator. User-added layers live in session state only — they never mutate the page
config — and are removable (✕ in the TOC). The same operations are available programmatically:
`api.addLayer(def)` / `api.removeLayer(id)`.

## Templating & sanitization

- Popup/tooltip templates use `{{property}}` placeholders plus a few helpers
  (`{{#if}}`, number/date formatting — final list TBD; deliberately *not* a full template language).
- All rendered HTML (templates, WMS HTML GetFeatureInfo, service abstracts) is sanitized
  (allow-list: basic formatting, links `rel="noopener"`, images) — configs come from CMS fields and
  services are third parties; XSS hygiene is non-negotiable.

## Versioning policy

- `version` = schema major. map0 v1.x reads config version 1.
- Additive keys → minor releases, old configs untouched.
- Breaking schema change → config version 2 + automated migrator (`map0 migrate config.json`) +
  migration notes. CMS content must survive client upgrades for years — treat configs as data, not code.
