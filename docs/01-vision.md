# 01 — Vision & Goals

> Status: draft · 2026-08-14 · **map0**

## Problem

Public-sector SDIs (spatial data infrastructures) constantly need maps embedded in ordinary web pages:
a district heating map on a city page, a protected-areas viewer on an environment portal, a project
map inside a CMS article. Today the options are all unsatisfying:

- **Full geoportals** (MapStore, Oskari, …) are their own applications. Embedding them into an
  existing website effectively means an `<iframe>`, a separate backend, and a foreign UI.
- **Config-driven frameworks** (Masterportal, Mapbender, QWC2, …) get the philosophy right —
  everything is configuration, not code — but are heavyweight to set up (multiple interdependent
  config files, service registries, build steps), are built on older UI stacks, and look dated.
- **Raw mapping libraries** (MapLibre GL JS, OpenLayers, Leaflet) render beautifully but are *libraries*:
  every TOC, legend, popup and print button is a custom development project, re-built per website.

What is missing is the middle layer: a **real web map client** — TOC, legends, feature info, print,
GPS, layer management — that a CMS editor can drop onto any page and configure **entirely with one
JSON document**, no build step, no backend, no iframe.

## Vision statement

> **map0 is a modern, beautiful, embeddable web map client built on MapLibre GL JS.
> One script tag + one JSON config = a full-featured map on any web page.**

MapLibre already made the *cartography* declarative (the style spec is JSON). map0 extends the same
idea to the *client*: basemaps, overlay tree, controls, popups, legends, print, theming — all
declared in a single, schema-validated JSON document that lives happily in a CMS field.

## Target users

| Persona | Needs |
|---|---|
| **SDI operator / geo data manager** | Publish OGC services & vector tiles as usable maps; consistent client across many portals; metadata links back to the catalog. |
| **CMS editor (non-GIS)** | Paste/adjust a JSON config (or later: use a visual editor) on a page; tweak title, layers, colors; never touch code. |
| **Web developer / integrator** | Clean JS API and events, theming hooks, framework-agnostic packaging, painless npm/CDN install. |
| **Citizen / site visitor** | Fast, attractive, intuitive, responsive map that works on the phone; accessible. |

## Design principles

1. **Config-first.** Every feature must be reachable from JSON config. If it can't be configured, it doesn't ship.
2. **One document.** A single JSON config per map. No `services.json`/`rest-services.json`/`config.js` constellations (the Masterportal lesson). Reuse across maps is achieved by referencing shared config URLs, not by mandatory registries.
3. **Embeddable, not a portal.** map0 renders into a `<div>` on someone else's page. No iframe, no backend requirement, no router, multiple instances per page allowed.
4. **Sane defaults, progressive depth.** A config with nothing but a style URL must yield a working, pretty map. Every additional key adds capability; nothing is mandatory boilerplate.
5. **MapLibre-native.** Use MapLibre's strengths (vector tiles, style spec, globe, GPU rendering) directly; don't wrap them away. The MapLibre style spec remains the styling language for vector data.
6. **Beautiful by default.** Design-quality UI, light/dark, responsive from 320 px to 4K, smooth micro-interactions. "Looks like 2026, not 2012."
7. **Serverless core.** The client itself needs only static hosting. Optional server components (print service, proxy, catalog) are add-ons, never prerequisites.
8. **Open.** Open source, permissive license, standard tooling, documented JSON Schema, semver.

## Non-goals (v1)

- Not a **geoportal platform**: no user accounts, no saved maps backend, no catalog server, no admin backend.
- Not a **GIS editor**: no feature editing/WFS-T in v1 (drawing/measuring may come as modules later).
- Not a **general-purpose projection engine**: MapLibre renders Web Mercator (+ globe). Native rendering of national CRS grids is out of scope (see decision D-02).
- Not a **CMS plugin zoo**: we ship one framework-agnostic embed (plus optional wrappers), not 15 CMS-specific plugins.
- No **3D city model / mesh** ambitions in v1 (terrain is on the roadmap; full 3D buildings à la VC Map is not).

## Positioning

| | Masterportal | MapStore | **map0** |
|---|---|---|---|
| Engine | OpenLayers | OpenLayers/Cesium | MapLibre GL JS |
| Character | Full portal framework | Full portal application | Embeddable client component |
| Config | Multiple JSON files + JS, service registry | Backend/DB + JSON contexts | **One JSON document** |
| Embedding on a CMS page | Possible but heavy | Practically iframe-only | **Native: script tag + custom element** |
| Backend required | No, but complex static setup | Yes (Java) | **No** |
| UI | Bootstrap-era, functional | Portal-style | Modern, themable, responsive |
| Globe/3D | Cesium integration (heavy) | Cesium | MapLibre globe (built-in) |

## Success criteria

1. **Time-to-map:** a newcomer gets a styled map with a WMS overlay + popup on a plain HTML page in **< 15 minutes** using only the docs.
2. **Config coverage:** 100 % of shipped features controllable via the JSON config; config validated against a published JSON Schema with helpful error messages.
3. **Footprint:** core bundle (excl. MapLibre) small enough for CMS use — target ≤ ~100 KB gzip, feature modules lazy-loaded.
4. **Real-world proof:** at least 3 production-like demo configs against live Austrian SDI services (basemap.at vector tiles, a state WMS with GetFeatureInfo + legend, a GeoJSON/PMTiles dataset).
5. **Quality:** WCAG 2.1 AA for the UI, keyboard-operable TOC, automated visual regression on demo configs.
