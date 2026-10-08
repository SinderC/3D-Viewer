# Open CAD Viewer

Browser-based 3D viewer for CAD and mesh files: STEP, IGES, BREP, JT, glTF/GLB, OBJ, STL and VRML.
Geometry is read and tessellated by
[Open CASCADE Technology](https://dev.opencascade.org/) compiled to WebAssembly; JT is read by TKJT
(from [PyOpenJt](https://github.com/jriegel/PyOpenJt)). Files are processed
entirely in the browser and never uploaded: the production build ships a Content-Security-Policy that
only allows requests to the app's own origin. After the first visit the app works offline (PWA).

## Features

- STEP AP203 (ed1/ed2), AP214, AP242 (ed1–ed3), including AP242 tessellated geometry
- STEP AP242 PMI: dimensions, geometric tolerances, datums and notes as drawn in the file (lines
  and filled text), listed per item with show/hide, the referenced faces and the semantic values
  (type, nominal, tolerances, datums) of the selected item; saved views (direction, up and the
  PMI they show; OCCT keeps no camera position, so a view frames the model and its PMI)
- IGES and OCCT BREP (B-rep: all measurements work)
- JT 8, 9 and 10 (ISO 14306, incl. JT 10.5): tessellated geometry, assembly structure, instances,
  material colours, finest LOD only. Parts that embed their exact B-rep as Parasolid XT data get its
  edges (feature edges; exact edge length / radius / diameter); faces stay the JT mesh. No JT B-rep,
  no external part files
- JT 10 PMI as drawn in the file (lines, arrowheads and font glyphs), per part and for the model,
  with their saved views; JT 8 and 9 files get their saved views only. No semantic values and no
  referenced faces for JT PMI
- glTF/GLB, OBJ, STL, VRML (meshes: point-to-point distance only, no feature edges). glTF is read
  in metres; OBJ, STL and VRML carry no reliable unit and are read as mm. A `.gltf` must embed its
  buffers (or use `.glb`); external `.bin`/`.mtl` files are not loaded
- Assembly tree with show/hide/isolate, colours from the file, feature edges (B-rep formats and JT
  with XT data)
- Pick to select, X/Y/Z section plane with solid caps
- Measure: edge length / radius / diameter, distance between points (vertex snapping), distance and
  angle between planar faces; display in mm, cm, m, in, ft or ft-in (1/16")
- Fit all / zoom to selection, six standard views and iso, ViewCube, perspective or orthographic,
  shaded / shaded with edges / wireframe, ground grid
- Installable PWA; when installed (Chromium) it can be the OS handler for the supported extensions

Not yet: section caps, 3MF, PLY, FBX.

## Build

Requirements: git, CMake ≥ 3.20, Python 3, Node ≥ 20.

```sh
wasm/scripts/setup-emsdk.sh    # once: installs the pinned Emscripten SDK into wasm/.emsdk
wasm/scripts/build-occt.sh     # once (~15 min): builds OCCT static libs into wasm/.deps
wasm/scripts/build-jt-deps.sh  # once: fetches TKJT (+ wasm/patches) and builds liblzma
wasm/scripts/build-bridge.sh   # builds wasm/build/occt-viewer.{js,wasm} → web/public/occt/

node wasm/test/smoke.mjs       # loads every supported file under samples/ and prints a summary

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
wasm/src/bridge.cpp       OCCT → mesh bridge (embind): readModel(bytes, fileName, options)
wasm/src/jt_reader.cpp    JT scene graph → XCAF document (via TKJT)
wasm/src/jt_pmi.cpp       JT PMI Manager data → drawn PMI and saved views
wasm/src/xt_reader.cpp    Parasolid XT (neutral binary) → edges, for JT parts with embedded XT data
wasm/patches/             changes to TKJT (JT 10 support and fixes, raw PMI data) and OCCT (STEP PMI fix)
wasm/scripts/             toolchain + build scripts (versions pinned in env.sh)
wasm/test/smoke.mjs       Node smoke test over samples/
web/src/worker/           Web Worker running the WASM module
web/src/viewer/           Three.js scene: rendering, picking, measure, section
web/src/ui/               React UI (toolbar, assembly tree, app state)
```

## Licensing

GPL-2.0-or-later (see LICENSE), because `occt-viewer.wasm` links the JT reader TKJT, which is GPL-2.0+.
Open CASCADE Technology is LGPL-2.1 with an additional exception; its source and the bridge build scripts
are in this repository so the module can be relinked against a modified OCCT. See NOTICE.
