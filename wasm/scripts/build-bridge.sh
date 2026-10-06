#!/usr/bin/env bash
# Build the embind bridge against the OCCT static libs and copy output to the web app.
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

emcmake cmake -S "$WASM_DIR" -B "$WASM_DIR/build" -DCMAKE_BUILD_TYPE=Release \
  -DOpenCASCADE_DIR="$OCCT_INSTALL/lib/cmake/opencascade" -DTKJT_SRC="$TKJT_SRC" -DXZ_INSTALL="$XZ_INSTALL" >/dev/null
cmake --build "$WASM_DIR/build" -j

OUT="$WASM_DIR/../web/public/occt"
mkdir -p "$OUT"
cp "$WASM_DIR/build/occt-viewer.js" "$WASM_DIR/build/occt-viewer.wasm" "$OUT/"
ls -lh "$OUT"
