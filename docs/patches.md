# Patches to OCCT and TKJT

OCCT and TKJT are downloaded at pinned versions (`wasm/scripts/env.sh`) and patched by the build:
`build-occt.sh` applies `wasm/patches/occt-*.patch`, `build-jt-deps.sh` applies `wasm/patches/tkjt-*.patch`.

## How patches are applied

Patches apply in glob (alphabetical) order. A patch is skipped when `git apply --reverse --check`
succeeds, so the scripts can be rerun on an already patched tree. That only works if each patch's hunks
stay more than 3 lines (the diff context) away from every other patch's hunks; otherwise a rerun tries
to apply a patch again and fails.

## Writing or changing a patch

1. Make the change in the source tree under `wasm/.deps/` (e.g. `occt-src-V8_0_1`).
2. Generate the patch as a diff against HEAD plus every *other* patch, so it contains only its own change:

   ```sh
   cd wasm/.deps/occt-src-V8_0_1
   export GIT_INDEX_FILE=$(mktemp -u)
   git read-tree HEAD
   for p in ../../patches/occt-*.patch; do
     [ "$p" = ../../patches/occt-mine.patch ] || git apply --cached "$p"
   done
   git add -N path/to/new/files   # if the patch adds files
   git diff > ../../patches/occt-mine.patch
   unset GIT_INDEX_FILE
   ```

3. Check that all patches apply on a clean tree: `git worktree add` a fresh checkout of the pinned tag
   and `git apply --check` each patch in order.
4. Rebuild: `build-occt.sh` (or `build-jt-deps.sh`), then `build-bridge.sh`.

## Fast rebuild while debugging one OCCT toolkit

Rebuild just that toolkit, install it, and relink the bridge (~6 s for TKMesh):

```sh
source wasm/scripts/env.sh && source "$EMSDK_DIR/emsdk_env.sh"
cmake --build "$OCCT_BUILD" --target TKMesh && cmake --install "$OCCT_BUILD"
wasm/scripts/build-bridge.sh
```

A single face can be written with `BRepTools::Write` and loaded through the bridge as a `.brep` file to
reproduce a meshing problem in isolation.

## Upstream reports

Bugs found in OCCT get a draft report in the git-ignored `occt-issues/occt-issue-<area>-<topic>.md`
(repro files in a folder of the same name): Summary, Example, Reproduction (Expected/Actual), Proposed
fix (the diff), and the OCCT version reproduced with and whether `master` still has the code, with a date.
