# Functional review, 2026-09-09

Scope: existing functionality on `main` and the remaining `feat/formats` changes,
after the earlier OGC API, WFS, GeoParquet integer and cluster fixes.

The review covered layer loading and state, basemap switching, WMS/WMTS requests,
feature queries, search, share links, local file import, coordinate conversion,
measurement, popup and bottom-sheet interaction, export code and package contracts.
The fixes below address reproducible failures. This is not a guarantee that every
external service, projection or device behaves identically.

| Area | Failure | Correction |
|---|---|---|
| WMS requests | Pasted operation parameters could coexist with generated parameters under different casing. A fragment could swallow the tile BBOX. | Replace operation parameters case-insensitively; serialize the BBOX before the fragment and retain its MapLibre placeholder. |
| WMTS requests | A KVP capabilities URL could retain `request=GetCapabilities`; appended tile parameters after a fragment were never sent. | Merge KVP parameters through the URL parser and retain literal tile placeholders. |
| Basemap switching | Selecting the current basemap did not cancel a pending switch. A late result could modify a destroyed map. | Invalidate older switches on reselection and destruction. |
| Basemap errors | The public `setBasemap()` wrapper left rejected requests unhandled. | Emit the existing error event and keep the current map. |
| Concurrent layers | Two additions with the same title could reserve the same source ID. | Reserve IDs before asynchronous mounting. |
| Failed or interrupted mounting | Partial sources survived a failed addition, and completed loads could repopulate a destroyed manager. | Remove partial adapters and ignore completion after destruction. |
| Layer ordering | `api.layers.all` exposed insertion order despite promising the visible stack order. | Return handles in the same order as the layer panel. |
| Queries outside zoom range | WMS layers outside their configured zoom range still answered clicks. | Apply the zoom range when selecting queryable adapters. |
| Opacity | Moving the slider replaced per-feature opacity expressions with a constant. | Multiply the original expression and restore it at full opacity. |
| Shared state | Malformed view or layer state could prevent startup. Added URL layers lost their current visibility and opacity when shared. | Validate decoded state and export current runtime values. |
| Search | Relative provider URLs failed; late answers could reopen a dismissed search or outlive the viewer. | Resolve provider URLs against the page and invalidate pending results immediately on input, dismissal, selection and teardown. |
| Add-layer dialog | Old capabilities could populate a new URL or service selection. Failed additions closed without explaining the failure. | Associate results with the initiating request, ignore obsolete results and retain a readable error. The same cancellation applies to GeoJSON URL checks. |
| Measurement | Rings crossing the date line measured nearly the whole world; labels appeared near Greenwich. | Use the shorter longitude difference for area and label placement. |
| Measurement lifecycle | Stopping during a vertex drag could leave map panning disabled and a release listener active. | Restore the previous interaction settings and remove the drag listener. |
| Touch coordinates | A second touch overwrote the timer reference, leaving an older long-press timer alive. | Cancel long press on multitouch, movement, release and teardown. |
| Pending feature info | Answers arriving after teardown or after measuring started could restore a popup or highlight. | Invalidate pending clicks on disposal and respect the interaction lock when answers arrive. |

Regression coverage lives in `packages/core/src/review-regressions.test.ts`,
`packages/core/src/interaction-lifecycle.test.ts`, `packages/core/src/featureinfo.test.ts`
and `e2e/review-regressions.mjs` (run by `pnpm smoke`). Browser checks use the built
bundle and local fixtures, including deliberately delayed service responses.
Live WMS/WMTS servers and physical touch devices were not exercised in this round.

Final validation: 286 unit/schema tests, 61 browser smoke checks and 11 packed-package
type checks passed. `pnpm typecheck`, `pnpm build:npm` and `pnpm size` passed;
the initial page bundle is 34.2 KB gzip against the 40 KB budget.
