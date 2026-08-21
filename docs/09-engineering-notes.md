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
pnpm build && pnpm smoke        # browser smoke test on the BUILT bundle, network-free (CI runs it)
pnpm build && pnpm size         # library bundle + the size budget
pnpm demo:standalone            # build + copy dist next to the standalone demo page
pnpm build:npm                  # assemble the publishable `map0` package (§release)
pnpm release                    # the whole release: version, changelog, verify, publish (§release)
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

### Release — the `map0` npm package

`packages/map0` is the only publishable package: **`map0-viewer`** on npm, containing the prebuilt
bundle (no dependencies, MapLibre included). The folder keeps the product name, the package cannot:
npm's typosquatting heuristic rejects the unscoped `map0` as too similar to `mcp1`, `hapi`, `tap`
and `tape` — short names are normalised (`0` reads as *o*) and compared by edit distance, and the
check is server-side only, so `npm pack`/`--dry-run` will not warn you. The name is unregistered but
unavailable; only npm support can release it. Scoped names skip the check entirely, which is why the
`map0` org is reserved for the day `@map0/core` and `@map0/react` become separate installs. The
workspace packages stay `private` until then, so a stray `pnpm publish -r` cannot leak them.

The release is one command, run from a clean `main` (release-it + `@release-it/conventional-changelog`,
configured in `packages/map0/.release-it.json`; `scripts/release.mjs` runs it in `packages/map0` —
that package.json carries the published version, the root one is a private 0.0.0 — and feeds it a
`GITHUB_TOKEN` from the gh CLI's keyring login):

```bash
pnpm release                     # add --dry-run to watch without touching anything
```

What it does, in order — any failing step aborts before anything is public:

1. gate: `pnpm typecheck` + `pnpm test`;
2. proposes the bump from the conventional commits since the last tag (`fix:` → patch,
   `feat:` → minor, `BREAKING CHANGE` → major — confirm or override interactively) and writes the
   new section into `CHANGELOG.md`;
3. `scripts/bump-version-refs.mjs` moves the CDN/prose version references in both READMEs and the
   standalone demo page — reference counts are asserted, a reworded sentence fails the release;
4. `pnpm build:npm` (bundle without sourcemaps + regenerated notices) and `npm pack`;
5. `e2e/verify-tarball.mjs` — the folder-is-the-unit gate, see below;
6. `npm publish` (the account has 2FA at auth-and-writes — release-it prompts for the OTP;
   npm versions are immutable, an unpublish is only possible within 72 h and burns the name for 24 h);
7. release commit + annotated tag `v<version>`, push, and a **GitHub release** with the changelog
   section as notes and the verified `.tgz` attached as asset.

Changelog fine print: issue references in commit messages only count as `GH-<n>` — with the default
`#<n>` prefix the parser turned a `#333` grey and the `#dem` URL fragment in commit bodies into
dead issue links. The initial CHANGELOG.md was backfilled from the tag history with the same preset
(2026-08-19), as were the GitHub releases for v0.0.1–v0.0.5.

Two things a release has to get right, both of which fail *silently* if it does not:

- **The folder is the unit.** `dist/` ships `map0.js`, its lazy chunks and MapLibre's three files
  side by side (§4.4). Verify the **packed tarball**, not `packages/ui/dist` — automated in
  `e2e/verify-tarball.mjs` (hook step 5, or by hand: `node e2e/verify-tarball.mjs <tgz>`): it
  unpacks the tarball over `site/public/standalone/`, loads `/demos/standalone.html` (which
  then exercises exactly the files a consumer gets) and asserts rendered **vector-tile** features —
  a missing worker file still paints raster layers — plus the COG config, because the COG decoder
  is a lazy chunk and lazy-chunk resolution is what regresses between dev server and bundle.
- **Third-party notices are an obligation.** `scripts/build-npm.mjs` reads the build's sourcemaps to
  find every package compiled into the bundle and reproduces each licence in full. A new bundled
  dependency whose npm tarball ships no licence text (pmtiles, today) **fails the build** until its
  text is added under `scripts/third-party/` and registered in `FALLBACK_LICENSES`. Do not silence
  this check.

Ownership: an unscoped package belongs to whoever publishes it first — the personal account that
ran `npm publish`, not the org. Add a second owner (`npm owner add <user> map0-viewer`) so the name
does not depend on one person's account.

#### The CDN release is the npm release

`npm publish` *is* the CDN release: jsDelivr and unpkg mirror the tarball at
`…/npm/map0-viewer@<version>/dist/map0.js` — versioned, immutable, `Access-Control-Allow-Origin: *`.
Verified cross-origin against 0.0.1 from a foreign page: the entry, every lazy chunk **and**
`maplibre-gl-worker.mjs` load from the CDN, 12,849 vector-tile features on screen, no console errors.

What makes that work is MapLibre v6 handling the cross-origin worker itself: a same-origin `Worker`
is a hard browser rule, so it wraps the absolute worker URL in a one-line blob module
(`import "<url>"`) and starts *that*. The docs read as if `WORKER_URL` had to be configured for a
CDN — it does not, as long as the files answer with CORS. Do not "fix" this with a self-hosted worker
copy; it only recreates the folder-unit problem the bundle already solves.

The docs name **jsDelivr** first and unpkg as the alternative: unpkg is the better-known name from a
decade of tutorials, but jsDelivr is multi-CDN with documented failover, a purge API and mainland
China coverage. Both are verified, so the choice is reversible for anyone copying a snippet.

Two things `/standalone/` on map0.net is **not**: versioned, and immutable. It is the demo artefact,
rebuilt and overwritten by every `pnpm build:site`, `max-age=3600`. `access-control-allow-origin: *`
in `site/public/staticwebapp.config.json` makes it *loadable* from a foreign page, which is a
convenience for anyone copying from the demo, not a distribution channel — a redeploy changes the
chunk hashes while a consumer's browser still holds the cached entry, and the entry then imports
chunks that no longer exist. Anyone embedding for real gets a pinned CDN URL. Building a versioned
`/v<x.y.z>/` path here would mean materialising every supported version at site-build time, because
an Azure SWA deploy replaces the whole site — which is exactly the service jsDelivr performs for
free.

## 2. Invariants

Break one of these and something breaks quietly, usually only in production builds.

1. **The element must not import values from `@map0/core`.** Only `import type` (erased at build
   time) plus value imports from `@map0/schema`. One value import pulls MapLibre into the entry
   chunk and undoes the 31 KB page tier. The engine arrives through `loadEngine()`.
2. **One import site per heavy dependency.** Every `import()` statement becomes its own chunk, so a
   library imported dynamically from two modules ships twice. `core/src/ogc.ts` is the only place
   that loads ogc-client; proj4 goes through `loadProj4()`.
3. **Everything rendered as HTML is sanitised.** Popup templates come from CMS fields, GetFeatureInfo
   HTML comes from third-party services. `popup.ts` owns DOMPurify; property values are escaped when
   the template is rendered *and* the result is sanitised before it touches the DOM.
4. **The config is data, never code.** No `eval`, no expression language. The template syntax is a
   closed mustache subset on purpose.
5. **Config order is z-order, top of the list first** (F2.1). The layer tree is the single source of
   truth; groups exist only in the TOC. MapLibre appends every new layer on top, so core mounts the
   tree **bottom-up** (`drawOrder()`) — and sequentially, never in parallel, or the stack is a race.
   Everything that reads the stack (TOC, legend, hit test) uses `stackOrder()`: runtime-added layers
   first, then the configured tree.
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
  needs). We keep `maplibre-gl` external and copy all three files in verbatim — next to the entry in
  the library `dist`, next to the hashed chunks in the site's `assets/` (`scripts/maplibre-dist.mjs`).
- In Vite dev, `optimizeDeps.exclude: ["maplibre-gl"]` is required. Pre-bundling rewrites the worker
  URL into `.vite/deps` where it 404s, and the worker then **dies silently**: raster layers still
  render on the main thread while vector tiles and GeoJSON never appear.
- The same failure in a **static build**, and better hidden: the worker URL is assembled at runtime,
  so nothing emits the file for you. If it is missing *and* the host answers unknown paths with
  `index.html` — Vite's default `appType: "spa"`, or an SPA rewrite on the CDN — the worker is handed
  HTML with **status 200**, so there is not even a 404 in the network panel. Hence `appType: "mpa"`
  for the demo site and no `navigationFallback` in `staticwebapp.config.json`.
- Diagnostic: `page.workers()` in Playwright, or the Sources → Threads panel in DevTools. Cheapest
  check after a deploy: request a path that cannot exist and confirm it answers 404, not 200.

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

The same probe taught a second lesson: it decides *which host is alive*, so it must race one
candidate **per origin**. Racing every resource link of one host lets the network settle which
*format* the layer uses — a coin flip between runs.

### 4.1b Capabilities order is not preference order

GeoServer/GWC lists `application/vnd.mapbox-vector-tile` **first** for every vector-backed layer,
before `image/png`. Taking `resourceLinks[0]` therefore fed protobuf into a MapLibre `raster`
source: tiles arrive with HTTP 200, image decoding fails, the layer reports an error and shows
nothing. A raster source needs an explicit image-format filter (`isRasterTileFormat`) —
`InfoFormat`/UTFGrid/TileJSON links are equally tempting and equally undecodable.

Vector tiles from such a service are a `vector` layer, not a `wmts` one. GWC even publishes a ready
TileJSON per style (`…/wmts/rest/<layer>/<style>/tilejson/pbf`) whose `tiles` template is already in
XYZ order, so it drops straight into a `vector` layer with `sourceLayer` from `vector_layers[].id`.

### 4.1c Out-of-range tiles are a 400, not an empty picture

GWC restricts a regional layer to per-level row/column ranges (`TileMatrixSetLimits`) and answers
anything outside with **400 TileOutOfRange** — a whole-Austria view of an Austria-sized layer
requested column 32 at z6 where the range starts at 33, and every viewport tile outside the extent
was an error. QGIS is unaffected because it honours the limits; MapLibre has no per-level concept,
but doesn't need one: for a quadtree pyramid the footprint of the *deepest* level's limits lies
within every coarser level's footprint, so one source `bounds` derived from it keeps the tile cover
equal to the server's range at **every** level (verified against all 25 published levels). Two traps
en route:

- The coverage edges sit exactly on tile boundaries, and capabilities coordinates are print-rounded
  (GeoServer emits `2.003750834E7`, ~3 mm off). Without an inset, MapLibre's floor/ceil cover tips
  over into a neighbouring out-of-range tile at the deepest level; `coverageFromLimits` pulls the
  edges in by 1 % of a tile (min 2 cm).
- **`TopLeftCorner` axis order is a coin flip.** One and the same GeoServer document publishes
  `EPSG:900913` as "x y" and `WebMercatorQuad` as "y x" (URN axis rules). Read as-is, the clip
  degenerates to a corner of the world and the layer silently disappears — found live, not in
  review. A real top-left keeps the matrix inside the world square, so the adapter tries both
  readings and keeps the one that fits; anything still degenerate is discarded in favour of the
  WGS84 bbox, because a wrong clip (empty map) is far worse than no clip (wasted 400s).

The zoom range rides along for free: levels missing from the limits are TileOutOfRange territory
too (GWC `zoomStart`/`zoomStop`), so they bound the source's `minzoom`/`maxzoom`.

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

### 4.3b Inlining a TileJSON can poison the whole style

The basemap pipeline inlines TileJSON sources (see 05 §field notes: relative `tiles` templates).
The first version copied **every** TileJSON key into the source object — and a TileJSON legally
carries metadata (`tilejson`, `name`, `center`, `description`, …) that the MapLibre style spec does
not allow on a source. MapLibre v6 then refuses the **entire style** ("unknown property"), the map
never fires `style.load`, and the viewer sits behind its loading veil forever. basemap.at's
TileJSONs happened to carry nothing offensive, so this slept until the ICGC contextmaps styles
(COG demo) hit it. Fix in `inlineTileJsonSources`: copy only keys valid for the source *type* —
`minzoom`/`maxzoom`/`bounds`/`attribution` plus `scheme` (vector/raster) or `encoding`
(raster-dem, where `scheme` itself is illegal).

### 4.3c COG layers (maplibre-cog-protocol)

- The adapter calls `getCogMetadata()` **before** `addSource`: it fails fast with a clear message
  (unreachable file, or "projection EPSG:xxxxx is not supported" — the protocol never reprojects),
  and its `bbox` feeds "zoom to layer". The result is cached inside the library, so the protocol
  handler does not fetch the header twice.
- The protocol answers the source `url` with a TileJSON (tiles/bounds/maxzoom from the file
  header); always `tileSize: 256`.
- The ramp legend is derived from the library's `colorScale()` — for discrete ramps the class
  count is recovered by sampling the scale (thresholds are uniform over min–max), so map0 does not
  duplicate the palette tables.
- `color.classes` (explicit values/ranges) renders through the protocol's `setColorFunction()`,
  which is keyed by the **plain COG URL, globally** — and overrides any `#color`/`#dem` fragment on
  that URL. Consequences the adapter handles: registration is refcounted per URL (removing one of
  two layers sharing a file keeps the other rendered; the function is cleared when the last
  unmounts), and two classes-layers on the same URL with different classes log a warning (last one
  wins for both). Not handleable: a classes layer and a ramp/hillshade layer on the *same file*
  — the color function silently wins; documented in 04-configuration instead. In the pixel
  function, `scale`/`offset` are applied manually (the fragment paths do this inside the library;
  the custom path does not), noData/NaN/`Infinity` (the reader's fill value) render transparent,
  and exact `value` matches use a relative epsilon because scale/offset arithmetic is float.
- geotiff.js (plus lerc/pako decoders) rides in the lazy cog chunk — configs without a cog layer
  never load it. `lerc@3` ships no licence text in its tarball → fallback entry in
  `scripts/build-npm.mjs` (same mechanism as pmtiles).
- **Hillshade has no opacity paint property.** `hillshade: …` renders `#dem` (Terrain-RGB) into a
  `raster-dem` source with a `hillshade` layer — and the TOC opacity slider maps to
  `hillshade-exaggeration` (base = the configured exaggeration) because that is the only usable
  intensity knob.
- The demo DEM (`site/public/data/bev-dgm25-grossglockner-3857.tif`, ~3 MB) is a cut of the
  BEV 25 m terrain model (CC BY 4.0): the original `data.bev.gv.at` file is EPSG:31287 **and** its
  server sends no `Access-Control-Allow-Origin`, so it cannot be used in place. Recipe:
  `gdalwarp -of COG -t_srs EPSG:3857 -te <mercator bounds> -tr 36 36 -r bilinear -ot Int16
  -dstnodata -32768 -co COMPRESS=DEFLATE -co PREDICTOR=2 /vsicurl/<url> out.tif`. Pick a nodata
  outside the data range — a COG with **no** declared nodata treats 0 as transparent (protocol
  behaviour), which on a DEM would punch holes at sea level.

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
- **Fat optional dependencies are worth stubbing.** jsPDF dynamically imports html2canvas and canvg
  for `doc.html()` and SVG rasterisation, which map0 never calls — ~110 KB gzip that shipped in the
  folder and would only ever be dead weight. Aliased to `src/stubs/pdf-stub.ts`, same trick as
  ogc-client's OpenLayers peers. Note what is *not* stubbed: jsPDF also pulls dompurify, and our
  popup renderer uses that one for real.
- **A detached `<a download>` is unreliable for large blobs.** The PNG export had worked that way for
  months; the multi-megabyte PDF silently did nothing until the anchor was appended to the document
  before clicking. Append, click, remove.
- **Two copies of Lit** produce a console warning and subtle breakage. It happens when a page loads
  both the built bundle and the sources — see `data-client="bundle"` in the standalone demo.
- **Never re-export an external binding from a non-entry chunk.**
  `export { Popup } from "maplibre-gl"` in `core/index.ts` looked harmless and worked in dev; in the
  build Rollup emitted the re-export but dropped the corresponding import, so the chunk referenced an
  undefined name (`Popup is not defined`, only in the bundle). Wrap it in a function that *uses* the
  binding instead — `createPopup()` — and the import survives.

### 5.0b The one file on map0.net whose name never changes

Everything the site serves is either content-hashed (`/assets/*`, cached for a year and
`immutable`) or `no-cache` HTML — except the standalone demo's bundle. `/standalone/map0.js` keeps
its name across releases *and* imports content-hashed chunks that a deploy replaces, deleting the
old ones. That combination breaks on its own: a browser holding the previous `map0.js` asks for
chunk names that are now 404, and the demo shows no map at all. Its own note ("run `pnpm
demo:standalone`") then points at the wrong cause.

Cloudflare sits in front of the site and **raises short browser TTLs to its own Browser Cache TTL**
(4 h at the time of writing) while leaving longer ones alone — so `max-age=3600` on the origin was
served as `max-age=14400`, and a year-long `immutable` came through untouched. A short max-age is
therefore not a fix; the entry must be `no-cache`, which Cloudflare does respect (HTML proves it:
`no-cache` in, `no-cache` and `cf-cache-status: DYNAMIC` out).

`staticwebapp.config.json` routes `/standalone/map0.js` and `map0-ssr.js` to `no-cache` and leaves
the hashed chunks around them on a short max-age. Deliberately **not** `immutable` for the chunks,
even though hashed names would allow it: Azure's route patterns are matched top-down, and an entry
that slipped past its exact-path rule would inherit a year of caching — a permanently stale bundle
for returning visitors, fixable only by renaming the file. Short everywhere fails soft; the
bandwidth is one demo page's worth.

### 5.1 Site i18n: two languages from one source, at build time

The site (map0.net) is bilingual without a framework. The English page is the only source:
elements carry `data-i18n="key"` (inner HTML) or `data-i18n-attrs="attr:key"` (attribute values)
and keep their English text inline; one JSON catalogue per page under `site/i18n/de/` supplies the
German. `site/i18n/plugin.ts` emits every built page a second time under `/de/` (and serves `/de/…`
on the fly in dev), sets `<html lang="de">`, rewrites internal page links, injects `hreflang`
pairs, and puts a one-time browser-language redirect on `/` (choice persisted in localStorage by
the topbar switcher — same behaviour as spatial-focus.net's `redirectOn: "root"`). The build warns
about **missing** keys (page stays English there) and **stale** keys (catalogue entries nothing
asks for) — after editing English copy, touch the German catalogue or the build will say so.
Strings that scripts render at runtime (gallery cards, pager, Copy buttons, validator status) key
off `document.documentElement.lang` via `site/lang.ts` instead. The dark/light topbar toggle works
the same way at the other end: an inline chrome script applies the stored choice before first
paint, CSS carries the dark tokens twice (`@media` for the OS default, `:root.dark` for the
explicit choice), and embedded maps follow through the viewer's `theme` attribute.

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
site/             landing page + /demos (one page per topic) + configs and data
site/i18n/        German page catalogues + the build-time translation plugin (§5.1)
e2e/              headless verification
scripts/          build-adjacent tooling (size budget)
```

Adapters implement one interface (`core/src/adapters/types.ts`): mount, visibility, opacity, bounds,
legend, optional `featureInfo`. Adding a source type means adding an adapter and registering it —
that registry is the intended extension point.

## 9. Debugging playbook

| Symptom | Look here first |
|---|---|
| Raster renders, vector tiles and GeoJSON do not | MapLibre worker died — dep pre-bundling in dev, missing worker file or an SPA fallback in a build (§3.1) |
| Layer added, no tile requests at all | relative tile templates in TileJSON (§3.3) |
| Works in `pnpm dev`, broken in the bundle | package-level build config: aliases, externals (§4.4) |
| Works in the bundle, broken in dev | `optimizeDeps` include/exclude (§3.1, §4.3) |
| Capabilities request hangs forever, no error | `enableFallbackWithoutWorker` (§4.3) |
| Map stays empty, tiles 404 or DNS-fail | dead mirror host in capabilities (§4.1) |
| Overlays vanish after switching basemap | something added outside an adapter, missing from `transformStyle` (invariant 6) |
| Console: "Multiple versions of Lit loaded" | page loads both bundle and sources (§5) |
| Page tier over budget in CI | a value import from `@map0/core` crept into the element (invariant 1) |
