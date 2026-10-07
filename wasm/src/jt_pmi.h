// JT PMI Manager data → drawable PMI and saved views.
#pragma once

#include <TDF_Label.hxx>
#include <gp_Dir.hxx>

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// One annotation, drawn as lines and filled triangles (text glyphs, arrowheads) in the coordinates
// of the node that owns it.
struct JtPmiItem
{
  std::string        kind;      // dimension, tolerance, datum, note
  std::string        type;      // e.g. Feature Control Frame, Datum A
  std::string        name;      // e.g. Linear Dimension (40)
  std::vector<float> segments;  // x0 y0 z0 x1 y1 z1 ...
  std::vector<float> triangles; // xyz x3 per triangle
  TDF_Label          part;      // owning part definition (set by the JT reader); null = model coordinates
};

struct JtPmiView
{
  std::string      name;
  gp_Dir           direction, up; // direction the camera looks
  std::vector<int> pmi;           // indices into JtPmi::items
};

struct JtPmi
{
  std::vector<JtPmiItem> items;
  std::vector<JtPmiView> views;
};

// Parses a PMI Manager element's data (after its object ID), in the file's byte order. JT 10 data
// gives annotations and views; JT 8 and 9 data only views. Throws std::runtime_error when the data
// cannot be read.
JtPmi readJtPmi(const uint8_t* data, size_t size, int jtMajorVersion, bool bigEndian);
