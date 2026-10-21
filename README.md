# Open CAD Viewer

**[Open the viewer](https://sinderc.github.io/3D-Viewer/)**

A 3D viewer for CAD and mesh files that runs in the browser. Files stay on your machine: nothing is
uploaded, and the production build's Content-Security-Policy allows requests to the app's own origin only.
After the first visit it works offline as an installable PWA.

**Formats:** STEP, IGES, BREP, JT, QIF, glTF/GLB, FBX, 3MF, Collada, OBJ, STL, PLY and VRML.
CAD files are read and tessellated by [Open CASCADE Technology](https://dev.opencascade.org/) compiled
to WebAssembly, JT by TKJT (from [PyOpenJt](https://github.com/SinderC/PyOpenJt), a fork of [jriegel/PyOpenJt](https://github.com/jriegel/PyOpenJt)), QIF by a reader
of our own on OCCT, and the other mesh formats by three.js.

**Highlights:** assembly tree, STEP AP242, JT and QIF PMI with saved views, measurement on exact B-rep
geometry, section planes, exploded view, material appearances, STL/GLB export.

## Quick start

Requires git, CMake ≥ 3.20, Python 3 and Node ≥ 20.

```sh
wasm/scripts/setup-emsdk.sh && wasm/scripts/build-occt.sh && wasm/scripts/build-jt-deps.sh  # once, ~15 min
wasm/scripts/build-bridge.sh
cd web && npm install && npm run dev
```

## Documentation

- [Supported formats](docs/formats.md): what is read from each format, and what isn't
- [Using the viewer](docs/usage.md): features, mouse and keyboard, settings
- [Development](docs/development.md): build, tests, deployment, code layout

## License

GPL-3.0-or-later (see [LICENSE](LICENSE)), because the WebAssembly module links TKJT (GPL-2.0-or-later)
and embeds the osifont font (LGPL-3.0, see [LICENSE.LGPL-3.0](LICENSE.LGPL-3.0)) for PMI text.
Open CASCADE Technology is LGPL-2.1 with an additional exception; its build scripts and patches are in
this repository so the module can be relinked against a modified OCCT. Third-party notices are in [NOTICE](NOTICE).
