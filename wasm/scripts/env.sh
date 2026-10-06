# Shared pinned versions and paths. Source, don't execute.
WASM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_VERSION="6.0.11"
OCCT_TAG="V8_0_1"
# Header-only, used by the glTF reader. v1.1.0 (2016) no longer compiles with current clang.
RAPIDJSON_COMMIT="24b5e7a8b27f42fa16b96fc70aade9106cf7102f"
EMSDK_DIR="$WASM_DIR/.emsdk"
DEPS_DIR="$WASM_DIR/.deps"
OCCT_SRC="$DEPS_DIR/occt-src-$OCCT_TAG"
OCCT_BUILD="$DEPS_DIR/occt-build-$OCCT_TAG"
OCCT_INSTALL="$DEPS_DIR/occt-install-$OCCT_TAG"
RAPIDJSON_SRC="$DEPS_DIR/rapidjson"
# JT reader (TKJT, GPL-2.0+) from PyOpenJt, and liblzma (xz, 0BSD) for JT 10 segments.
TKJT_COMMIT="21faef4c2b4a8efb5e28d5587c1618832802766d"
XZ_TAG="v5.8.1"
TKJT_SRC="$DEPS_DIR/pyopenjt"
XZ_SRC="$DEPS_DIR/xz-src-$XZ_TAG"
XZ_INSTALL="$DEPS_DIR/xz-install-$XZ_TAG"
