#!/usr/bin/env bash
# Build the embind bridge against the OCCT static libs and copy output to the web app.
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

# Font for drawn PMI text: osifont (ISO 3098 lettering), LGPL-3 with font exception. Pinned here, not
# in env.sh, whose hash keys the CI caches of the slow OCCT and JT builds.
OSIFONT_COMMIT="2e9aa86a8a09b044e08c00f5a4a2505dc3ca9f6e"
OSIFONT_SHA256="81880ba0a1ba2e15752f5ec536f227a69bec98b73ae8200780804b66750320b6"
PMI_FONT="$DEPS_DIR/osifont-$OSIFONT_COMMIT/osifont-lgpl3fe.ttf"
if [ ! -f "$PMI_FONT" ]; then
  mkdir -p "$(dirname "$PMI_FONT")"
  curl -fsSL -o "$PMI_FONT.tmp" "https://raw.githubusercontent.com/hikikomori82/osifont/$OSIFONT_COMMIT/osifont-lgpl3fe.ttf"
  echo "$OSIFONT_SHA256  $PMI_FONT.tmp" | shasum -a 256 -c --quiet
  mv "$PMI_FONT.tmp" "$PMI_FONT"
fi

emcmake cmake -S "$WASM_DIR" -B "$WASM_DIR/build" -DCMAKE_BUILD_TYPE=Release \
  -DOpenCASCADE_DIR="$OCCT_INSTALL/lib/cmake/opencascade" -DTKJT_SRC="$TKJT_SRC" -DXZ_INSTALL="$XZ_INSTALL" \
  -DPMI_FONT="$PMI_FONT" >/dev/null
cmake --build "$WASM_DIR/build" -j

OUT="$WASM_DIR/../web/public/occt"
mkdir -p "$OUT"
cp "$WASM_DIR/build/occt-viewer.js" "$WASM_DIR/build/occt-viewer.wasm" "$OUT/"
ls -lh "$OUT"
