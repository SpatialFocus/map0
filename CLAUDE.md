# map0

## Before committing

Run the fast CI checks locally and commit once all three pass:

```bash
pnpm typecheck
pnpm test
pnpm build
```

- `pnpm test` (vitest) strips types without checking them, so a green test run says nothing about types. `pnpm typecheck` is the type gate.
- After pulling, merging or switching branches, run `pnpm install --frozen-lockfile` first. With stale `node_modules`, `tsc --build` reports dozens of unrelated errors (missing `lit`, `@map0/*`) and the real one drowns in them.
- A dependency bump touches every package whose `src` imports it: `grep -rl "<dependency>" packages/*/src`. That includes packages that get the dependency through another workspace package and so do not list it in their `package.json`.
