#!/usr/bin/env bash
# Fetch the TKJT sources (built with the bridge) and build static liblzma for the JT reader.
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

if [ ! -d "$TKJT_SRC" ]; then
  git init -q "$TKJT_SRC"
  git -C "$TKJT_SRC" fetch -q --depth 1 https://github.com/jriegel/PyOpenJt.git "$TKJT_COMMIT"
  git -C "$TKJT_SRC" checkout -q FETCH_HEAD
fi
for p in "$WASM_DIR"/patches/tkjt-*.patch; do
  git -C "$TKJT_SRC" apply --reverse --check "$p" 2>/dev/null || git -C "$TKJT_SRC" apply "$p"
done
if [ ! -d "$XZ_SRC" ]; then
  git clone -q --depth 1 --branch "$XZ_TAG" https://github.com/tukaani-project/xz.git "$XZ_SRC"
fi

emcmake cmake -S "$XZ_SRC" -B "$DEPS_DIR/xz-build-$XZ_TAG" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$XZ_INSTALL" -DBUILD_SHARED_LIBS=OFF -DXZ_THREADS=no -DXZ_SANDBOX=no \
  -DXZ_TOOL_XZ=OFF -DXZ_TOOL_XZDEC=OFF -DXZ_TOOL_LZMADEC=OFF -DXZ_TOOL_LZMAINFO=OFF -DXZ_TOOL_SCRIPTS=OFF \
  -DXZ_ENCODERS= -DXZ_MICROLZMA_ENCODER=OFF -DXZ_MICROLZMA_DECODER=OFF -DXZ_LZIP_DECODER=OFF -DXZ_NLS=OFF -DXZ_DOC=OFF -DBUILD_TESTING=OFF >/dev/null
cmake --build "$DEPS_DIR/xz-build-$XZ_TAG" -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
cmake --install "$DEPS_DIR/xz-build-$XZ_TAG" >/dev/null
echo "liblzma installed to $XZ_INSTALL; TKJT sources in $TKJT_SRC"
