# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue:
[open a security advisory](https://github.com/SpatialFocus/map0/security/advisories/new) on
GitHub. You will get an acknowledgement within a few days.

Please include what triggers the problem — a config, a page, a service URL or a response —
and what you believe the impact is.

## Scope

- The `map0-viewer` npm package and its bundle (everything under `packages/`). Of particular
  interest: anything that lets a config, a popup template or a response from a map service
  run script or escape the sanitiser — the config is data, never code, and everything rendered
  as HTML is sanitised ([docs/09](docs/09-engineering-notes.md), invariants 3 and 4).
- The demo site at [map0.net](https://map0.net) (`site/`).

Out of scope: the third-party map services the demos point at, which belong to their
operators, and MapLibre GL JS itself — please report those upstream.

## Supported versions

The latest release on npm receives fixes. There are no maintained older lines before 1.0.

## Fixes

A fix ships as a patch release of `map0-viewer`; the changelog links the advisory once it is
public.
