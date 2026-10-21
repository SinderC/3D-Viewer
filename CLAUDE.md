# Open CAD Viewer

Browser-only CAD/mesh viewer. OCCT (C++, compiled to WASM with Emscripten) reads and tessellates CAD
formats in a Web Worker; three.js renders and reads the mesh formats; React draws the UI. Files never
leave the machine: the production CSP allows the app's own origin only. Do not add network requests.

## Commands

```sh
wasm/scripts/build-bridge.sh       # after any change under wasm/src (needs build-occt/build-jt-deps once)
cd web && npm test                 # vitest unit tests
cd web && npm run build            # tsc -b type check + production build
node wasm/test/smoke.mjs [path…]   # loads files through the built WASM module
node wasm/test/step-coverage.mjs   # STEP features beyond plain B-rep
node wasm/test/qif-coverage.mjs    # QIF semantic PMI
```

Full build, deployment and code layout: [docs/development.md](docs/development.md).

## Where things go

- `web/src/core/formats.ts` decides which reader handles a file (`reader: 'three'` or the OCCT bridge).
  A new format starts there.
- `wasm/src/bridge.cpp`: every OCCT-read format becomes an XCAF document, then one Builder emits JSON +
  one packed geometry buffer. JT, QIF and XT readers are separate files beside it.
- `web/src/core/` has no rendering code; `web/src/viewer/` is three.js; `web/src/ui/` is React.
- Changes to OCCT go in `wasm/patches/`, never in the downloaded sources. TKJT changes are commits in
  the SinderC/PyOpenJt fork (clone at `../PyOpenJt`), pinned by `TKJT_COMMIT` in `wasm/scripts/env.sh`.
  Read [docs/patches.md](docs/patches.md) before adding or editing either.

## Conventions

- TypeScript strict, no linter or formatter: match the surrounding file (single quotes, semicolons,
  lines up to ~120 chars). Tests sit beside the code as `*.test.ts`.
- Comments are short and say why, not what. British spelling in UI text and docs (colour).
- Keep user-facing docs current: `docs/formats.md` (what each format reads), `docs/usage.md`
  (features, shortcuts). Add third-party code or assets to `NOTICE`.
- Mesh quality presets live in `web/src/worker/protocol.ts`; measure triangle count and WASM heap
  (`readModel` returns a `memory` stage log) before changing deflection or batching.

## Local-only folders (git-ignored)

- `samples/`: test models. CI has none, so unit tests must build their own fixtures.
- `backlog/`: issues, managed with the Backlog.md CLI (`backlog task list`, `backlog task create …`).
  Task titles keep old IDs (PMI-01, GEO-10). Don't create markdown issue lists elsewhere.
- `occt-issues/`: draft upstream OCCT bug reports, one `occt-issue-<area>-<topic>.md` each.
- `references/`: specs and reference material.

## Git

- Commit only when asked. Subject `Area: what changed` (e.g. `QIF: review fixes`); the body explains
  what and why, wrapped at ~72 chars, bullets for separate fixes.
- Author is the repo-local identity (SinderC). No Claude attribution or Co-Authored-By lines.
- Deployment is manual: `gh workflow run pages.yml`. Don't trigger it unless asked.
