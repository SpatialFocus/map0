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
├─ examples/      # demo configs incl. live Austrian SDI services + plain-HTML/CMS embeds
├─ site/          # docs site (config reference generated from schema) + playground
└─ e2e/           # Playwright + visual regression against examples/
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
   tree order → MapLibre layer order on every change (drag-reorder, add, remove). Groups are a
   TOC/UI concept only — MapLibre sees a flat, ordered layer list.

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

- Eager core: element + store + TOC + adapters ≈ target ≤ 100 KB gz (maplibre-gl ~253 KB gz loads in
  parallel; consider `import('maplibre-gl')` deferral until the element is in viewport —
  IntersectionObserver, good for long CMS pages).
- Lazy modules via dynamic import: print dialog, add-layer dialog, measure, geocoder, RTL plugin.
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
- `e2e`: Playwright against `examples/` — interaction flows + **visual regression screenshots**;
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
