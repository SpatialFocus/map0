# 06 — Architecture

> Status: v0.1 · 2026-08-14 · Reflects decisions D-01…D-05 (see [08-decisions.md](08-decisions.md)).
> D-01 = **web component**; D-02 = 3857 accepted as product constraint; D-03 = v1 sources: WMS/WMTS/GFI +
> vector tiles/GeoJSON/PMTiles; D-04 = client-side print first; D-05 = config links + URL import.
> Reference embed target: a **plain static HTML page** (per O-03; headless-CMS frontends follow from that).

## Packaging (per D-01)

map0 ships as a **framework-agnostic custom element** built with **Lit**:

```html
<script type="module" src="https://cdn.example.com/map0@1/map0.js"></script>
<map0-viewer config-src="/configs/env.map0.json" style="height:520px"></map0-viewer>
```

Why Lit: tiny runtime (~5 KB), TypeScript-first, Shadow-DOM-native, proven for exactly this use
case in the geo world (EOxElements). MapLibre v6 being ESM-only matches `<script type="module">`
distribution. A React wrapper (`@map0/react`) is a thin later addition (M2), not a v1 concern.

Element naming: `<map0-viewer>` (valid custom-element name; final name follows O-02 renaming).
The element also exposes an imperative handle: `el.api` (same surface as `createMap()`).

## Repository layout (pnpm monorepo)

```
map0/
├─ packages/
│  ├─ schema/     # JSON Schema (published), TS types, validation, defaults, migrations
│  ├─ core/       # headless engine: config pipeline, source adapters, state store,
│  │              # feature-info, legend resolution, i18n runtime — NO DOM UI
│  ├─ ui/         # <map0-viewer> Lit element + panels (TOC, legend, popup, print, …)
│  └─ react/      # (M2) thin wrapper
├─ site/          # map0.net: landing + /demos + demo configs (live Austrian SDI services,
│                 # plain-HTML/CMS embeds); grows into docs site + playground
└─ e2e/           # Playwright + visual regression against site/
```

`core` is deliberately UI-free: it makes the web component thin, enables the React wrapper and
headless testing, and keeps the door open for other shells — without committing to the full
"core + wrappers" program from D-01 option C.

## Runtime layering

```
Host page (CMS)
└─ <map0-viewer>  (Lit, Shadow DOM, CSS custom properties, container queries)
   ├─ UI modules: TOC · legend · popup/bottom-sheet · toolbar · dialogs (lazy)
   │        ▲ subscribe to store, dispatch intents
   ├─ core: config pipeline → state store (reactive signals) → public API/events
   │        └─ source adapters: style | raster | wms | wmts | geojson | vector/pmtiles
   │                            (v1.x: ogcapi-features | wfs | cog)
   └─ MapLibre GL JS v6 (Map, controls, globe, terrain)
```

### Config pipeline

`load (inline JSON | config-src | JS object)` → `resolve extends` → `validate (JSON Schema)` →
`normalize (apply defaults, expand shorthands)` → `instantiate adapters` → `ready`.

Validation failure never yields a blank map: the element renders an **error panel** with
schema-pointer messages (`layers[2].url missing — a wms layer needs a url`). Unknown keys warn to
console (forward compatibility, C5).

### Source adapters

Every layer `type` maps to an adapter implementing one interface:

```ts
interface SourceAdapter {
  mount(map: MaplibreMap, insertBefore?: string): Promise<void>;
  unmount(): void;
  setVisible(v: boolean): void;             // visibility without re-fetch
  setOpacity(o: number): void;              // incl. raster-opacity / per-layer paint
  bounds(): Promise<LngLatBounds | null>;   // zoom-to-layer
  legend(): Promise<LegendSpec | null>;     // GetLegendGraphic URL | style-derived swatches | config override
  featureInfo?(pt: LngLat, px: Point): Promise<FeatureInfoResult[]>; // vector query | WMS GFI fetch
  status: Signal<'loading' | 'ready' | 'error'>;                     // TOC badges (F2.5)
}
```

v1 adapters (per D-03): `style` (basemap), `raster` (XYZ/WMTS-REST), `wms` (+GFI, +GetLegendGraphic),
`wmts` (capabilities resolver via `@camptocamp/ogc-client` → raster template), `geojson`
(clustering, simplified-style expansion), `vector` (TileJSON/`{z}` template/`pmtiles://`).
v1.x: `ogcapi-features`, `wfs`, `cog`. The adapter registry is a public extension point (plugins).

### Two non-obvious core mechanisms

1. **Basemap switching**: `map.setStyle(next, { transformStyle })` re-injects all overlay
   sources/layers into the incoming style — MapLibre wipes runtime layers on style change otherwise.
   A sentinel layer id marks the basemap/overlay boundary so overlays always stack above basemaps
   and label placement stays sane.
2. **Z-order model**: the config tree (depth-first order) is the single source of truth; core maps
   tree order → MapLibre layer order on every change (drag-reorder, add, remove). The first entry in
   the tree is the top-most overlay (F2.1), so the mapping is a reversal: core mounts bottom-up.
   Groups are a TOC/UI concept only — MapLibre sees a flat, ordered layer list.

### Feature info pipeline (F5)

click/tap → hit test: `queryRenderedFeatures` for vector adapters + parallel GFI fetches for
queryable WMS (`info_format=application/json`, GML/HTML fallback) → merge per layer → render
templates (`{{prop}}` mustache-subset, **DOMPurify sanitization**) → popup (anchored on ≥640 px,
bottom sheet below). All results also exposed via `map0:featureclick` event for host-page use.

## State, API, events

- Core keeps a small reactive store (signals): view, projection, basemap id, layer tree state
  (visibility/opacity/order/status), active tool, locale, theme.
- **Imperative API** mirrors config (C7): `api.setLayerVisibility(id, v)`, `api.addLayer(def)`,
  `api.flyTo(…)`, `api.getState()` → serializable diff usable as share-state or config export.
- **DOM CustomEvents** from the element: `map0:ready`, `map0:error`, `map0:featureclick`,
  `map0:statechange` — the CMS-friendly integration surface (no imports needed).

## Theming (F12)

- Design tokens as **CSS custom properties** on the host element (`--map0-primary`,
  `--map0-radius`, `--map0-font`, `--map0-bg`, …) — settable from config (`theme`) *or* host CSS.
- Shadow parts (`::part(panel)`, `::part(toc)`, …) as the documented, semver-stable escape hatch.
- Dark mode: `prefers-color-scheme` by default, `theme.mode` override; map style swap per basemap
  entry (`darkUrl` optional key — v1.x).
- Layout responds to **container size** (container queries), not viewport — a map0 in a CMS column
  must behave like a small map even on a big screen.

## Performance & loading (N1/N2)

Measured with `pnpm size` (gzip, current). Three tiers, paid at different moments:

| Tier | Size | Paid when |
|---|---|---|
| **page** — custom element + Lit | ~20 KB | the page loads — budget 40 KB, enforced in CI |
| **map** — engine, MapLibre (3 files), its stylesheet, popup renderer | ~314 KB | the element approaches the viewport |
| ogc-client (capabilities parsing) | ~62 KB | first add-layer dialog or WMTS layer |
| proj4 (+ wkt-parser, mgrs) | ~47 KB | first coordinate readout |
| PMTiles | ~8 KB | first `pmtiles://` layer |
| print / add-layer dialogs | ~5 KB | first open |

**Nothing but the element loads until the map is needed.** `<map0-viewer>` observes itself with an
IntersectionObserver (300 px root margin) and only then fetches the config, the engine and MapLibre
— so an article with a map at the bottom pays 20 KB unless a reader scrolls there. `loading="eager"`
opts out, `load()` forces it, and elements inside a hidden tab stay unloaded until shown, which also
avoids MapLibre initialising into a zero-size container. This is an attribute rather than a config
key because it decides whether the config is fetched at all.

Two more decisions carry the rest:

- **MapLibre is external, not bundled.** It ships as ESM split across `maplibre-gl.mjs`,
  `maplibre-gl-shared.mjs` and `maplibre-gl-worker.mjs`; the worker needs the shared half on disk
  regardless, so bundling would ship those ~130 KB gz twice. Keeping it external also means those
  files are byte-identical across map0 releases and survive in the HTTP cache.
- **One import site per heavy dependency.** Every `import()` statement becomes its own chunk, so a
  library imported dynamically from two modules is emitted twice. `core/src/ogc.ts` is the single
  place that loads ogc-client (the WMTS adapter and the add-layer dialog both go through it).

Chunks are emitted flat next to the entry: Rollup writes the external MapLibre specifier verbatim
into every chunk, so a `chunks/` subdirectory would resolve `./maplibre-gl.mjs` one level too deep.

Keeping the page tier this small requires discipline in the element: it may only import types from
`@map0/core` (erased at build time) plus `@map0/schema`. A single value import from core would pull
MapLibre back into the entry chunk.
- One shared maplibre instance per element; multiple elements per page supported (N8); workers are
  per-map (document memory implications for >3 maps/page).

## Security (N6)

- **Sanitize everything renderable**: popup templates, WMS HTML GFI, capabilities abstracts,
  legend labels (DOMPurify, strict allow-list, `rel="noopener"` links).
- Config is data, never code: no expression eval; templates are a closed mustache-subset.
- `https:` enforced for all service URLs by default (`allowInsecure: true` opt-out for intranets).
- CSP guidance shipped in docs: MapLibre needs `worker-src blob:`; map0 itself must run with no
  `unsafe-inline`/`unsafe-eval` requirement — verified by an e2e test under a strict CSP.
- Auth for protected services only via runtime hooks (`api.setRequestTransform`), never config (C8).

## Print (D-04)

v1 is fully client-side: hidden cloned `Map` at target paper size × DPI (`pixelRatio`), wait for
`idle`, compose title/legend/scale bar/north arrow/attribution in a layout DOM, then browser print
or PNG/jsPDF download (technique proven by @watergis/maplibre-gl-export v5 — we reuse the approach,
render into our own layout UI). The print module defines a `PrintProvider` interface so a
server-side, scale-true adapter (maplibre-native service / MapFish) can be added in M2+ without
touching the UI.

## Add-layer dialog (D-05)

URL paste → `@camptocamp/ogc-client` capabilities parse (worker) → layer picker (with abstracts,
CRS check per D-02: warn if no 3857/WebMercatorQuad offering) → adapter instantiation. User-added
layers live in session state (+ share-state), never mutate the page config. CORS reality is
documented prominently (services must send CORS headers; no proxy in core, recipe in docs).

## Error handling & DX

- Layer failure → TOC badge + `map0:error` event + console detail; map keeps running.
- Config errors → error panel (see pipeline); schema published so CMS-side validation can happen
  *before* publish.
- Dev mode flag enables verbose logging + maplibre-gl-inspect.

## Testing & CI

- `schema`: golden tests for validation/defaults/migrations.
- `core`: adapter unit tests with mocked fetch (recorded capabilities/GFI fixtures from real
  Austrian services).
- `e2e`: Playwright against `site/` — interaction flows + **visual regression screenshots**;
  strict-CSP smoke test; a11y audit (axe) gate.
- CI budgets: bundle size check, Lighthouse on demo page.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| A desired service cannot serve EPSG:3857 (D-02) | Out of scope by decision — 3857 is an inclusion criterion; add-layer dialog checks capabilities and says so; escape hatches for edge cases: raster-reprojection plugin, proxy recipe |
| WMS GFI/CORS friction in the wild | preflight capabilities check, clear per-layer error UI, documented proxy recipe (core stays serverless) |
| Print fidelity expectations (scale-true) | explicit "export what you see" wording in UI; PrintProvider interface reserved for server adapter |
| maplibre v6 ESM-only vs. legacy CMS | docs ship a `<script type="module">` + fallback note; module scripts are fine in all evergreen browsers (N5) |
| a11y limits of canvas maps | DOM-mirrored results (popup list, TOC), keyboard map nav on, reduce-motion wired; documented WCAG statement per release |
| Scope creep toward portal features | Non-goals in 01-vision + "config key without docs = not done" rule; M2+ gates |
