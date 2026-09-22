# map0-check

Point it at an OGC service and learn whether [map0](https://map0.net) can show it, why not, and
what the layer definition should look like.

```
npx map0-check "https://data.wien.gv.at/daten/geo?service=WMS&request=GetCapabilities" --layer TRINKBRUNNENOGD
```

```
Service    WMS 1.3.0 — GeoServer Web Map Service
URL        https://data.wien.gv.at/daten/geo
           375 named layers · GetMap png, gif, jpeg, png; mode=8bit
           GetFeatureInfo text/plain, text/html, application/json

Checks
  ✓ https        URL uses https
  ✓ reachable    GetCapabilities 200 in 256 ms (711 kB, text/xml)
  ✓ cors         GetCapabilities: Access-Control-Allow-Origin: *
  ✓ getmap       GetMap offers image/png
  ✓ featureinfo  GetFeatureInfo as application/json — popups get structured attributes
  ✓ schema       the layer definition validates against map0's config schema

Layers  (375 layers, 1 probed live)
  ✓ TRINKBRUNNENOGD  Trinkbrunnen        EPSG:3857 (inherited) · queryable
      ✓ getmap       GetMap z8 in EPSG:3857: 200 in 149 ms (3.0 kB, image/png)
      ✓ cors         GetMap: Access-Control-Allow-Origin: *

Verdict    ✓ ready for map0

map0 layer definitions
[ { "type": "wms", "url": "https://data.wien.gv.at/daten/geo", "layers": "TRINKBRUNNENOGD",
    "title": "Trinkbrunnen", "info": { "format": "application/json" }, "bounds": [16.1837, 48.1225, 16.5455, 48.317] } ]
```

## What it answers

map0 is a zero-backend web map client. Whether a service works in it is decided by the browser, not
by the capabilities document alone: the response must be readable cross-origin, the tiles must come
in Web Mercator, GeoJSON must really be GeoJSON, http is blocked on an https page. Reading a
capabilities XML tells you some of this; only live requests tell you the rest. map0-check does both
and prints the layer definition map0 expects.

It is built from map0's own code. The capabilities reading (`@map0/core`'s `readWmsCapabilities`,
with WMS CRS inheritance applied the way the spec defines it), the request builders (`buildWmsTileUrl`,
`buildGetFeatureUrl`, `buildItemsUrl`), the response parsers and the layer-definition builders are
the ones the viewer and the configurator run, compiled into this CLI. What it sends is what map0
sends; what it prints is what map0's add-layer dialog would add. Every generated definition is run
through `@map0/schema`'s validator before it is printed.

It handles **WMS** (1.1.1, 1.3.0), **WMTS** (1.0.0, REST and KVP), **WFS** (1.1.0, 2.0.0) and
**OGC API Features**. Give it any URL that leads there: an endpoint, a pasted GetCapabilities URL, a
WMTS `WMTSCapabilities.xml`, an OGC API landing page, a collection or even an `/items` URL.

## Checks

| Scope | Code | What is checked |
| --- | --- | --- |
| all | `https` | map0's URL policy: `http` is mixed content on an https page and rejected |
| all | `reachable` | status, time and size of the capabilities / landing document |
| all | `cors` | `Access-Control-Allow-Origin` on the capabilities **and** on every probed request — MapLibre fetches tiles with `fetch()`, so a missing header means an empty map |
| all | `schema` | the printed layer definitions validate against map0's config schema |
| WMS | `getmap`, `featureinfo`, `operation-url` | image formats, GetFeatureInfo formats (JSON preferred, as map0 does), operation URLs that differ from the configured one |
| WMS layer | `crs-3857` | Web Mercator support with CRS inheritance applied additively (see below) |
| WMS layer | `getmap` (probe) | one 256 px tile in EPSG:3857 around the layer's centre, inside its scale range — map0's GetMap request against the config URL |
| WMTS | `matrixsets`, `encoding` | a WebMercator tile matrix set exists (GoogleMapsCompatible, WebMercatorQuad, EPSG:3857/900913 …) |
| WMTS layer | `crs-3857`, `format`, `tile`, `tile-hosts` | matrix set and image format per layer; one real tile, tried against **every advertised ResourceURL host** |
| WFS | `version`, `paging`, `geojson` | 2.0.0 pages with count/startIndex, 1.1.0 gets `"version": "1.1.0"`, 1.0.0 is out; `ImplementsResultPaging` |
| WFS type | `geojson`, `crs`, `size`, `getfeature`, `axis` | GeoJSON output format in the server's spelling (`application/json`, `geojson`, …); feature count via `resultType=hits` against map0's default limit of 10 000; one feature fetched with map0's GetFeature request and parsed by map0's parser; lon/lat axis order verified against the advertised bounds |
| OGC API | `conformance`, `geojson`, `crs`, `filter`, `features` | Part 1 core and GeoJSON classes, Part 2 CRS, CQL2 |
| collection | `itemtype`, `crs`, `items`, `size`, `paging`, `axis` | features not records; `items?f=json&limit=1` parsed by map0's parser; `numberMatched`; a `next` link exists; axis order |

Every layer gets a **verdict** (`✓` ok, `⚠` usable with caveats, `✗` map0 cannot use it) and, when it
was probed, a **snippet**: a layer definition following map0's config reference (`wms`, `wmts`,
`wfs`, `ogcapi-features`), with title, bounds, zoom range, attribution, metadata link and
GetFeatureInfo format filled in from the capabilities. `--config` wraps the snippets into a complete
config with a basemap.at background, ready for the viewer, the configurator or the validator.

### CRS inheritance

WMS lets a parent layer declare CRS once; every child supports those *plus* its own. GeoServer lists
the world on the root layer and only the native CRS plus `CRS:84` on each leaf. A reader that lets a
child's list replace the parent's misses EPSG:3857 on every leaf and calls the whole service
unusable. map0 reads the inheritance (core's `wmsCandidates`); the report says `EPSG:3857 (inherited)`
when that is what saved a layer, because other clients may not.

## Usage

```
map0-check <url> [options]

  -l, --layer <name>    probe this layer / feature type / collection (repeatable)
      --all             list and probe every layer (default: the first 3 plus problems)
      --probe-limit <n> how many layers to probe live without --layer (default 3)
      --config          print a complete map0 config instead of bare layer snippets
      --json            machine-readable report on stdout
      --origin <url>    Origin header for the CORS checks (default https://map0.net)
      --timeout <ms>    per-request timeout (default 15000)
      --no-color        plain text
```

Exit codes: `0` usable · `1` the service, or a probed layer, cannot be used by map0 · `2` no OGC
service found or bad usage. The JSON report carries the same findings, per layer, plus the snippets
and (with `--config`) the config — for CI, for a publisher, for a service registry.

Requests carry `Origin: https://map0.net` (change it with `--origin`) so servers with dynamic CORS
rules answer as they would for an embedded viewer. Nothing is written; the tool only issues GET
requests: the capabilities, one tile or one feature per probed layer, and `resultType=hits` for WFS.

## Limits

One probe tile does not prove a layer renders everywhere, and an empty transparent tile counts as an
answer. Servers behind CDNs may answer CORS differently per path. Vector tile services (`vector`
layers in map0), COG, GeoJSON files and PMTiles are outside this tool's scope.

## Development

Part of the [map0 monorepo](https://github.com/SpatialFocus/map0), `packages/check`. The CLI is one
Node 22 bundle: `pnpm build:check` compiles `src/cli.ts` together with `@map0/core` and `@map0/schema`
into `dist/map0-check.js` (ogc-client stays a dependency); `node packages/check/bin/map0-check.js <url>`
runs it. Unit tests live next to the sources and run with the workspace's `pnpm test`.
