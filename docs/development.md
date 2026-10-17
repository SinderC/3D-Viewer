# Development

## Requirements

git, CMake ≥ 3.20, Python 3, Node ≥ 20. Toolchain and library versions are pinned in
`wasm/scripts/env.sh`.

## Build

```sh
wasm/scripts/setup-emsdk.sh    # once: installs the pinned Emscripten SDK into wasm/.emsdk
wasm/scripts/build-occt.sh     # once (~15 min): builds OCCT static libs into wasm/.deps
wasm/scripts/build-jt-deps.sh  # once: fetches TKJT (+ wasm/patches) and builds liblzma
wasm/scripts/build-bridge.sh   # builds wasm/build/occt-viewer.{js,wasm} → web/public/occt/

cd web
npm install
npm run dev                         # development server
npm run build && npm run preview    # production build, with CSP and service worker
```

Rerun `build-bridge.sh` after changing anything under `wasm/src`. Rerun `build-occt.sh` or
`build-jt-deps.sh` after changing the pinned versions or their patches.

## Tests

```sh
cd web && npm test                # unit tests (vitest)
node wasm/test/smoke.mjs [path…]  # loads every OCCT-read file under samples/ (or the given paths) and prints a summary
node wasm/test/step-coverage.mjs  # writes small STEP files for features beyond plain B-rep and checks what is read
```

`samples/` is not in the repository; supply your own files. `DUMP=samples/step-coverage` makes the
coverage test write its files there so the smoke test loads them too.

## Running offline

WebAssembly cannot be loaded from `file://`, so the app has to be served over HTTP at least once.
After that the service worker serves everything from cache. For a fully local setup, serve
`web/dist` with any static server (e.g. `npx serve web/dist`) or install the PWA from the browser.

## Deployment

`.github/workflows/pages.yml` builds the WASM module, runs the unit tests and deploys `web/dist` to
GitHub Pages. It runs only on demand: from the Actions tab or `gh workflow run pages.yml`. The
Emscripten SDK, OCCT and JT dependencies are cached and rebuilt only when their scripts, pinned versions
or patches change.

## Code layout

```
wasm/src/bridge.cpp       OCCT → mesh bridge (embind): readModel(bytes, fileName, options)
wasm/src/jt_reader.cpp    JT scene graph → XCAF document (via TKJT)
wasm/src/jt_pmi.cpp       JT PMI Manager data → drawn PMI and saved views
wasm/src/xt_reader.cpp    Parasolid XT (neutral binary) → edges, for JT parts with embedded XT data
wasm/patches/             changes to TKJT (JT 10 support, fixes, raw PMI data) and OCCT (STEP and meshing fixes)
wasm/scripts/             toolchain and build scripts
wasm/test/                Node tests against the built module
web/src/core/             format table, model, units, PMI and product data (no rendering)
web/src/worker/           Web Worker running the WASM module
web/src/viewer/           three.js scene: rendering, picking, measure, section, three.js-read formats
web/src/ui/               React UI: menus, toolbar, model tree, app state, shortcuts
```

Which reader handles a file is decided by `web/src/core/formats.ts`.
