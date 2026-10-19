// JT PMI Manager data → drawable PMI and saved views.
#pragma once

#include "file_pmi.h"

#include <cstddef>
#include <cstdint>

// Parses a PMI Manager element's data (after its object ID), in the file's byte order. JT 10 data
// gives annotations and views; JT 8 and 9 data only views. Throws std::runtime_error when the data
// cannot be read.
FilePmi readJtPmi(const uint8_t* data, size_t size, int jtMajorVersion, bool bigEndian);
