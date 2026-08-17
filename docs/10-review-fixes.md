# 10 — Review Findings & Fixes

> External architecture review, 2026-08-17. One row per finding: what was claimed, whether it holds
> against the code, what we do about it. Requirement IDs refer to
> [03-requirements.md](03-requirements.md), invariants to
> [09-engineering-notes.md](09-engineering-notes.md).
> Status: ✅ fixed · 🟡 partly fixed (rest tracked in [07-roadmap.md](07-roadmap.md)) · ⬜ open.

| # | Finding | Verdict | Status |
|---|---|---|---|
| R1 | Layer order contradicts the requirements contract | valid | ✅ |
| R2 | Web-component lifecycle not reconnect-safe, init races | valid | ✅ |
| R3 | Config validation is not a reliable system boundary | valid | 🟡 |
| R4 | Package entry is not SSR-safe | valid | ✅ (see R8) |
| R5 | Multiple instances share one permalink parameter | valid | ✅ |
| R6 | Adapter listeners leak; MapLibre errors only logged | valid | ✅ |
| R7 | The riskiest area (component + built bundle) is not in CI | valid | ✅ |

Second round, after the fixes above were reviewed again:

| # | Finding | Verdict | Status |
|---|---|---|---|
| R8 | The SSR guard is too late — the import itself needs a DOM | valid | ✅ |
| R9 | Unknown keys became fatal, against C5 | valid | ✅ |
| R10 | A newly appearing, higher-priority config source is ignored | valid | ✅ |
| R11 | A failed core leaks its permalink claim | valid | ✅ |

---

## R1 · Layer order — “top of the list = top of the map” [P1] ✅

**Claim.** F2.1 promises *top of list = top of map*; normalization and sequential mounting made the
**first** config entry the **bottom-most** overlay.

**Verdict: valid.** `normalizeConfig` documented `layers[0]` as bottom-most, `LayerManager.mountAll`
mounted in array order and MapLibre appends each new layer on top — so the first entry ended up
lowest, while the TOC renders it first (visually topmost). Every consumer of that order (feature
info hit order, legend order, the coming drag-reorder) inherited the inversion.

**Fix.** The tree is the single source of truth for z-order, in the direction the requirements
promise:

- `normalizeConfig` documents `layers[0]` as the **top-most** overlay (`defaults.ts`).
- `mountAll` mounts **bottom-up** (`[...layers].reverse()`), so the first entry lands on top.
- `LayerManager.state` is emitted in the same top-most-first order, with runtime-added layers —
  which MapLibre appends above everything — **before** the configured tree, not after.
- `queryable` derives its top-most-first order from that list instead of relying on `Map` insertion
  order.
- The TOC renders the “added layers” block above the configured tree, so the panel keeps matching
  the map.

`packages/core/src/layers.ts` exports `drawOrder()`/`stackOrder()` as pure functions so the contract
is unit-tested without a browser.

## R2 · Web-component lifecycle [P1] ✅

**Claim.** `disconnectedCallback` tears everything down but nothing re-initializes on reconnect, and
an in-flight `init()` can attach a core to an element that was removed or re-configured meanwhile.

**Verdict: valid.** `firstUpdated()` runs once per element, so a DOM move (SPA route change, tab
switch, CMS re-render) left a dead element behind. `init()` awaits config fetch, engine import and
`createCore()` without ever re-checking that it is still the current initialization.

**Fix.**

- A monotonic `generation` token, bumped by every `teardown()`. `init()` captures it, re-checks after
  each await, and destroys a core that finished after its generation was retired.
- `connectedCallback()` re-arms the element symmetrically: eager configs start again, lazy ones get a
  fresh `IntersectionObserver`.
- `teardown()` now also drops the measure controller, the pending search request/timer and the
  transient UI state, so a reconnect starts from a clean slate instead of reusing destroyed objects.

## R3 · Configuration as a system boundary [P1] 🟡

**Claim.** The hand-written validator mostly checks type discriminators and a few required fields;
unique ids, nested shapes, unknown keys and the promised HTTPS policy (N6) are missing, so errors
surface at mount time instead of at validation time.

**Verdict: valid.** Confirmed for all four gaps. Additionally `normalizeConfig` never registered
*explicit* basemap ids in its id pool, so a generated id could silently collide with one.

**Fix (this change).**

- Duplicate explicit ids across basemaps **and** layers are a validation error (they share one id
  namespace, because permalink and the share state address both by id).
- Nested shapes are validated: `meta`, `map.hash`, basemap fields, common layer fields
  (`title`/`visible`/`minZoom`/`maxZoom`/`bounds`/`metadata`/`attribution`), `controls.*`,
  `theme.*`, `i18n.*`, `print.*`, `search.*`, `permalink`.
- Unknown keys are rejected at every level (typos are the most common config bug and used to fail
  silently).
- **HTTPS policy (N6):** `http://` URLs are rejected — except on loopback hosts, and except when the
  embedding page is itself served over plain `http:` (intranet deployments). The message names the
  offending path.
- `normalizeConfig` registers explicit ids in the id pool before generating any.

**Open.** The published JSON Schema (`$schema` target, M1 exit criterion) is *not* part of this
change. It is a separate artifact that has to be generated from the same source of truth as the
validator to stay in sync — tracked in [07-roadmap.md](07-roadmap.md).

## R4 · SSR safety of the package entry [P1] ✅

**Claim.** `packages/ui/src/index.ts` touches `customElements` at module scope, so importing the
package in an SSR/prerender environment throws before a viewer even exists.

**Verdict: valid.**

**Fix.** Registration is guarded by a DOM check and additionally exposed as `defineMap0Viewer()` for
callers that want to control *when* (and under which tag) the element is defined.

**That was not enough** — see R8: the guard sits behind a static import of the element module, which
a server never survives long enough to reach.

## R5 · Permalink parameter collides between instances [P2] ✅

**Claim.** Every instance defaults to the same `map0` hash parameter and writes it independently, so
two viewers with permalinks overwrite each other.

**Verdict: valid.**

**Fix.** The core claims its hash parameter in a page-wide registry. A second instance asking for an
already-claimed parameter transparently gets `map0-2`, `map0-3`, … and logs a warning naming the
config key to set (`permalink.param`) for stable share links. The claim is released in `destroy()`,
so teardown/re-init keeps the same parameter. Explicit unique parameters remain the documented way.

## R6 · Adapter lifecycle and error observability [P2] ✅

**Claim.** Adapters register MapLibre listeners in `trackStatus()` and never remove them in
`unmount()`; general MapLibre errors are only `console.warn`ed although the architecture promises a
consistent `map0:error` signal.

**Verdict: valid.** Both. Runtime add/remove churn (F3.1/F3.3) accumulated dead listeners, each
holding its adapter alive.

**Fix.**

- `SourceAdapter` gained a `listen()` helper that records every registration; `unmount()` runs the
  disposers and marks the adapter unmounted.
- `LayerManager.removeLayer()` also unsubscribes the adapter's status signal, and `destroy()` detaches
  the manager's own zoom listener.
- Map-level errors are emitted as `error` on the core emitter (and re-emitted as `map0:error` by the
  component) in addition to the console warning, carrying the source id when MapLibre provides one.

## R7 · The riskiest area is not in CI [P2] ✅

**Claim.** Unit tests and typecheck cover schema and pure core logic only; component lifecycle,
shadow DOM and the *built* bundle are verified by hand, although the engineering notes document
several “only broken in the built bundle” failures.

**Verdict: valid.**

**Fix.** `e2e/smoke.mjs` — a deterministic, network-free browser smoke test that runs against the
**built** bundle in CI (`pnpm smoke`, wired into `.github/workflows/ci.yml` after `pnpm build`):

1. the element upgrades from the built bundle and `map0:ready` fires,
2. the configured layer order matches the map's real z-order — as MapLibre's layer list *and* as its
   hit test at the map centre (the R1 contract),
3. a runtime-added layer lands above the configured tree and heads the panel (also R1),
4. removing and re-inserting the element re-initializes it (the R2 contract),
5. an invalid config renders the error panel and emits `map0:error`,
6. no console errors, no page errors.

It uses an `empty` basemap plus inline GeoJSON, so it needs no network and no external service — the
live-service checks stay in `e2e/verify-demos.mjs`. R8–R11 added five more checks (SSR import in
Node, the package's `node` export condition, unknown-key warning, config-source swap).

The suite was validated the only way a test suite can be: it was run against the **pre-fix** build,
where it failed exactly the three checks belonging to R1 and R2, and passes fully after.

---

# Second round

## R8 · The SSR guard is too late [P1] ✅

**Claim.** `packages/ui/src/index.ts` imports `Map0Viewer` statically, so Lit derives a class from
`HTMLElement` before the `customElements` guard is ever reached. Importing the production bundle in
Node still ends in `ReferenceError: HTMLElement is not defined`.

**Verdict: valid.** Confirmed by importing `packages/ui/dist/map0.js` in Node. A guard cannot fix
this: the class declaration is evaluated at import time. The first fix only removed the *second*
crash, not the first.

**Fix.** Two entries, as the review suggested:

- `packages/ui/src/index.ts` stays the browser entry — synchronous API, defines the element on
  import, unchanged for the script-tag embed.
- `packages/ui/src/ssr.ts` → `dist/map0-ssr.js` imports nothing from the DOM side. It re-exports the
  schema (config types, `validateConfig`, `normalizeConfig` — all useful while rendering) and reaches
  the viewer through `import()`, which only ever runs in a browser: `defineMap0Viewer()` returns
  `false` on a server instead of throwing.
- The npm package resolves `"."` to the SSR entry under the **`node` condition** and offers it as
  `map0-viewer/ssr`. An SSR framework importing the package by name no longer crashes; a browser
  build still gets the element entry.

`pnpm smoke` now imports the built SSR entry in Node and asserts the export map, so this cannot
silently regress.

## R9 · Unknown keys became fatal [P1] ✅

**Claim.** R3 put unknown keys into `errors`, which makes `valid === false` and refuses the map —
against C5 ("unknown keys → console warning, not failure"), a Must requirement.

**Verdict: valid.** A self-inflicted regression: forward compatibility was traded for strictness
without noticing that the requirement decides the trade-off.

**Fix.** `ValidationResult` carries `warnings` next to `errors`. Unknown keys are warnings — they do
not affect `valid`, the message says the key is ignored, and the component logs them to the console
on load. Everything else (shapes, enums, ids, https) stays fatal. A config written for a newer map0
opens again, which is the point of the `version` field.

## R10 · A higher-priority config source did not reload [P1] ✅

**Claim.** The reload guard looked at the *previous* value via `changed.get(...)`, so a viewer
started from `config-src` that is later handed a `config` object — the old value being `undefined` —
ignored the change. Same for a `config-src` appearing over an inline config.

**Verdict: valid.** The guard answered "did this property change from something?" when the question
is "would the viewer pick a different source now?".

**Fix.** `loadRawConfig()` records which source it consumed (`config` / `configSrc` / inline, plus
the value). `updated()` compares that against `currentSource()` — the source the documented
first-match-wins order would pick right now — and reloads when they differ. The initial assignment
still does not reload, because it *is* the source being consumed.

## R11 · A failed core leaks its permalink claim [P2] ✅

**Claim.** The hash parameter is claimed before the basemap style is fetched, but released only in
`destroy()`. If `resolveBasemapStyle()` or the map constructor throws, there is no core to destroy,
so a retry wrongly gets `map0-2`.

**Verdict: valid.**

**Fix.** `createCore()` is now a thin wrapper that claims the parameter and rolls the claim back if
the core never comes into existence; `buildCore()` holds the actual construction. Covered by a unit
test that fails the style fetch against a refused port and then asserts the name is free again.
