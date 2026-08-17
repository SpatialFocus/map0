# map0

> Embeddable, JSON-configurable web map client built on
> [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
> One script tag plus one JSON config = a full-featured map on any web page.

MapLibre made cartography declarative — the style spec is JSON. map0 extends the same idea to the
*map client*: basemaps, layer tree, legends, feature popups, search, measuring, print, globe,
theming and languages are all declared in a single JSON document that can live in a CMS field. It
renders straight into the page as a web component — no iframe, no backend, no build step required.

> **Early preview — version 0.0.1.** The client works against real OGC services — it is what the
> [live demos](https://map0.net/demos) run on — but the JavaScript API and the config schema are
> still v0 and will change without a deprecation path until 1.0. Pin an exact version.
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
install and nothing to configure.

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

Layer sources: WMS, WMTS, XYZ/raster, vector tiles, PMTiles, GeoJSON (with clustering). Plus a
layer tree with groups, legends (`"auto"` derives them from the service), feature info with HTML
templates, hover, search, measuring, coordinate readout in projected CRS, print/PDF export,
permalinks, `extends` for shared base configs, CSS-variable theming, and per-language label
overrides. See
[docs/04-configuration.md](https://github.com/SpatialFocus/map0/blob/main/docs/04-configuration.md)
for the annotated reference.

## Weight

A page pays ~23 KB gzip for the element itself. The engine, MapLibre and its stylesheet (~304 KB
gzip) load when a map actually initialises — never for a map nobody scrolls to. Capabilities
parsing, proj4, PMTiles, measuring and the dialogs load on first use.

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
