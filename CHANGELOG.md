# Changelog

Releases of the `map0-viewer` npm package. Generated from the
[conventional commits](https://www.conventionalcommits.org) by `pnpm release` (release-it) —
do not edit by hand.

## [0.0.5](https://github.com/SpatialFocus/map0/compare/v0.0.4...v0.0.5) (2026-08-19)

### Features

* COG DEM hillshade ([0842621](https://github.com/SpatialFocus/map0/commit/0842621f2d8f6bb29fc26ae0c66075238dd4021e))
* COG layer type — RGB imagery and single-band color ramps ([324dc30](https://github.com/SpatialFocus/map0/commit/324dc3049921c32aeb3495969d7ba87521b9f09c))
* **site:** imprint & privacy pages, one shared topbar and footer ([10c7edb](https://github.com/SpatialFocus/map0/commit/10c7edb34c8e47888fdc5e6d1ac810242494426f))

### Bug Fixes

* **core:** copy only source-valid TileJSON keys when inlining basemap sources ([2302047](https://github.com/SpatialFocus/map0/commit/23020471a293feb519c22507163ddc49fb65f522))

## [0.0.4](https://github.com/SpatialFocus/map0/compare/v0.0.3...v0.0.4) (2026-08-18)

### Bug Fixes

* **test:** legend url test ([a8fdc32](https://github.com/SpatialFocus/map0/commit/a8fdc32093a85c7719e39469eb144a84c8df63ac))
* **ui:** legend graphics normalized ([6dbaa7b](https://github.com/SpatialFocus/map0/commit/6dbaa7b039399b78140407bfa849c4425fab4afd))
* **ui:** theme the MapLibre control buttons ([21f22e2](https://github.com/SpatialFocus/map0/commit/21f22e211696f48c6a8e61dba049ef163d2396ac))

## [0.0.3](https://github.com/SpatialFocus/map0/compare/v0.0.2...v0.0.3) (2026-08-18)

### Bug Fixes

* **wmts:** clip tile requests to the layer's TileMatrixSetLimits ([2c92bc4](https://github.com/SpatialFocus/map0/commit/2c92bc4d79a4e465fe541463afd239f9718c7dcb))

## [0.0.2](https://github.com/SpatialFocus/map0/compare/v0.0.1...v0.0.2) (2026-08-17)

### Bug Fixes

* address the P1/P2 review findings (R1–R6) ([4c3a6f6](https://github.com/SpatialFocus/map0/commit/4c3a6f6d1fb3da1f1e935cda7386e404ad7ee5d2))
* close the second review round (R8–R11) ([8aaa4dd](https://github.com/SpatialFocus/map0/commit/8aaa4ddc2f109f717a3d07e0e91af818d9aadefb))
* **ui:** survive a disconnect during a scheduled reload (R12) ([62d6518](https://github.com/SpatialFocus/map0/commit/62d6518606d1f6539b72802b4221ba6c38395d86))
* **wmts:** never feed a vector tile to a raster source ([1602cbf](https://github.com/SpatialFocus/map0/commit/1602cbf5abd62e678439eed48b083652bda2cea3))

## [0.0.1](https://github.com/SpatialFocus/map0/compare/2662f301b23d8904bfb273daa4f87a231cec144c...v0.0.1) (2026-08-17)

### Features

* added umami analytics on released pages ([4381811](https://github.com/SpatialFocus/map0/commit/43818112204857f9be5569d4e60a390356b33667))
* build and deploy the demo site (O-04) ([3b936e5](https://github.com/SpatialFocus/map0/commit/3b936e5f5ae244e3d6a885323f020cf46cf6cfa7))
* **core:** WMTS layer type resolved from capabilities ([1c9113b](https://github.com/SpatialFocus/map0/commit/1c9113bb203ef3edbfae9f445c0e12486138744e))
* **demos:** move demos to /demos as single-topic pages with docs ([2988410](https://github.com/SpatialFocus/map0/commit/2988410b088a458f8bf20a92a4375e4376624a04))
* hover tooltips, selection highlight, zoom-to-layer ([874fa5c](https://github.com/SpatialFocus/map0/commit/874fa5cdd504cf876e6d26fc9bc4f650e6703e2f))
* **i18n:** UI string overrides from config (F11.2) ([78b49be](https://github.com/SpatialFocus/map0/commit/78b49be9f4c5c58b7fa74598c361754ceebfeb4b))
* Landing page ([69e5c32](https://github.com/SpatialFocus/map0/commit/69e5c3237b5af22e24c0d1adc4505b848599c5f8))
* legend panel, add-layer dialog, client-side print/export ([e58493b](https://github.com/SpatialFocus/map0/commit/e58493b73ffa93b6eccc2d5dd4a7fc04247a78e7))
* M0 spike — walking skeleton for the map0 web map client ([2662f30](https://github.com/SpatialFocus/map0/commit/2662f301b23d8904bfb273daa4f87a231cec144c))
* measure distance and area on the sphere (F9.1) ([383633f](https://github.com/SpatialFocus/map0/commit/383633fdb784293b34b602bc30f9161ab68d3ab4))
* multi-CRS coordinate readout on right-click/long-press (F5.6) ([4a1f729](https://github.com/SpatialFocus/map0/commit/4a1f7299010933a34960a2e280ab865370dda055))
* PDF export and a configurable print sheet (F7.3) ([cff5830](https://github.com/SpatialFocus/map0/commit/cff5830de962b65b2fc365eb186d173e4d03af16))
* place and address search with pluggable geocoders (F8.1, F8.2) ([3dcf25a](https://github.com/SpatialFocus/map0/commit/3dcf25adade71a20b15e8d326e008b064d501e60))
* publishable npm package `map0` (MIT, prebuilt bundle) ([82b3983](https://github.com/SpatialFocus/map0/commit/82b39839a6f53b5ad3f15ab79ceb069591b40ac6))
* **schema:** config inheritance via extends (C6) ([b407a93](https://github.com/SpatialFocus/map0/commit/b407a93c86a1c13e900444d99a636c7c277f8289))
* shareable map state in the URL (F10.1) ([8679d8c](https://github.com/SpatialFocus/map0/commit/8679d8c3b705ee091bb9b710f80c8c26f83e9657))
* **ui:** transient notice toasts for layer errors ([b730205](https://github.com/SpatialFocus/map0/commit/b730205cac8067a6d56a5fd60351f778804c0923))
* **ui:** trap focus in dialogs, close on Escape (N4) ([2ba4898](https://github.com/SpatialFocus/map0/commit/2ba489879ec11a77a46c442b520da1a83bc6ed15))

### Bug Fixes

* **core:** no legend swatches for a defaulted style ([cc71f2a](https://github.com/SpatialFocus/map0/commit/cc71f2ab24ff030b0067936febf3e5ee9b2ceb48))
* **core:** resolve TileJSON for vector overlays, cache live WMTS host ([7f13fc7](https://github.com/SpatialFocus/map0/commit/7f13fc7ca1777e637b22413d78649c7fa8f88fb2))
* **demos:** native UI font in the theming demo ([22dcafe](https://github.com/SpatialFocus/map0/commit/22dcafe0dc67748dd17006e7936d644518e8a89a))
* publish as `map0-viewer` — npm blocks the unscoped `map0` ([4555847](https://github.com/SpatialFocus/map0/commit/45558472ca21b1d42aa203de29dcb8818dc5d19a))
* **ui:** show zoom-range hints in the TOC instead of silent invisibility ([bb82028](https://github.com/SpatialFocus/map0/commit/bb82028d067d20e3539175105ca4703cdc8058b0))
* Vite includes ([883429f](https://github.com/SpatialFocus/map0/commit/883429fee1931790dea0a2b0231f499fb5d09f1d))

### Performance Improvements

* **build:** code-split lazy features, ship MapLibre verbatim ([ef04228](https://github.com/SpatialFocus/map0/commit/ef04228747487b788afd7fd6bf2f6814e12c43b0))
* **ui:** defer the engine and MapLibre until the map is in view ([d6f6d7a](https://github.com/SpatialFocus/map0/commit/d6f6d7a9cb00719341c678104c5169c0eb1f5a56))
