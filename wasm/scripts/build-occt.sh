#!/usr/bin/env bash
# Fetch OCCT and build the minimal set of static toolkits needed for model import with Emscripten.
# Incremental: re-running only rebuilds what changed.
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

if [ ! -d "$OCCT_SRC" ]; then
  git clone --depth 1 --branch "$OCCT_TAG" https://github.com/Open-Cascade-SAS/OCCT.git "$OCCT_SRC"
fi
for p in "$WASM_DIR"/patches/occt-*.patch; do
  git -C "$OCCT_SRC" apply --reverse --check "$p" 2>/dev/null || git -C "$OCCT_SRC" apply "$p"
done
if [ ! -d "$RAPIDJSON_SRC" ]; then
  git init -q "$RAPIDJSON_SRC"
  git -C "$RAPIDJSON_SRC" fetch -q --depth 1 https://github.com/Tencent/rapidjson.git "$RAPIDJSON_COMMIT"
  git -C "$RAPIDJSON_SRC" checkout -q FETCH_HEAD
fi

TOOLKITS="TKernel TKMath TKG2d TKG3d TKGeomBase TKBRep TKGeomAlgo TKTopAlgo TKPrim TKBO TKShHealing \
TKMesh TKHLR TKService TKV3d TKCDF TKLCAF TKCAF TKVCAF TKXCAF TKDE TKXSBase TKDESTEP \
TKBool TKRWMesh TKDEIGES TKDESTL TKDEOBJ TKDEGLTF TKDEVRML"

emcmake cmake -S "$OCCT_SRC" -B "$OCCT_BUILD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$OCCT_INSTALL" \
  `# OCC_CONVERT_SIGNALS (setjmp/longjmp) + wasm EH miscompiles (invalid br_table); WASM has no signals.` \
  -DCMAKE_CXX_FLAGS="-fwasm-exceptions -UOCC_CONVERT_SIGNALS" \
  -DCMAKE_C_FLAGS="-fwasm-exceptions -UOCC_CONVERT_SIGNALS" \
  -DBUILD_LIBRARY_TYPE=Static \
  -DBUILD_MODULE_FoundationClasses=OFF \
  -DBUILD_MODULE_ModelingData=OFF \
  -DBUILD_MODULE_ModelingAlgorithms=OFF \
  -DBUILD_MODULE_Visualization=OFF \
  -DBUILD_MODULE_ApplicationFramework=OFF \
  -DBUILD_MODULE_DataExchange=OFF \
  -DBUILD_MODULE_Draw=OFF \
  -DBUILD_ADDITIONAL_TOOLKITS="$TOOLKITS" \
  -DBUILD_DOC_Overview=OFF \
  -DUSE_TK=OFF -DUSE_FREETYPE=OFF -DUSE_FREEIMAGE=OFF -DUSE_RAPIDJSON=ON -D3RDPARTY_RAPIDJSON_INCLUDE_DIR="$RAPIDJSON_SRC/include" \
  -DUSE_DRACO=OFF -DUSE_TBB=OFF -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_XLIB=OFF

cmake --build "$OCCT_BUILD" -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
cmake --install "$OCCT_BUILD" >/dev/null
echo "OCCT installed to $OCCT_INSTALL"
