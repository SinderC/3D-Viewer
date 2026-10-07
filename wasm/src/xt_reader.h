// Parasolid XT (neutral binary) → OCCT edges. JT files embed their exact B-rep as XT data; the
// viewer shows the JT meshes and takes only the edges from it.
#pragma once

#include <TopoDS_Edge.hxx>

#include <cstddef>
#include <cstdint>
#include <vector>

// Edges of the bodies in neutral-binary XT data, scaled by `scale` (XT data is in metres).
// Edges whose curve type is not supported are left out. Throws std::runtime_error when the data
// cannot be read.
std::vector<TopoDS_Edge> readXtEdges(const uint8_t* data, size_t size, double scale);
