# map0

> Embeddable, JSON-configurable web map client built on
> [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
> One script tag plus one JSON config = a full-featured map on any web page.

map0 adds a configurable interface to MapLibre: basemaps, a layer tree, legends, feature popups,
search, measuring, print and globe view. Settings, colours and languages are defined in one JSON
document, stored as a file or in a CMS field. A web component displays the map inside your page.

> **Early preview, version 0.4.1.** Try the client in the
> [live demos](https://map0.net/demos). The JavaScript API and config format may change without
> a deprecation path until 1.0. Pin an exact version.
>
> The package is called **map0-viewer**: npm's name-similarity rule for short names rejects the
> unscoped `map0`. The project, the element `<map0-viewer>` and the site
> [map0.net](https://map0.net) keep the name map0.

## Install

```bash
npm install map0-viewer
```

The package is a prebuilt ES-module bundle with MapLibre included. Its `@types/geojson` dependency
contains TypeScript declarations only. Copy
`node_modules/map0-viewer/dist/` next to your page and load `map0.js` from there.

### …or load it from a CDN

Point a script tag at a specific release:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/map0-viewer@0.4.1/dist/map0.js"></script>
```

unpkg serves the same tarball, if you prefer it:
`https://unpkg.com/map0-viewer@0.4.1/dist/map0.js`.

The entry resolves its modules and MapLibre's worker relative to itself, including on a CDN.
Pin the **exact** version so that future releases do not automatically change the package used
by your page.

## Use it

A version and one basemap are enough; everything else is a default you can override:

```html
<script type="module" src="/map0/map0.js"></script>

<map0-viewer style="height: 520px">
  <script type="application/json">
    {
      "version": 1,
      "basemaps": [
        {
          "type": "style",
          "url": "https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json"
        }
      ]
    }
  </script>
</map0-viewer>
```

That gives you zoom, compass, fullscreen, geolocation, globe, scale bar, attribution, coordinate
readout, print and a light/dark theme that follows the operating system.

To edit the map configuration separately from the page, store it in a JSON file:

```html
<map0-viewer config-src="/configs/environment-map.json" style="height: 520px"></map0-viewer>
```

Use `loading="eager"` to start immediately; the default, `"lazy"`, waits until the map approaches
the viewport. The `theme="dark"` and `theme="light"` attributes override the config's `theme.mode`
and update a running map when changed. The element also accepts a config object through its
`config` property and exposes an API and DOM events:

```js
const viewer = document.querySelector("map0-viewer");

viewer.addEventListener("map0:ready", () => {
  viewer.api.setLayerVisibility("zoning", false);
  viewer.api.zoomToLayer("districts");
});

viewer.addEventListener("map0:error", (event) => console.warn(event.detail));
```

From a module, importing the package registers `<map0-viewer>`; `createMap` is the imperative
bootstrap for SPAs and framework wrappers:

```js
import { createMap } from "map0-viewer";

const viewer = createMap(document.querySelector("#map"), config);
```

### Filters and tiles for host pages

A page that drives the map from its own state, for example to outline the features a user picked,
filters a layer by its map0 id rather than by the MapLibre layer ids map0 generates. Give the style
layer an `id` in the config and address it:

```js
// config: "style": [{ "type": "fill", … }, { "type": "line", "id": "selected", "filter": false, … }]
viewer.api.layers.setFilter("parcels", ["in", ["get", "number"], ["literal", [17, 23]]], {
  styleLayer: "selected",
  replace: true, // replaces the config's filter instead of ["all", <config filter>, <this one>]
});
viewer.api.layers.setFilter("parcels", null, { styleLayer: "selected" }); // the config's filter again
```

Without `styleLayer` the filter goes on every style layer of the layer. `setFilter` returns `false`
when the layer has nothing to filter, `styleLayer` matches none of its style layers, or MapLibre
rejects the filter.

`api.layers.getTile` reads one tile of a `vector` layer, decoded to GeoJSON, for example to read
attributes from a finer zoom level than the map currently shows:

```js
viewer.api.map.on("click", async (event) => {
  const tile = await viewer.api.layers.getTile("parcels", {
    zoom: 14,               // capped at the source's maxzoom
    lngLat: event.lngLat,   // the tile that contains this position
    sourceLayer: "parcels", // default: every source layer of the tile
    geometry: false,        // properties only; default true (coordinates in WGS84)
  });
  const parcel = tile?.features.find((f) => f.properties.number === 17);
});
```

A PMTiles archive is read through the instance the map already opened, so its header and
directories are not fetched again. Tile templates and TileJSON sources are fetched; a tile the
map has drawn usually comes from the HTTP cache.

### TypeScript

Both entries include TypeScript declarations:

```ts
import { defineMap0Viewer, type Map0Api, type Map0Config } from "map0-viewer";

const config: Map0Config = { version: 1, basemaps: [{ type: "empty" }] };
defineMap0Viewer();

const viewer = document.querySelector("map0-viewer")!; // a Map0Viewer, via HTMLElementTagNameMap
viewer.config = config;
viewer.addEventListener("map0:ready", (event) => {
  const api: Map0Api = event.detail.api;
  console.log(api.map.getZoom());
});
```

`Map0Config` describes the configuration. `Map0Viewer` describes the element's properties, API and
DOM events. `Map0Api` describes the API available through `viewer.api` and `map0:ready`.

- `Map0Layers` describes `api.layers`: layer state, handles, add/remove, visibility, opacity, zoom,
  filters (`setFilter`) and single vector tiles (`getTile`).
- `LayerHandle` exposes a layer's definition, status, MapLibre IDs and `bounds()`.
- `Map0Basemaps` describes `api.basemaps`: `current`, `all` and `switchTo`.
- `Map0Events` describes subscriptions through `api.events.on`.

Members outside these interfaces are internal. GeoJSON declarations are installed automatically
through `@types/geojson`. To type `api.map`, install the optional peer `maplibre-gl` (6.x).
Only its declarations are used; the bundle runs its included copy. Without the peer, `api.map`
is `any` when `skipLibCheck` is enabled. With `skipLibCheck` disabled, TypeScript reports the
missing package.

### Server-side rendering

Defining a custom element needs `HTMLElement`, so the browser entry cannot be evaluated in Node.
The package therefore resolves to an **SSR-safe entry** under the `node` condition, also reachable
as `map0-viewer/ssr`. It exports the config schema, `validateConfig` and `normalizeConfig`, and
loads the viewer on request in a browser.

```js
import { defineMap0Viewer, validateConfig } from "map0-viewer/ssr";

// runs anywhere: false on the server, true once the element is registered
await defineMap0Viewer();
```

Frameworks that render on the server (Next.js, Nuxt, Astro, SvelteKit) can import this at the top
level of a component; the map itself still comes up on the client, from the same `<map0-viewer>` tag.

### Deploying it

Deploy the complete `dist/` folder:

```bash
cp -r node_modules/map0-viewer/dist ./public/map0   # then load /map0/map0.js
```

`map0.js` loads additional modules as needed. `maplibre-gl.mjs` and `maplibre-gl-worker.mjs` must
stay next to it, since MapLibre starts its worker from that file (`maplibre-gl-shared.mjs` is an
empty compatibility file since MapLibre 6.13). Missing files can prevent vector tiles and GeoJSON
from appearing. Use `type="module"` on script tags to load the ES-module package.

### Importing it through a bundler

An app built with Vite or Nuxt can import the package like any other dependency, without copying
`dist/` (e.g. `await import("map0-viewer")` in a client-only component). map0 tells MapLibre where
its worker is with `new URL("./maplibre-gl-worker.mjs", import.meta.url)`, a pattern bundlers
follow: the build emits the worker as an asset, and the dev server serves it. CI checks this with
Vite 8, both `vite build` and the dev server; Nuxt 4.6 runs on Vite 8. With Vite 7 the build
works but its dev server does not start the worker, so vector tiles and GeoJSON stay empty
there. webpack 5 follows the same pattern; that combination is not tested.

## What is in the config

Layer sources: WMS, WMTS, WFS (paged GetFeature), OGC API Features (next-link paging), XYZ/raster,
vector tiles, PMTiles, GeoJSON (with clustering), GeoParquet (decoded in the browser, styled like
GeoJSON; both support reprojection on load through `crs`), and COG
(Cloud Optimized GeoTIFF) as RGB imagery, single-band color ramps, explicit value/range classes, or
DEM hillshade. Plus a
layer tree with groups that switch as a whole, radio groups and a filter box, legends (`"auto"` derives them from the service), feature info with HTML
templates, hover, search, measuring, coordinate readout in projected CRS, print/PDF export,
layers added by users (WMS and WMTS from their capabilities, GeoJSON by URL, GeoJSON/KML/GPX files
dropped onto the map), permalinks, `extends` for shared base configs, CSS-variable theming, and per-language label
overrides. See
[docs/04-configuration.md](https://github.com/SpatialFocus/map0/blob/main/docs/04-configuration.md)
for the annotated guide, and
[docs/config-reference.md](https://github.com/SpatialFocus/map0/blob/main/docs/config-reference.md)
for the key-by-key reference generated from the schema.

### Autocomplete and validation

The config format has a published JSON Schema. Point the `$schema` key at it and any modern editor
(VS Code, JetBrains, Monaco in a CMS) offers autocomplete, documentation on hover and typo
squiggles while you write a config:

```json
{
  "$schema": "https://map0.net/schema/v1.json",
  "version": 1,
  "basemaps": []
}
```

`https://map0.net/schema/v1.json` follows the latest release. The npm tarball carries the same file
as `schema/v1.json`, so a version-pinned copy is on the CDN too:
`https://cdn.jsdelivr.net/npm/map0-viewer@0.4.1/schema/v1.json`.

To check a config without installing anything, paste it into the
[online validator](https://map0.net/demos/validate.html), which runs `validateConfig` in the
page. To validate configs in a build pipeline or CMS save hook:

```bash
npx ajv-cli validate -s node_modules/map0-viewer/schema/v1.json -d my-map.map0.json
```

The schema checks keys, types, ranges and required fields. At runtime, map0 also checks URL rules,
unique IDs and relationships between fields. Errors appear in the viewer with their JSON paths.
Before 1.0, schema keys may change between releases.

## Weight

A page loads ~34 KB gzip for the element itself. The engine, MapLibre and its stylesheet (~465 KB
gzip) load when a map initialises. Capabilities
parsing, proj4, PMTiles, the COG and GeoParquet decoders, measuring and the dialogs load on first
use.

## Links

- **Website and live demos:** https://map0.net · https://map0.net/demos
- **Repository and specification:** https://github.com/SpatialFocus/map0
- **Status and roadmap:**
  [docs/07-roadmap.md](https://github.com/SpatialFocus/map0/blob/main/docs/07-roadmap.md)
- **Issues:** https://github.com/SpatialFocus/map0/issues

## Licence

MIT; see [LICENSE](./LICENSE). The bundle contains third-party code (MapLibre GL JS copied in
verbatim, others compiled in); their licences and copyright notices are reproduced in full in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
