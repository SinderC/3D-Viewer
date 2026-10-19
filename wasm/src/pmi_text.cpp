// Glyph outlines come from FreeType through OCCT (StdPrs_BRepFont builds them into planar faces);
// each character is meshed once, at a fixed size, and scaled and placed per use.

#include "pmi_text.h"

#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <StdPrs_BRepFont.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>

#include <algorithm>
#include <stdexcept>
#include <unordered_map>

namespace
{

constexpr const char* kFontPath = "/fonts/osifont.ttf"; // embedded at link time (CMakeLists.txt)
constexpr double      kSize     = 100;                  // em size glyphs are built and meshed at

struct Font
{
  Handle(StdPrs_BRepFont)                          font;
  double                                           capHeight = 0;
  std::unordered_map<char32_t, std::vector<gp_XY>> glyphs; // triangle corners, at kSize
};

// Cached only once built: a glyph that fails is tried again next time.
const std::vector<gp_XY>& glyph(Font& f, char32_t c)
{
  if (const auto it = f.glyphs.find(c); it != f.glyphs.end())
    return it->second;
  std::vector<gp_XY> out;
  const TopoDS_Shape shape = f.font->RenderGlyph(c); // null for a space; a box for a character the font lacks
  if (!shape.IsNull())
    BRepMesh_IncrementalMesh(shape, kSize * 0.01, false, 0.5);
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
  {
    TopLoc_Location                  loc;
    const Handle(Poly_Triangulation) tri      = BRep_Tool::Triangulation(TopoDS::Face(ex.Current()), loc);
    const bool                       reversed = ex.Current().Orientation() == TopAbs_REVERSED;
    for (int i = 1; !tri.IsNull() && i <= tri->NbTriangles(); ++i)
    {
      int n[3];
      tri->Triangle(i).Get(n[0], n[1], n[2]);
      if (reversed) // counter-clockwise seen from +z, as the face
        std::swap(n[1], n[2]);
      for (const int k : n)
      {
        const gp_Pnt v = tri->Node(k).Transformed(loc.Transformation());
        out.emplace_back(v.X(), v.Y());
      }
    }
  }
  return f.glyphs[c] = std::move(out);
}

Font& font()
{
  static Font f = [] {
    Font out;
    out.font = new StdPrs_BRepFont(kFontPath, kSize);
    if (out.font->FTFont().IsNull() || !out.font->FTFont()->IsValid())
      throw std::runtime_error(std::string("PMI font ") + kFontPath + " could not be loaded");
    for (const gp_XY& p : glyph(out, U'H'))
      out.capHeight = std::max(out.capHeight, p.Y());
    if (out.capHeight <= 0)
      out.capHeight = out.font->Ascender();
    return out;
  }();
  return f;
}

} // namespace

void drawText(const std::u32string& line, const gp_Pnt& origin, const gp_Dir& x, const gp_Dir& y, double height,
              std::vector<float>& triangles)
{
  Font&        f     = font();
  const double scale = height / f.capHeight;
  double       pen   = 0; // at kSize
  for (size_t i = 0; i < line.size(); ++i)
  {
    if (line[i] < U' ') // control characters (a line break or tab in the file's text) would be boxes
      continue;
    for (const gp_XY& p : glyph(f, line[i]))
    {
      const gp_Pnt v = origin.Translated(gp_Vec(x) * ((pen + p.X()) * scale) + gp_Vec(y) * (p.Y() * scale));
      triangles.insert(triangles.end(), {float(v.X()), float(v.Y()), float(v.Z())});
    }
    pen += f.font->AdvanceX(line[i], i + 1 < line.size() ? line[i + 1] : 0);
  }
}
