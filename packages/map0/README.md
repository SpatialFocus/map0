# map0

> Embeddable, JSON-configurable web map client built on
> [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
> One script tag plus one JSON config = a full-featured map on any web page.

MapLibre made cartography declarative — the style spec is JSON. map0 extends the same idea to the
*map client*: basemaps, layer tree, legends, feature popups, search, measuring, print, globe,
theming and languages are all declared in a single JSON document that can live in a CMS field. It
renders straight into the page as a web component — no iframe, no backend, no build step required.

> **Early preview — version 0.1.0.** The client works against real OGC services — it is what the
> [live demos](https://map0.net/demos) run on — but the JavaScript API and the config format are
> still drafts and will change without a deprecation path until 1.0. Pin an exact version.
> TypeScript types are not published yet.
>
> The package is called **map0-viewer**: npm's name-similarity rule for short names rejects the
> unscoped `map0`. The project, the element `<map0-viewer>` and the site
> [map0.net](https://map0.net) keep the name map0.

## Install

```bash
npm install map0-viewer
```

The package is a prebuilt ES-module bundle. MapLibre is included — there are no dependencies to
install and nothing to configure. Copy `node_modules/map0-viewer/dist/` next to your page and load
`map0.js` from there.

### …or load it from a CDN

Nothing to install or copy — point a script tag at a pinned version:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/map0-viewer@0.1.0/dist/map0.js"></script>
```

unpkg serves the same tarball, if you prefer it:
`https://unpkg.com/map0-viewer@0.1.0/dist/map0.js`.

Both send `Access-Control-Allow-Origin: *`, and the entry resolves its lazy chunks and MapLibre's
worker relative to itself — so the folder stays a unit on the CDN too, with no configuration on your
side. Pin the **exact** version: this is a v0, and `@latest` would swap the bundle under your page on
every release.

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

Configs usually live in their own file instead — the point of the format is that an editor can
change the map without touching the page:

```html
<map0-viewer config-src="/configs/environment-map.json" style="height: 520px"></map0-viewer>
```

The element also takes `loading="eager"` (the default `"lazy"` initialises the map when it comes
near the viewport), accepts a config object via its `config` property, and talks to the page
without imports:

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

### Server-side rendering

Defining a custom element needs `HTMLElement`, so the browser entry cannot be evaluated in Node.
The package therefore resolves to an **SSR-safe entry** under the `node` condition, also reachable
as `map0-viewer/ssr`: it pulls in no DOM code, carries the config schema (`validateConfig`,
`normalizeConfig` — useful while rendering), and loads the viewer only when asked to, in a browser.

```js
import { defineMap0Viewer, validateConfig } from "map0-viewer/ssr";

// runs anywhere: false on the server, true once the element is registered
await defineMap0Viewer();
```

Frameworks that render on the server (Next.js, Nuxt, Astro, SvelteKit) can import this at the top
level of a component; the map itself still comes up on the client, from the same `<map0-viewer>` tag.

### Deploying it

`dist/` is a folder, not a single file, and it has to stay one:

```bash
cp -r node_modules/map0-viewer/dist ./public/map0   # then load /map0/map0.js
```

`map0.js` lazy-loads its own chunks, and MapLibre builds its worker URL at **runtime** relative to
the bundle — so `maplibre-gl.mjs`, `maplibre-gl-shared.mjs` and `maplibre-gl-worker.mjs` must sit
next to it. Getting this wrong fails silently: raster layers still paint, vector tiles and GeoJSON
never appear. Copying the folder as a unit is the supported route. Bundling map0 into your own
build works, but you are then responsible for emitting those three files next to your chunks.

`<script>` tags need `type="module"` — MapLibre v6 has no UMD build, so a copied snippet without it
silently does nothing.

## What is in the config

Layer sources: WMS, WMTS, XYZ/raster, vector tiles, PMTiles, GeoJSON (with clustering), and COG —
Cloud Optimized GeoTIFF as RGB imagery, single-band color ramps or DEM hillshade. Plus a
layer tree with groups, legends (`"auto"` derives them from the service), feature info with HTML
templates, hover, search, measuring, coordinate readout in projected CRS, print/PDF export,
permalinks, `extends` for shared base configs, CSS-variable theming, and per-language label
overrides. See
[docs/04-configuration.md](https://github.com/SpatialFocus/map0/blob/main/docs/04-configuration.md)
for the annotated reference.

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
`https://cdn.jsdelivr.net/npm/map0-viewer@0.1.0/schema/v1.json`.

To check a config without installing anything, paste it into the
[online validator](https://map0.net/demos/validate.html) — it runs `validateConfig` right in the
page. To validate configs outside an editor (CI, a CMS save hook):

```bash
npx ajv-cli validate -s node_modules/map0-viewer/schema/v1.json -d my-map.map0.json
```

The schema checks structure: keys, types, ranges, required fields. map0 validates further at
runtime — https-only URLs, id uniqueness, cross-field rules — and renders those errors in place of
the map, with JSON paths. Like everything else before 1.0, the schema is a draft: keys may still
change from release to release.

## Weight

A page pays ~23 KB gzip for the element itself. The engine, MapLibre and its stylesheet (~304 KB
gzip) load when a map actually initialises — never for a map nobody scrolls to. Capabilities
parsing, proj4, PMTiles, the COG decoder, measuring and the dialogs load on first use.

## Links

- **Website and live demos:** https://map0.net · https://map0.net/demos
- **Repository and specification:** https://github.com/SpatialFocus/map0
- **Status and roadmap:**
  [docs/07-roadmap.md](https://github.com/SpatialFocus/map0/blob/main/docs/07-roadmap.md)
- **Issues:** https://github.com/SpatialFocus/map0/issues

## Licence

MIT — see [LICENSE](./LICENSE). The bundle contains third-party code (MapLibre GL JS copied in
verbatim, others compiled in); their licences and copyright notices are reproduced in full in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
