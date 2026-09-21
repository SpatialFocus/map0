# 12 — The configurator

> Status: first version, 2026-09-21. Roadmap item "Visual config editor" (M2); announced on the
> start page as "the map0 configurator".

## What it is

A visual editor for map0 configs: pick services, arrange layers, set up popups, legends,
controls and appearance, watch the real viewer render the result, and copy the JSON into a CMS
field. It lives at <https://map0.net/configurator/> (bilingual like the rest of the site) and is
built as its own web component, `<map0-configurator>`, in `packages/configurator`.

The configurator does not have a data model of its own. It holds exactly one `Map0Config` object;
every form control commits a new one, the preview is a `<map0-viewer>` fed that object, and the
export serialises the same object. There is nothing to keep in sync and nothing the JSON can say
that the forms could not have produced — the raw JSON of every layer and of the whole config is
editable in place for the keys the forms do not offer.

## Personas and scope

- **CMS editor (non-GIS)** — the primary user (01-vision). Starts from the example or a blank
  config, adds layers by pasting a service URL and ticking what the capabilities offer, tweaks
  title, popups and colours, copies the JSON or the embed snippet. Never sees a schema.
- **Integrator** — uses it to bootstrap a config from an organisation's services, then hand-edits
  in the playground (the two link to each other; `?config=` and `?c=` work on both).

Out of scope for the first version: drag-and-drop in the tree (up/down/in/out buttons instead),
editing inline GeoJSON geometry (the raw JSON editor covers it), catalog search (M2 module), and
saving anywhere but the browser (drafts in localStorage; there is no backend, by design).

## How it is built

```
packages/configurator/src
├── configurator.ts    the element: state, preview, validation, drafts, import/export
├── host.ts            the interface the section renderers see of the element
├── section-layers.ts  layer tree, add-from-service, add-from-URL, per-type layer forms
├── section-misc.ts    general (meta, view, permalink), basemaps, controls, search, print, theme
├── fields.ts          form fields as Lit template functions (one shell, one CSS)
├── state.ts           pure config operations: tree edits by index path, cleaning, serialising
├── services.ts        capabilities → layer candidates (WMS, WMTS, WFS, OGC API Features)
├── i18n.ts            UI strings en/de — the help texts are the field documentation
└── styles.ts          host-overridable tokens (--map0c-*), container-query layout
```

Design points:

- **Index paths address tree nodes** (`[2, 0]` = third root node, first child). Groups have no ids
  and layer ids are optional, so positions are the only address that always exists. `state.ts`
  edits with structural sharing and is unit-tested without a DOM.
- **Empty means absent.** Form controls yield empty strings all the time; `setKey` deletes a key
  for a blank value and `cleanConfig` prunes empty objects on output, orders keys as documented and
  puts `$schema` first — so the exported JSON is what a person would have written. Three keys are
  kept even when empty because the empty object carries meaning: `popup`, `info`, `search`.
- **Preview updates are debounced (700 ms) and gated on validity.** The viewer reloads the whole
  map on a new config object; the status line says whether the preview is current, behind, or
  held back by errors. Auto-apply can be switched off for slow services.
- **Capabilities parsing goes through the core's `loadOgcClient`**, so the configurator, the
  viewer's add-layer dialog and the WMTS adapter share one chunk. WFS and OGC API Features are
  parsed here for the first time (feature types → `wfs` layers with a JSON output format when the
  server needs one; collections → `ogcapi-features` layers pointing at the items URL).
- **"Use the preview's view"** reads center, zoom, bearing and pitch from `viewer.api.map` — the
  natural way to set an initial view is to pan the map to it.
- **Drafts** live in localStorage under one key; a linked config (`?config=`, `?c=`) is a starting
  point and the URL is cleaned so a refresh does not overwrite edits with it.
- **The site page is thin**: it mounts the element, passes the pinned CDN URL for the embed
  snippet (read from `packages/map0/package.json`, like the landing page), and keeps the
  element's `theme` in step with the topbar toggle — the chrome script only reaches viewers in the
  light DOM, and the preview sits in the configurator's shadow root.

## What the forms cover

| Section | Keys |
|---|---|
| General | `meta.*`, `map.*` (center/zoom, bounds, min/max zoom, maxBounds, bearing, pitch, projection, cooperativeGestures), `permalink` |
| Basemaps | list with presets (basemap.at vector/raster, OpenFreeMap, OSM, empty) and custom entries; every `basemap` key |
| Layers | tree edits; add from WMS/WMTS/WFS/OGC API capabilities or a data URL (GeoJSON, GeoParquet, COG, vector tiles, XYZ); common keys, type-specific keys, `popup`/`info`/`hover`, simple style or style-spec JSON, `cluster`, `legend` (auto/none/image/entries), raw layer JSON |
| Controls | every `controls.*` key incl. positions, `open`, `allowAdd`, scale unit, coordinate CRS list |
| Search | `search.*` incl. custom geocoder |
| Print | `controls.print`, `print.*` (defaults shown, only deviations written) |
| Appearance | `theme.*`, `i18n.*` (locale, fallback, overrides as `locale.key=value` lines) |
| JSON & export | copy/download JSON, embed snippet, playground link, editable JSON, import from URL/file, reset, draft |

Not in the forms (raw JSON only): `extends`, COG `color.classes` and hillshade options, legend
entry details beyond the JSON textarea, WMS `params` beyond key=value.

## Verification

- `pnpm test` — `state.test.ts`: tree operations, id slugs, cleaning/ordering, embed snippet,
  and that the German dictionary covers every English key.
- `pnpm typecheck` — the package is a project reference like the others.
- In the browser: `/configurator/` and `/de/configurator/` with the dev server — the example
  renders, adding a WMS layer from `https://data.wien.gv.at/daten/geo` works end to end, the
  status line reports validity, the export JSON validates in the playground.

## Open decisions

- **Publishing**: the package is private for now. Publishing `@map0/configurator` (or shipping it
  in `map0-viewer`) would let map0-publisher and CMS admin UIs embed it — decide once the UI has
  settled.
- **Drag-and-drop** in the tree (also open for the viewer's TOC, F2.6) — same mechanism could serve
  both.
- **Style presets** for vector layers (categorised/graduated, like map0-publisher's style cards)
  — the simple style covers uniform symbology only.
- **Catalog search** as a layer source (CSW / OGC API Records) — the M2 catalog module belongs
  here as a third "add" panel.
