#!/usr/bin/env bash
# Install the pinned Emscripten SDK into wasm/.emsdk.
set -euo pipefail
source "$(dirname "$0")/env.sh"

if [ ! -d "$EMSDK_DIR" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi
"$EMSDK_DIR/emsdk" install "$EMSDK_VERSION"
"$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION"
