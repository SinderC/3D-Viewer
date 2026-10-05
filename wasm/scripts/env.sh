# Shared pinned versions and paths. Source, don't execute.
WASM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_VERSION="6.0.11"
OCCT_TAG="V7_9_3"
# Header-only, used by the glTF reader. v1.1.0 (2016) no longer compiles with current clang.
RAPIDJSON_COMMIT="24b5e7a8b27f42fa16b96fc70aade9106cf7102f"
EMSDK_DIR="$WASM_DIR/.emsdk"
DEPS_DIR="$WASM_DIR/.deps"
OCCT_SRC="$DEPS_DIR/occt-src"
OCCT_BUILD="$DEPS_DIR/occt-build"
OCCT_INSTALL="$DEPS_DIR/occt-install"
RAPIDJSON_SRC="$DEPS_DIR/rapidjson"
