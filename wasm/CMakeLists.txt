cmake_minimum_required(VERSION 3.20)
project(occt_viewer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCASCADE REQUIRED CONFIG NO_DEFAULT_PATH
  PATHS "${CMAKE_CURRENT_SOURCE_DIR}/.deps/occt-install"
  CMAKE_FIND_ROOT_PATH_BOTH)

add_executable(occt-viewer src/bridge.cpp)
target_link_libraries(occt-viewer PRIVATE TKDESTEP TKXCAF TKMesh)
# Must match the OCCT build (see scripts/build-occt.sh).
target_compile_options(occt-viewer PRIVATE -fwasm-exceptions -UOCC_CONVERT_SIGNALS)
target_link_options(occt-viewer PRIVATE
  -fwasm-exceptions
  -lembind
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createOcctViewer
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sMAXIMUM_MEMORY=4GB
  -sSTACK_SIZE=4MB
  -sFILESYSTEM=0
  -sDYNAMIC_EXECUTION=0)
set_target_properties(occt-viewer PROPERTIES SUFFIX ".js")
