# 09 — Engineering Notes

> For people working **on** map0, not with it. Everything here was learned by building the thing:
> the rules that keep the architecture intact, the traps in MapLibre and in real SDI services, and
> how to verify a change. User-facing behaviour belongs in [04-configuration.md](04-configuration.md).

## 1. Working on map0

```bash
pnpm install
pnpm dev                        # demo site on :5173 — /demos is where the work shows up
pnpm typecheck                  # tsc --build across all packages, strict
pnpm test                       # Vitest (pure logic only, no DOM/network)
pnpm build && pnpm size         # library bundle + the size budget
pnpm demo:standalone            # build + copy dist next to the standalone demo page
node e2e/verify-demos.mjs       # every demo page, headless, with screenshots
node e2e/verify-demos.mjs wms   # …or one
```

The loop that catches the most: change something → `pnpm typecheck` → look at it in the browser →
`node e2e/verify-demos.mjs`. Unit tests cover URL building, templates, merging, projections — the
parts that are pure functions. Everything involving MapLibre, the DOM or a live service is verified
in a real browser instead, because that is where it actually breaks.

### Verification is not optional here

Three of the worst bugs in this repo's history looked fine in the dev server and were broken in the
built bundle, or vice versa (§4.3, §4.4). When touching the build, the element lifecycle or a
service adapter, check **both** paths: the dev server (`/demos/*`) and the built bundle
(`/demos/standalone.html` after `pnpm demo:standalone`).

## 2. Invariants

Break one of these and something breaks quietly, usually only in production builds.

1. **The element must not import values from `@map0/core`.** Only `import type` (erased at build
   time) plus value imports from `@map0/schema`. One value import pulls MapLibre into the entry
   chunk and undoes the 20 KB page tier. The engine arrives through `loadEngine()`.
2. **One import site per heavy dependency.** Every `import()` statement becomes its own chunk, so a
   library imported dynamically from two modules ships twice. `core/src/ogc.ts` is the only place
   that loads ogc-client; proj4 goes through `loadProj4()`.
3. **Everything rendered as HTML is sanitised.** Popup templates come from CMS fields, GetFeatureInfo
   HTML comes from third-party services. `popup.ts` owns DOMPurify; property values are escaped when
   the template is rendered *and* the result is sanitised before it touches the DOM.
4. **The config is data, never code.** No `eval`, no expression language. The template syntax is a
   closed mustache subset on purpose.
5. **Config order is drawing order.** The layer tree is the single source of truth; groups exist only
   in the TOC. Adapter mounts are therefore sequential, not parallel.
6. **Overlays survive style changes.** `map.setStyle()` drops runtime sources and layers, so the
   basemap manager re-injects them via `transformStyle` — including the highlight source and the
   current projection. Anything added to the map outside an adapter needs to be in that set.
7. **Services that cannot serve EPSG:3857 are out of scope** (D-02), and the client should say so
   rather than render an empty layer.

## 3. Field notes: MapLibre

### 3.1 The worker is three files, not one

MapLibre v6 ships ESM split into `maplibre-gl.mjs` (main thread), `maplibre-gl-shared.mjs` and
`maplibre-gl-worker.mjs`; the worker is spawned from a URL **relative to the bundle** and imports the
shared half itself. Consequences:

- Bundling MapLibre ships the shared half twice (once inside our bundle, once as the file the worker
  needs). We keep `maplibre-gl` external and copy all three files into `dist` verbatim.
- In Vite dev, `optimizeDeps.exclude: ["maplibre-gl"]` is required. Pre-bundling rewrites the worker
  URL into `.vite/deps` where it 404s, and the worker then **dies silently**: raster layers still
  render on the main thread while vector tiles and GeoJSON never appear.
- Diagnostic: `page.workers()` in Playwright, or the Sources → Threads panel in DevTools.

### 3.2 `isStyleLoaded()` is not a readiness signal

It stays false while anything is pending, and `load` waits for the first tile batch, which a slow WMS
can stretch to many seconds. The UI dismisses its loading veil on the first rendered frame after
`style.load`, with a 12 s fallback.

### 3.3 Style URLs need fixing before use

Real style documents contain relative URLs that MapLibre v6 rejects or ignores:

- `sprite: "../sprites/sprite"` → rejected outright ("must be absolute").
- TileJSON with `tiles: ["tile/{z}/{y}/{x}.pbf"]` → not resolved, no tile requests, no error.

`core/src/basemaps.ts` absolutises `sprite`, `glyphs` and `tiles` against the style URL **without**
the `URL` constructor, because that would percent-encode the `{z}` placeholders. TileJSON sources are
fetched and inlined, which also brings the zoom range along and prevents overzoom 404 storms. The
vector overlay adapter uses the same helper — the bug was fixed twice because it appeared in two
places.

### 3.4 Projections and CRS

Rendering is Web Mercator plus globe, full stop. The coordinate readout reprojects numbers for humans
with proj4 (display only) — that is a different problem from reprojecting tiles for a GPU, and
conflating them is how you end up promising something the engine cannot do.

## 4. Field notes: OGC services in the wild

### 4.1 Capabilities documents lie

basemap.at advertises five tile hosts, four of which (`maps1`–`maps4.wien.gv.at`) no longer resolve
in DNS. The WMTS adapter probes one real tile per candidate host in parallel and takes the first that
answers — any HTTP response counts, including 404, since that still proves the host is reachable. The
winning origin is cached per capabilities URL so further layers skip the probe.

A silent empty map is the worst possible failure mode; prefer a wasted request over that.

### 4.2 What Vienna's OGD services actually support

Verified while building the demos, useful as a reference for what "typical" looks like:

- `data.wien.gv.at/daten/geo` sends `Access-Control-Allow-Origin: *` (WMS, WFS).
- GetFeatureInfo offers `application/json` — prefer it, fall back to HTML/GML.
- WFS with `outputFormat=json&srsName=EPSG:4326` gives GeoJSON a `geojson` layer can use directly.
- 375 layers in one capabilities document, so the add-layer dialog needs a filter box.

### 4.3 ogc-client, the good and the sharp edges

[@camptocamp/ogc-client](https://github.com/camptocamp/ogc-client) is the only maintained capabilities
parser for this stack, and it works well — but:

- **Never call `enableFallbackWithoutWorker()`.** It looks like a defensive fallback; in practice its
  handler module can be dropped by dep optimizers and requests then queue forever with no error. The
  library's default worker is base64-inlined and bundler-safe.
- Its optional `ol` / `proj4` peers are only needed by `getOpenLayersTileGrid()`, which map0 never
  calls. They are aliased to `src/stubs/ol-stub.ts` so the build does not pull in OpenLayers.
- CRS inheritance is not resolved for nested layers, so a child layer can appear to offer no
  EPSG:3857 when its parent declares it. The add-layer dialog therefore warns instead of blocking,
  and treats an empty CRS list as "probably fine".
- In Vite dev it belongs in `optimizeDeps.include`; otherwise the first dialog open triggers dep
  discovery and reloads the page mid-flow.

### 4.4 The alias that broke coordinates in the built bundle only

The `proj4` → stub alias (added for ogc-client's optional peer) predated the coordinate readout. In
the dev server the alias does not apply, so coordinates worked; in the built bundle proj4 resolved to
a no-op stub and the readout silently produced nothing. Two lessons: package-level build config is
invisible to the dev server, and an alias is a blunt instrument — scope it to the module that needs
it, or drop it when a real dependency arrives.

## 5. Field notes: build and bundler

- **Rollup writes `output.paths` verbatim** into every chunk that imports the external module, so
  chunks must sit in the same directory as the entry. A `chunks/` subfolder made
  `./maplibre-gl.mjs` resolve one level too deep — and the standalone demo *looked* fine because it
  silently fell back to the dev sources. Demo pages that test the bundle must not have a fallback.
- **The entry is a facade.** Because the lazy chunks import our shared code, Rollup emits `map0.js`
  as a small re-export shim in front of the real chunk. That is normal for a code-split library; it
  costs one extra request, which a `modulepreload` hint can remove if it ever matters.
- **Chunk names come from module names**, which is why `popup-*.js` and `add-layer-dialog-*.js` are
  readable. `scripts/check-size.mjs` uses that plus the sourcemaps to classify tiers.
- **Two copies of Lit** produce a console warning and subtle breakage. It happens when a page loads
  both the built bundle and the sources — see `data-client="bundle"` in the standalone demo.
- **Never re-export an external binding from a non-entry chunk.**
  `export { Popup } from "maplibre-gl"` in `core/index.ts` looked harmless and worked in dev; in the
  build Rollup emitted the re-export but dropped the corresponding import, so the chunk referenced an
  undefined name (`Popup is not defined`, only in the bundle). Wrap it in a function that *uses* the
  binding instead — `createPopup()` — and the import survives.

## 6. Field notes: component and browser

- **Focus lives in the shadow root.** `document.activeElement` returns the host element, never what
  is focused inside. Read `(node.getRootNode() as ShadowRoot).activeElement`.
- **Constructable stylesheets** carry MapLibre's CSS, adopted at runtime so it stays out of the entry
  chunk. Order matters: it must be *prepended*, or our component styles no longer override it.
- **Container queries, not media queries.** A viewer can sit in a narrow CMS column on a wide screen;
  layout decisions must come from the element's own width.
- **`IntersectionObserver` never fires for `display: none`**, which is exactly right: a map in a
  hidden tab stays unloaded until shown, avoiding MapLibre initialising into a zero-size container.
- **Legends must not invent symbols.** A GeoJSON layer without a style gets fill + line + circle
  renderers speculatively (the geometry is unknown until the data arrives), so swatches are derived
  only from a style the author actually wrote.
- **Map text needs glyphs, DOM markers do not.** A symbol layer can only draw text if the basemap
  style provides a glyph source — over a raster basemap it silently renders nothing. Measurement
  labels are therefore `Marker` elements styled with the component's CSS tokens.
- **A modal map interaction must claim the pointer.** While measuring, a click sets a vertex and
  must not also open a feature-info popup underneath it: `core.setInteractionLocked(true)` suspends
  feature info and hover for as long as the interaction owns the map.
- **Window-level keyboard handlers need `composedPath()`.** Inside a shadow root `event.target` is
  retargeted to the host, so a handler cannot tell whether the user is typing in the search box.
  Without that check, Backspace while searching deletes a measurement vertex.

## 7. Testing and verification

| Layer | Tool | Covers |
|---|---|---|
| Pure logic | Vitest (`packages/**/*.test.ts`) | URL building, templates, merge rules, projections, permalink codec |
| Whole demos | `e2e/verify-demos.mjs` (Playwright) | every demo page renders, key interactions, **console must stay clean** |
| Bundle | `scripts/check-size.mjs` | tier sizes, page-tier budget |

Notes on the E2E script:

- It launches **system Chrome** (`channel: "chrome"`), falling back to the bundled shell. The bundled
  headless shell software-renders WebGL, which is too slow for a ~780-layer vector style — symptoms
  look like "the map never finishes loading".
- Console errors fail a demo. Known-broken services get an explicit allow-list (`IGNORED_CONSOLE`),
  so accepting noise is a visible decision rather than a habit.
- Screenshots land in `e2e/shots/` (git-ignored). They are for looking at, not yet compared
  automatically — visual regression is still open (N9).
- The demos run against live services, so a failing run is worth repeating once before believing it.

## 8. Where things live

```
packages/schema   types, validation (JSON-path errors), defaults, extends merging
                  → no dependencies, no DOM, no MapLibre
packages/core     the engine: map creation, basemap manager, source adapters, feature info,
                  highlight, print composition, permalink codec, coordinates, i18n
                  → imports MapLibre; never imports the UI
packages/ui       <map0-viewer>, panels, dialogs, popup rendering, focus trap, styles
                  → imports core lazily (see invariant 1)
examples/         landing page + /demos (one page per topic) + configs and data
e2e/              headless verification
scripts/          build-adjacent tooling (size budget)
```

Adapters implement one interface (`core/src/adapters/types.ts`): mount, visibility, opacity, bounds,
legend, optional `featureInfo`. Adding a source type means adding an adapter and registering it —
that registry is the intended extension point.

## 9. Debugging playbook

| Symptom | Look here first |
|---|---|
| Raster renders, vector tiles and GeoJSON do not | MapLibre worker died — dev-server dep pre-bundling (§3.1) |
| Layer added, no tile requests at all | relative tile templates in TileJSON (§3.3) |
| Works in `pnpm dev`, broken in the bundle | package-level build config: aliases, externals (§4.4) |
| Works in the bundle, broken in dev | `optimizeDeps` include/exclude (§3.1, §4.3) |
| Capabilities request hangs forever, no error | `enableFallbackWithoutWorker` (§4.3) |
| Map stays empty, tiles 404 or DNS-fail | dead mirror host in capabilities (§4.1) |
| Overlays vanish after switching basemap | something added outside an adapter, missing from `transformStyle` (invariant 6) |
| Console: "Multiple versions of Lit loaded" | page loads both bundle and sources (§5) |
| Page tier over budget in CI | a value import from `@map0/core` crept into the element (invariant 1) |
