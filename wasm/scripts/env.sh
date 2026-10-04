# Shared pinned versions and paths. Source, don't execute.
WASM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_VERSION="6.0.11"
OCCT_TAG="V7_9_3"
EMSDK_DIR="$WASM_DIR/.emsdk"
DEPS_DIR="$WASM_DIR/.deps"
OCCT_SRC="$DEPS_DIR/occt-src"
OCCT_BUILD="$DEPS_DIR/occt-build"
OCCT_INSTALL="$DEPS_DIR/occt-install"
