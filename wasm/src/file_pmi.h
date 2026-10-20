// PMI and saved views from readers that do not keep them in the XCAF document (JT, QIF).
#pragma once

#include <TDF_Label.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>

#include <string>
#include <vector>

// One annotation, drawn as lines and filled triangles (text glyphs, arrowheads) in the coordinates
// of the node that owns it, and its semantic values where the file has them.
struct FilePmiItem
{
  std::string        kind;      // dimension, tolerance, datum, note
  std::string        type;      // e.g. Feature Control Frame, Datum A
  std::string        name;      // e.g. Linear Dimension (40)
  std::vector<float> segments;  // x0 y0 z0 x1 y1 z1 ...
  std::vector<float> triangles; // xyz x3 per triangle
  TDF_Label          part;      // owning part definition; null = model coordinates
  // Semantic PMI (QIF), as in the bridge's Pmi: lengths in mm, angles in degrees.
  std::vector<TopoDS_Shape> shapes; // referenced faces, edges and vertices of the owning part
  std::vector<double>       value, plusMinus, range;
  std::string               bound; // "max" or "min": value is a one-sided limit
  bool                      angular = false;
  std::vector<std::vector<std::string>> datums; // frame compartments; several names = common datum (A-B)
};

struct FilePmiView
{
  std::string      name;
  gp_Dir           direction, up; // direction the camera looks
  std::vector<int> pmi;           // indices into FilePmi::items
};

struct FilePmi
{
  std::vector<FilePmiItem> items;
  std::vector<FilePmiView> views;
};
