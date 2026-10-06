cmake_minimum_required(VERSION 3.20)
project(occt_viewer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# OpenCASCADE_DIR is passed by scripts/build-bridge.sh (install dir of the pinned OCCT version).
find_package(OpenCASCADE REQUIRED CONFIG NO_DEFAULT_PATH CMAKE_FIND_ROOT_PATH_BOTH)

# JT reader: TKJT sources and liblzma, fetched/built by scripts/build-jt-deps.sh.
# JtToTopoDS is left out: it converts XT B-Rep through a proprietary Parasolid reader.
file(GLOB TKJT_DIRS LIST_DIRECTORIES true "${TKJT_SRC}/TKJT/src/*")
list(FILTER TKJT_DIRS EXCLUDE REGEX "JtToTopoDS$")
set(TKJT_SOURCES)
foreach(dir ${TKJT_DIRS})
  file(GLOB srcs "${dir}/*.cxx")
  list(APPEND TKJT_SOURCES ${srcs})
endforeach()
# OBJECT, not STATIC: element classes self-register via static initialisers the linker would drop.
add_library(tkjt OBJECT ${TKJT_SOURCES})
target_include_directories(tkjt PUBLIC ${TKJT_DIRS} ${OpenCASCADE_INCLUDE_DIR} "${XZ_INSTALL}/include")
target_compile_definitions(tkjt PRIVATE NO_JT_MULTITHREADING __isascii=isascii) # __isascii: MSVC name
target_compile_options(tkjt PRIVATE -fwasm-exceptions -UOCC_CONVERT_SIGNALS -sUSE_ZLIB=1 -w)

add_executable(occt-viewer src/bridge.cpp src/jt_reader.cpp)
target_link_libraries(occt-viewer PRIVATE
  tkjt "${XZ_INSTALL}/lib/liblzma.a"
  TKDESTEP TKDEIGES TKDEGLTF TKDEOBJ TKDESTL TKDEVRML TKRWMesh TKXCAF TKMesh)
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
  -sFILESYSTEM=1 # MEMFS: the IGES and JT readers and glTF buffers read by file name
  -sUSE_ZLIB=1
  -sDYNAMIC_EXECUTION=0)
set_target_properties(occt-viewer PROPERTIES SUFFIX ".js")
