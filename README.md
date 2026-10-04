# STEP Viewer

Browser-based 3D viewer for STEP files (AP203, AP214, AP242). Geometry is read and tessellated by
[Open CASCADE Technology](https://dev.opencascade.org/) compiled to WebAssembly. Files are processed
entirely in the browser and never uploaded: the production build ships a Content-Security-Policy that
only allows requests to the app's own origin. After the first visit the app works offline (PWA).

## Features

- STEP AP203 (ed1/ed2), AP214, AP242 (ed1–ed3), including AP242 tessellated geometry
- Assembly tree with show/hide/isolate, STEP colours, feature edges
- Pick to select, point-to-point measure (with vertex snapping), X/Y/Z section plane
- Fit / iso / front / top / right views, perspective or orthographic
- Installable PWA; when installed (Chromium) it can be the OS handler for `.stp`/`.step`

Not yet: PMI (graphical/semantic), section caps, JT.

## Build

Requirements: git, CMake ≥ 3.20, Python 3, Node ≥ 20.

```sh
wasm/scripts/setup-emsdk.sh    # once: installs the pinned Emscripten SDK into wasm/.emsdk
wasm/scripts/build-occt.sh     # once (~15 min): builds OCCT static libs into wasm/.deps
wasm/scripts/build-bridge.sh   # builds wasm/build/occt-viewer.{js,wasm} → web/public/occt/

node wasm/test/smoke.mjs       # loads every .stp under samples/ and prints a summary

cd web
npm install
npm run dev                    # development server
npm test                       # unit tests
npm run build && npm run preview   # production build (with CSP + service worker)
```

## Running offline

WebAssembly cannot be loaded from `file://`, so the app always needs to be served over HTTP once.
After that first load the service worker serves everything from cache with no network. For a
fully local setup, serve `web/dist` with any static server (e.g. `npx serve web/dist`) or install
the PWA from the browser's address bar.

## Layout

```
wasm/src/bridge.cpp       OCCT → mesh bridge (embind): readStep(bytes, options)
wasm/scripts/             toolchain + build scripts (versions pinned in env.sh)
wasm/test/smoke.mjs       Node smoke test over samples/
web/src/worker/           Web Worker running the WASM module
web/src/viewer/           Three.js scene: rendering, picking, measure, section
web/src/ui/               React UI (toolbar, assembly tree, app state)
```

## Licensing

Open CASCADE Technology is LGPL-2.1 with an additional exception. It is shipped as a separate,
replaceable `occt-viewer.wasm`, and the bridge source and build scripts are in this repository so it can
be relinked against a modified OCCT. See NOTICE.
