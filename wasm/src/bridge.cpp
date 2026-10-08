// STEP / IGES / BREP / JT / glTF / OBJ / STL / VRML → mesh bridge for the browser.
//
// readModel(bytes, fileName, options) returns { json, geometry }:
//   json     — model description (format, schema, units, node tree, prototypes, colors)
//   geometry — Uint8Array view over one packed buffer; JSON offsets point into it.
//              The view aliases WASM memory and is valid until the next call: copy it.
//
// Every format is read into an XCAF document; the Builder turns that into the output.
// Geometry is meshed once per prototype (part definition) and shared by all instances.

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <DESTEP_Parameters.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <HeaderSection_FileSchema.hxx>
#include <IGESCAFControl_Reader.hxx>
#include <IGESData_IGESModel.hxx>
#include <Interface_HArray1OfHAsciiString.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <NCollection_DataMap.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_Sequence.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <RWGltf_CafReader.hxx>
#include <RWObj_CafReader.hxx>
#include <RWStl.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPControl_Reader.hxx>
#include <StepData_StepModel.hxx>
#include <TDF_Tool.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <NCollection_List.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <VrmlAPI_CafReader.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDimTolObjects_DatumObject.hxx>
#include <XCAFDimTolObjects_DimensionObject.hxx>
#include <XCAFDimTolObjects_GeomToleranceObject.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_Datum.hxx>
#include <XCAFDoc_DimTolTool.hxx>
#include <XCAFDoc_Dimension.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_GeomTolerance.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFDoc_View.hxx>
#include <XCAFDoc_ViewTool.hxx>
#include <XCAFView_Object.hxx>
#include <XCAFPrs.hxx>
#include <XCAFPrs_Style.hxx>

#include "jt_reader.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using emscripten::val;

using LabelSequence = NCollection_Sequence<TDF_Label>;
using FaceColorMap  = NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher>;
using ShapeStyleMap = NCollection_IndexedDataMap<TopoDS_Shape, XCAFPrs_Style, TopTools_ShapeMapHasher>;
using EdgeFacesMap  = NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>;

namespace
{

using RGBA = std::array<float, 4>;

struct Options
{
  double linearDeflection  = 0.001; // relative to the part's bounding-box diagonal
  double angularDeflection = 0.5;   // radians
};

// ---------------------------------------------------------------------------
// Output buffers

struct Range
{
  size_t offset = 0; // bytes
  size_t count  = 0; // elements of the array's scalar type
};

struct Group
{
  uint32_t start; // first index
  uint32_t count; // index count
  int      color; // index into colors, -1 = inherit
};

// Measurement data, parallel to the B-rep faces / edges that produced triangles / segments.
constexpr int kFaceStride = 7; // kind (0 other, 1 plane), origin xyz, outward normal xyz
constexpr int kEdgeStride = 9; // kind (0 other, 1 line, 2 circle), length, radius, centre xyz, axis xyz

struct Proto
{
  Range              positions, normals, indices, edges;
  Range              faceStarts, faceData; // first index of each face (uint32) / kFaceStride doubles
  Range              edgeStarts, edgeData; // first segment of each edge (uint32) / kEdgeStride doubles
  std::vector<Group> groups;
  // B-rep face → index into faceStarts, to resolve PMI references. Not serialised.
  NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> faceIndex;
};

// PMI (STEP GD&T): one dimension, geometric tolerance, datum or note, with its drawn presentation.
struct Pmi
{
  std::string              kind; // dimension, tolerance, datum, note
  std::string              type; // e.g. Diameter, Position
  std::string              name;
  int                      proto = -1; // owning part; -1 = drawn in model coordinates
  Range                    segments;   // presentation lines (x0 y0 z0 x1 y1 z1 ...), float32
  Range                    triangles;  // filled presentation areas such as text glyphs, float32 xyz x3
  std::vector<int>         faces;      // referenced faces of the owning part (faceStarts indices)
  std::vector<double>      value;      // nominal value (dimension, tolerance), if any
  std::vector<double>      plusMinus;  // lower and upper tolerance, if any
  std::vector<double>      range;      // lower and upper limit, if any
  bool                     angular = false; // values in degrees, not model units
  std::vector<std::string> datums;
};

// A saved view (STEP camera model) with the PMI it shows. OCCT keeps no camera position, so the
// viewer frames the view's PMI from its direction.
struct SavedView
{
  std::string      name;
  gp_Dir           direction, up; // direction the camera looks
  std::vector<int> pmi;
};

struct Node
{
  std::string name;
  int         parent = -1;
  bool        hasMatrix = false;
  double      matrix[16]; // column-major
  int         proto = -1;
  int         color = -1;
};

std::vector<uint8_t> gGeometry;

template <typename T>
Range append(const std::vector<T>& data)
{
  gGeometry.resize((gGeometry.size() + 7) & ~size_t(7)); // keep Float64Array views aligned
  Range r{gGeometry.size(), data.size()};
  const auto* bytes = reinterpret_cast<const uint8_t*>(data.data());
  gGeometry.insert(gGeometry.end(), bytes, bytes + data.size() * sizeof(T));
  return r;
}

// ---------------------------------------------------------------------------
// Progress → JS callback

// percent is -1 when the stage has no measurable progress.
class Progress
{
public:
  explicit Progress(val cb) : myCb(std::move(cb)) {}

  void operator()(const std::string& stage, int pct)
  {
    if (myCb.isUndefined() || (stage == myStage && pct == myLast))
      return;
    myStage = stage;
    myLast  = pct;
    myCb(stage, pct);
  }

private:
  val         myCb;
  std::string myStage;
  int         myLast = -1;
};

// ---------------------------------------------------------------------------
// Helpers

// Hands the parser the file in chunks so read progress can be reported as bytes consumed.
class MemBuf : public std::streambuf
{
public:
  MemBuf(char* p, size_t n, Progress& progress) : myBegin(p), myEnd(p + n), myProgress(progress)
  {
    setg(p, p, p);
  }

protected:
  int_type underflow() override
  {
    char* cur = egptr();
    if (cur == myEnd)
      return traits_type::eof();
    myProgress("read", int(100.0 * (cur - myBegin) / (myEnd - myBegin)));
    setg(cur, cur, std::min(cur + kChunk, myEnd));
    return traits_type::to_int_type(*cur);
  }

private:
  static constexpr size_t kChunk = 1 << 20;
  char*                   myBegin;
  char*                   myEnd;
  Progress&               myProgress;
};

std::string labelName(const TDF_Label& l)
{
  Handle(TDataStd_Name) n;
  if (!l.FindAttribute(TDataStd_Name::GetID(), n))
    return {};
  return TCollection_AsciiString(n->Get()).ToCString(); // UTF-8
}

std::string jsonEscape(const std::string& s)
{
  std::string out;
  out.reserve(s.size() + 2);
  for (unsigned char c : s)
  {
    switch (c)
    {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20)
        {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        }
        else
          out += static_cast<char>(c);
    }
  }
  return out;
}

RGBA toRGBA(const Quantity_ColorRGBA& c)
{
  double r, g, b;
  c.GetRGB().Values(r, g, b, Quantity_TOC_sRGB);
  return {float(r), float(g), float(b), c.Alpha()};
}

void trsfToMatrix(const gp_Trsf& t, double m[16])
{
  // Three.js Matrix4.fromArray expects column-major.
  for (int c = 0; c < 4; ++c)
    for (int r = 0; r < 4; ++r)
      m[c * 4 + r] = (r == 3) ? (c == 3 ? 1.0 : 0.0) : t.Value(r + 1, c + 1);
}

// ---------------------------------------------------------------------------
// Model builder

class Builder
{
public:
  Builder(const Handle(TDocStd_Document)& doc, const Options& opts, Progress& progress)
      : myOpts(opts),
        myProgress(progress),
        myShapes(XCAFDoc_DocumentTool::ShapeTool(doc->Main())),
        myColors(XCAFDoc_DocumentTool::ColorTool(doc->Main())),
        myDimTols(XCAFDoc_DocumentTool::DimTolTool(doc->Main())),
        myViews(XCAFDoc_DocumentTool::ViewTool(doc->Main()))
  {
  }

  void build(const JtPmi& jtPmi)
  {
    // Every part definition is meshed once; count them so meshing can report progress.
    LabelSequence all;
    myShapes->GetShapes(all);
    for (const TDF_Label& l : all)
      if (!XCAFDoc_ShapeTool::IsAssembly(l))
        ++myPartCount;
    myProgress("mesh", 0);

    LabelSequence roots;
    myShapes->GetFreeShapes(roots);
    for (const TDF_Label& root : roots)
      visit(root, -1);

    collectPmi();
    collectViews();
    addJtPmi(jtPmi);
  }

  const std::vector<Node>&      nodes() const { return myNodes; }
  const std::vector<Proto>&     protos() const { return myProtos; }
  const std::vector<RGBA>&      colors() const { return myColorTable; }
  const std::vector<Pmi>&       pmi() const { return myPmi; }
  const std::vector<SavedView>& views() const { return myViewList; }

private:
  int colorIndex(const RGBA& c)
  {
    for (size_t i = 0; i < myColorTable.size(); ++i)
      if (myColorTable[i] == c)
        return int(i);
    myColorTable.push_back(c);
    return int(myColorTable.size() - 1);
  }

  // Colour set directly on a label (instance or prototype), surface colour preferred.
  int labelColor(const TDF_Label& l)
  {
    Quantity_ColorRGBA c;
    if (myColors->GetColor(l, XCAFDoc_ColorSurf, c) || myColors->GetColor(l, XCAFDoc_ColorGen, c))
      return colorIndex(toRGBA(c));
    return -1;
  }

  void visit(const TDF_Label& label, int parent)
  {
    Node node;
    node.parent = parent;
    node.name   = labelName(label);

    TDF_Label def = label;
    if (XCAFDoc_ShapeTool::IsReference(label))
    {
      XCAFDoc_ShapeTool::GetReferredShape(label, def);
      const TopLoc_Location loc = XCAFDoc_ShapeTool::GetLocation(label);
      if (!loc.IsIdentity())
      {
        node.hasMatrix = true;
        trsfToMatrix(loc.Transformation(), node.matrix);
      }
      // OCCT auto-names references "=>[0:1:1:2]"; the part name lives on the definition.
      if (node.name.empty() || node.name.rfind("=>[", 0) == 0)
        node.name = labelName(def);
    }
    node.color = labelColor(label);

    const bool assembly = XCAFDoc_ShapeTool::IsAssembly(def);
    if (!assembly)
    {
      node.proto = protoFor(def);
      if (node.proto < 0)
        return; // no renderable geometry (e.g. empty PMI/presentation shapes)
    }

    const int id = int(myNodes.size());
    myNodes.push_back(node);

    if (assembly)
    {
      LabelSequence comps;
      XCAFDoc_ShapeTool::GetComponents(def, comps, false);
      for (const TDF_Label& c : comps)
        visit(c, id);
    }
  }

  int protoFor(const TDF_Label& def)
  {
    TCollection_AsciiString entry;
    TDF_Tool::Entry(def, entry);
    auto it = myProtoByEntry.find(entry.ToCString());
    if (it != myProtoByEntry.end())
      return it->second;

    // Any location stored on the definition shape stays baked into the mesh,
    // so sub-shape style keys match the faces we explore.
    Proto     proto = meshPart(def, XCAFDoc_ShapeTool::GetShape(def));
    const int idx   = proto.indices.count ? int(myProtos.size()) : -1;
    if (idx >= 0)
      myProtos.push_back(std::move(proto));
    myProtoByEntry[entry.ToCString()] = idx;
    myProgress("mesh", int(100 * std::min(++myPartsMeshed, myPartCount) / std::max(myPartCount, 1)));
    return idx;
  }

  Proto meshPart(const TDF_Label& def, const TopoDS_Shape& shape)
  {
    // B-rep faces need meshing; AP242 tessellated faces already carry a triangulation.
    bool hasSurfaces = false;
    {
      TopoDS_Compound toMesh;
      BRep_Builder    bb;
      bb.MakeCompound(toMesh);
      for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
      {
        const TopoDS_Face& f = TopoDS::Face(ex.Current());
        if (!BRep_Tool::Surface(f).IsNull())
        {
          bb.Add(toMesh, f);
          hasSurfaces = true;
        }
      }
      if (hasSurfaces)
        BRepMesh_IncrementalMesh(toMesh, deflection(shape), false, myOpts.angularDeflection, false);
    }

    int        partColor = -1;
    const auto colorOf   = faceStyles(def, shape, partColor);

    std::vector<float>    pos, nrm, edges;
    std::vector<uint32_t> idx, faceStarts, edgeStarts;
    std::vector<double>   faceData, edgeData;
    Proto                 proto;

    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
    {
      const TopoDS_Face&         face = TopoDS::Face(ex.Current());
      TopLoc_Location            loc;
      Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
      if (tri.IsNull() || tri->NbTriangles() == 0)
        continue;

      if (!tri->HasNormals())
        BRepLib_ToolTriangulatedShape::ComputeNormals(face, tri);

      const gp_Trsf  t        = loc.Transformation();
      const bool     reversed = face.Orientation() == TopAbs_REVERSED;
      const uint32_t base     = uint32_t(pos.size() / 3);

      for (int i = 1; i <= tri->NbNodes(); ++i)
      {
        const gp_Pnt p = tri->Node(i).Transformed(t);
        pos.insert(pos.end(), {float(p.X()), float(p.Y()), float(p.Z())});
        gp_Dir n = tri->HasNormals() ? gp_Dir(tri->Normal(i)) : gp_Dir(0, 0, 1);
        n.Transform(t);
        if (reversed)
          n.Reverse();
        nrm.insert(nrm.end(), {float(n.X()), float(n.Y()), float(n.Z())});
      }

      const uint32_t start = uint32_t(idx.size());
      for (int i = 1; i <= tri->NbTriangles(); ++i)
      {
        int a, b, c;
        tri->Triangle(i).Get(a, b, c);
        if (reversed)
          std::swap(b, c);
        idx.insert(idx.end(), {base + a - 1, base + b - 1, base + c - 1});
      }

      faceStarts.push_back(start);
      appendFaceData(face, reversed, faceData);
      if (!proto.faceIndex.IsBound(face))
        proto.faceIndex.Bind(face, int(faceStarts.size()) - 1);

      const int* found = colorOf.Seek(face);
      const int  color = found ? *found : partColor;
      const auto count = uint32_t(idx.size()) - start;
      if (!proto.groups.empty() && proto.groups.back().color == color)
        proto.groups.back().count += count;
      else
        proto.groups.push_back({start, count, color});
    }

    // Free edges count only on triangulated parts (JT parts with XT edges), not next to B-rep faces.
    collectEdges(shape, !hasSurfaces, edges, edgeStarts, edgeData);

    proto.positions  = append(pos);
    proto.normals    = append(nrm);
    proto.indices    = append(idx);
    proto.edges      = append(edges);
    proto.faceStarts = append(faceStarts);
    proto.faceData   = append(faceData);
    proto.edgeStarts = append(edgeStarts);
    proto.edgeData   = append(edgeData);
    return proto;
  }

  // Linear meshing deflection for a part, relative to its size.
  double deflection(const TopoDS_Shape& shape) const
  {
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    const double diag = box.IsVoid() ? 1.0 : std::sqrt(box.SquareExtent());
    return std::max(diag * myOpts.linearDeflection, 1e-4);
  }

  // Styles from the part and its sub-shape labels; larger shapes first so faces override solids.
  FaceColorMap faceStyles(const TDF_Label&    def,
                                            const TopoDS_Shape& shape,
                                            int&                partColor)
  {
    FaceColorMap     result;
    ShapeStyleMap     styles;
    XCAFPrs::CollectStyleSettings(def, TopLoc_Location(), styles);

    std::vector<std::pair<TopoDS_Shape, int>> entries;
    for (ShapeStyleMap::Iterator it(styles); it.More(); it.Next())
    {
      const XCAFPrs_Style& st = it.Value();
      if (!st.IsSetColorSurf())
        continue;
      entries.emplace_back(it.Key(), colorIndex(toRGBA(st.GetColorSurfRGBA())));
    }
    std::stable_sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) {
      return a.first.ShapeType() < b.first.ShapeType();
    });

    for (const auto& [sub, color] : entries)
    {
      if (sub.IsPartner(shape))
      {
        partColor = color;
        continue;
      }
      for (TopExp_Explorer ex(sub, TopAbs_FACE); ex.More(); ex.Next())
        result.Bind(ex.Current(), color);
    }
    return result;
  }

  static void appendFaceData(const TopoDS_Face& face, bool reversed, std::vector<double>& out)
  {
    double d[kFaceStride] = {};
    if (!BRep_Tool::Surface(face).IsNull())
    {
      BRepAdaptor_Surface surf(face);
      if (surf.GetType() == GeomAbs_Plane)
      {
        const gp_Pln pln = surf.Plane();
        gp_Dir       n   = pln.Axis().Direction();
        if (reversed)
          n.Reverse();
        const gp_Pnt o = pln.Location();
        const double v[] = {1, o.X(), o.Y(), o.Z(), n.X(), n.Y(), n.Z()};
        std::copy(v, v + kFaceStride, d);
      }
    }
    out.insert(out.end(), d, d + kFaceStride);
  }

  static void appendEdgeData(const TopoDS_Edge& edge, double polylineLength, std::vector<double>& out)
  {
    double d[kEdgeStride] = {0, polylineLength};
    if (BRep_Tool::IsGeometric(edge))
    {
      BRepAdaptor_Curve curve(edge);
      d[1] = GCPnts_AbscissaPoint::Length(curve);
      if (curve.GetType() == GeomAbs_Line)
        d[0] = 1;
      else if (curve.GetType() == GeomAbs_Circle)
      {
        const gp_Circ c = curve.Circle();
        const gp_Pnt  o = c.Location();
        const gp_Dir  a = c.Axis().Direction();
        const double  v[] = {2, d[1], c.Radius(), o.X(), o.Y(), o.Z(), a.X(), a.Y(), a.Z()};
        std::copy(v, v + kEdgeStride, d);
      }
    }
    out.insert(out.end(), d, d + kEdgeStride);
  }

  // Feature edges as line segments (x0 y0 z0 x1 y1 z1 ...). Seams and degenerate edges skipped.
  // Face edges follow their face's mesh; free edges (the XT edges of JT parts) are sampled.
  void collectEdges(const TopoDS_Shape&    shape,
                    bool                   freeEdges,
                    std::vector<float>&    out,
                    std::vector<uint32_t>& starts,
                    std::vector<double>&   data) const
  {
    EdgeFacesMap edgeFaces;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    double freeDeflection = 0; // computed for the first free edge

    for (int i = 1; i <= edgeFaces.Extent(); ++i)
    {
      const TopoDS_Edge& edge = TopoDS::Edge(edgeFaces.FindKey(i));
      if (BRep_Tool::Degenerated(edge))
        continue;
      if (edgeFaces(i).IsEmpty())
      {
        if (!freeEdges || !BRep_Tool::IsGeometric(edge))
          continue; // also VRML line sets: polygon only
        if (freeDeflection == 0)
          freeDeflection = deflection(shape);
        sampleEdge(edge, freeDeflection, out, starts, data);
        continue;
      }
      const TopoDS_Face& face = TopoDS::Face(edgeFaces(i).First());
      if (BRep_Tool::IsClosed(edge, face))
        continue; // seam

      TopLoc_Location            loc;
      Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
      if (tri.IsNull())
        continue;
      Handle(Poly_PolygonOnTriangulation) poly = BRep_Tool::PolygonOnTriangulation(edge, tri, loc);
      if (poly.IsNull())
        continue;

      const gp_Trsf               t     = loc.Transformation();
      const NCollection_Array1<int>& nodes = poly->Nodes();
      if (nodes.Length() < 2)
        continue;
      starts.push_back(uint32_t(out.size() / 6));
      double length = 0;
      for (int k = nodes.Lower(); k < nodes.Upper(); ++k)
      {
        const gp_Pnt a = tri->Node(nodes(k)).Transformed(t);
        const gp_Pnt b = tri->Node(nodes(k + 1)).Transformed(t);
        length += a.Distance(b);
        out.insert(out.end(),
                   {float(a.X()), float(a.Y()), float(a.Z()), float(b.X()), float(b.Y()), float(b.Z())});
      }
      appendEdgeData(edge, length, data);
    }
  }

  void sampleEdge(const TopoDS_Edge&     edge,
                  double                 linearDeflection,
                  std::vector<float>&    out,
                  std::vector<uint32_t>& starts,
                  std::vector<double>&   data) const
  {
    const size_t at     = out.size();
    const double length = sampleCurve(edge, linearDeflection, out);
    if (out.size() == at)
      return;
    starts.push_back(uint32_t(at / 6));
    appendEdgeData(edge, length, data);
  }

  // Line segments along an edge's curve, appended to out; returns their total length.
  double sampleCurve(const TopoDS_Edge& edge, double linearDeflection, std::vector<float>& out) const
  {
    const BRepAdaptor_Curve           curve(edge);
    const GCPnts_TangentialDeflection pts(curve, myOpts.angularDeflection, linearDeflection);
    double                            length = 0;
    for (int k = 1; k < pts.NbPoints(); ++k)
    {
      const gp_Pnt a = pts.Value(k);
      const gp_Pnt b = pts.Value(k + 1);
      length += a.Distance(b);
      out.insert(out.end(), {float(a.X()), float(a.Y()), float(a.Z()), float(b.X()), float(b.Y()), float(b.Z())});
    }
    return length;
  }

  // -------------------------------------------------------------------------
  // PMI and saved views (STEP AP242 GD&T)

  static std::string entryOf(const TDF_Label& l)
  {
    TCollection_AsciiString entry;
    TDF_Tool::Entry(l, entry);
    return entry.ToCString();
  }

  static std::string str(const Handle(TCollection_HAsciiString)& s) { return s.IsNull() ? std::string() : s->ToCString(); }

  void collectPmi()
  {
    LabelSequence labels;
    myDimTols->GetDimensionLabels(labels);
    for (const TDF_Label& l : labels)
    {
      Handle(XCAFDoc_Dimension) attr;
      if (!l.FindAttribute(XCAFDoc_Dimension::GetID(), attr))
        continue;
      const Handle(XCAFDimTolObjects_DimensionObject) obj = attr->GetObject();
      const auto type = obj->GetType();
      Pmi        p;
      const bool note = type == XCAFDimTolObjects_DimensionType_CommonLabel
                        || type == XCAFDimTolObjects_DimensionType_DimensionPresentation;
      p.kind    = note ? "note" : "dimension";
      p.type    = dimensionType(type);
      p.angular = type == XCAFDimTolObjects_DimensionType_Location_Angular
                  || type == XCAFDimTolObjects_DimensionType_Size_Angular;
      if (!note && !obj->GetValues().IsNull())
      {
        if (obj->IsDimWithRange())
          p.range = {obj->GetLowerBound(), obj->GetUpperBound()};
        else
          p.value = {obj->GetValue()};
        if (obj->IsDimWithPlusMinusTolerance())
          p.plusMinus = {obj->GetLowerTolValue(), obj->GetUpperTolValue()};
      }
      addPmi(l, std::move(p), obj->GetPresentation(), obj->GetPresentationName());
    }

    labels.Clear();
    myDimTols->GetGeomToleranceLabels(labels);
    for (const TDF_Label& l : labels)
    {
      Handle(XCAFDoc_GeomTolerance) attr;
      if (!l.FindAttribute(XCAFDoc_GeomTolerance::GetID(), attr))
        continue;
      const Handle(XCAFDimTolObjects_GeomToleranceObject) obj = attr->GetObject();
      Pmi p;
      p.kind  = "tolerance";
      p.type  = toleranceType(obj->GetType());
      p.value = {obj->GetValue()};
      LabelSequence datums;
      XCAFDoc_DimTolTool::GetDatumOfTolerLabels(l, datums);
      for (const TDF_Label& d : datums)
      {
        Handle(XCAFDoc_Datum) datum;
        if (d.FindAttribute(XCAFDoc_Datum::GetID(), datum))
          p.datums.push_back(str(datum->GetObject()->GetName()));
      }
      addPmi(l, std::move(p), obj->GetPresentation(), obj->GetPresentationName());
    }

    labels.Clear();
    myDimTols->GetDatumLabels(labels);
    for (const TDF_Label& l : labels)
    {
      Handle(XCAFDoc_Datum) attr;
      if (!l.FindAttribute(XCAFDoc_Datum::GetID(), attr))
        continue;
      const Handle(XCAFDimTolObjects_DatumObject) obj = attr->GetObject();
      Pmi p;
      p.kind = "datum";
      p.type = "Datum " + str(obj->GetName());
      if (obj->IsDatumTarget() && obj->GetDatumTargetNumber() > 0)
        p.type = "Datum target " + str(obj->GetName()) + std::to_string(obj->GetDatumTargetNumber());
      addPmi(l, std::move(p), obj->GetPresentation(), obj->GetPresentationName());
    }
  }

  void addPmi(const TDF_Label& label, Pmi p, const TopoDS_Shape& presentation, const Handle(TCollection_HAsciiString)& name)
  {
    p.name = str(name);

    // The owning part and its faces, from the shapes the PMI refers to.
    LabelSequence first, second;
    XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
    for (const LabelSequence* refs : {&first, &second})
      for (const TDF_Label& ref : *refs)
        addFaces(ref, p);

    // OCCT makes a datum for each tolerance that references it: keep the first of each.
    if (p.kind == "datum")
    {
      const std::string key = std::to_string(p.proto) + '\n' + p.type + '\n' + p.name;
      if (const auto [it, isNew] = myDatumByKey.try_emplace(key, int(myPmi.size())); !isNew)
      {
        myPmiByEntry[entryOf(label)] = it->second;
        return;
      }
    }

    // Presentations are lines (leaders, frames) and triangulated faces (filled text glyphs).
    std::vector<float> segments, triangles;
    if (!presentation.IsNull())
    {
      const double deflection = this->deflection(presentation);
      for (TopExp_Explorer ex(presentation, TopAbs_EDGE); ex.More(); ex.Next())
        if (BRep_Tool::IsGeometric(TopoDS::Edge(ex.Current())))
          sampleCurve(TopoDS::Edge(ex.Current()), deflection, segments);
      for (TopExp_Explorer ex(presentation, TopAbs_FACE); ex.More(); ex.Next())
      {
        TopLoc_Location                  loc;
        const Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(TopoDS::Face(ex.Current()), loc);
        for (int i = 1; !tri.IsNull() && i <= tri->NbTriangles(); ++i)
        {
          int n[3];
          tri->Triangle(i).Get(n[0], n[1], n[2]);
          // Some STEP PMI meshes reference nodes past the end of their coordinate list: skip those.
          if (std::any_of(n, n + 3, [&](int k) { return k < 1 || k > tri->NbNodes(); }))
            continue;
          for (int k : n)
          {
            const gp_Pnt v = tri->Node(k).Transformed(loc.Transformation());
            triangles.insert(triangles.end(), {float(v.X()), float(v.Y()), float(v.Z())});
          }
        }
      }
    }
    p.segments  = append(segments);
    p.triangles = append(triangles);
    myPmiByEntry[entryOf(label)] = int(myPmi.size());
    myPmi.push_back(std::move(p));
  }

  // Faces of a referenced (sub-)shape, if they belong to the PMI's part. The first part referenced
  // owns the PMI; references into other parts are not highlighted.
  void addFaces(const TDF_Label& ref, Pmi& p) const
  {
    TDF_Label part = XCAFDoc_ShapeTool::IsSubShape(ref) ? ref.Father() : ref;
    if (XCAFDoc_ShapeTool::IsReference(part))
      XCAFDoc_ShapeTool::GetReferredShape(part, part);
    const auto it = myProtoByEntry.find(entryOf(part));
    if (it == myProtoByEntry.end() || it->second < 0)
      return;
    if (p.proto < 0)
      p.proto = it->second;
    if (p.proto != it->second)
      return;
    const auto& faces = myProtos[size_t(p.proto)].faceIndex;
    for (TopExp_Explorer ex(XCAFDoc_ShapeTool::GetShape(ref), TopAbs_FACE); ex.More(); ex.Next())
      if (const int* i = faces.Seek(ex.Current()))
        if (std::find(p.faces.begin(), p.faces.end(), *i) == p.faces.end())
          p.faces.push_back(*i);
  }

  void collectViews()
  {
    LabelSequence labels;
    myViews->GetViewLabels(labels);
    for (const TDF_Label& l : labels)
    {
      Handle(XCAFDoc_View) attr;
      if (!l.FindAttribute(XCAFDoc_View::GetID(), attr))
        continue;
      const Handle(XCAFView_Object) obj = attr->GetObject();
      SavedView v;
      v.name      = str(obj->Name());
      v.direction = obj->ViewDirection();
      v.up        = obj->UpDirection();
      LabelSequence gdts;
      myViews->GetRefGDTLabel(l, gdts);
      for (const TDF_Label& g : gdts)
        if (auto it = myPmiByEntry.find(entryOf(g));
            it != myPmiByEntry.end() && std::find(v.pmi.begin(), v.pmi.end(), it->second) == v.pmi.end())
          v.pmi.push_back(it->second);
      myViewList.push_back(std::move(v));
    }
  }

  // JT PMI comes drawn already, in the coordinates of its part (or the model).
  void addJtPmi(const JtPmi& jt)
  {
    const int first = int(myPmi.size());
    for (const JtPmiItem& item : jt.items)
    {
      Pmi p;
      p.kind = item.kind;
      p.type = item.type;
      p.name = item.name;
      if (!item.part.IsNull())
        if (const auto it = myProtoByEntry.find(entryOf(item.part)); it != myProtoByEntry.end())
          p.proto = it->second;
      p.segments  = append(item.segments);
      p.triangles = append(item.triangles);
      myPmi.push_back(std::move(p));
    }
    for (const JtPmiView& v : jt.views)
    {
      SavedView view{v.name, v.direction, v.up, {}};
      for (int i : v.pmi)
        view.pmi.push_back(first + i);
      myViewList.push_back(std::move(view));
    }
  }

  static std::string dimensionType(XCAFDimTolObjects_DimensionType t)
  {
    switch (t)
    {
      case XCAFDimTolObjects_DimensionType_Location_CurvedDistance: return "Curved distance";
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromCenterToOuter:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromCenterToInner:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToCenter:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToOuter:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToInner:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToCenter:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToOuter:
      case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToInner: return "Distance";
      case XCAFDimTolObjects_DimensionType_Location_Angular:
      case XCAFDimTolObjects_DimensionType_Size_Angular: return "Angle";
      case XCAFDimTolObjects_DimensionType_Location_Oriented: return "Oriented location";
      case XCAFDimTolObjects_DimensionType_Location_WithPath: return "Location along path";
      case XCAFDimTolObjects_DimensionType_Size_CurveLength: return "Curve length";
      case XCAFDimTolObjects_DimensionType_Size_Diameter: return "Diameter";
      case XCAFDimTolObjects_DimensionType_Size_SphericalDiameter: return "Spherical diameter";
      case XCAFDimTolObjects_DimensionType_Size_Radius: return "Radius";
      case XCAFDimTolObjects_DimensionType_Size_SphericalRadius: return "Spherical radius";
      case XCAFDimTolObjects_DimensionType_Size_Thickness: return "Thickness";
      case XCAFDimTolObjects_DimensionType_Size_WithPath: return "Size along path";
      case XCAFDimTolObjects_DimensionType_CommonLabel:
      case XCAFDimTolObjects_DimensionType_DimensionPresentation: return "Note";
      case XCAFDimTolObjects_DimensionType_Location_None: return "Location";
      default: return "Toroidal size";
    }
  }

  static std::string toleranceType(XCAFDimTolObjects_GeomToleranceType t)
  {
    static const char* const kNames[] = {"Tolerance",       "Angularity",       "Circular runout",
                                         "Circularity",     "Coaxiality",       "Concentricity",
                                         "Cylindricity",    "Flatness",         "Parallelism",
                                         "Perpendicularity", "Position",        "Profile of a line",
                                         "Profile of a surface", "Straightness", "Symmetry",
                                         "Total runout"};
    const auto i = size_t(t);
    return i < sizeof kNames / sizeof *kNames ? kNames[i] : "Tolerance";
  }

  Options                    myOpts;
  Progress&                  myProgress;
  int                        myPartCount   = 0;
  int                        myPartsMeshed = 0;
  Handle(XCAFDoc_ShapeTool)  myShapes;
  Handle(XCAFDoc_ColorTool)  myColors;
  std::vector<Node>          myNodes;
  std::vector<Proto>         myProtos;
  std::vector<RGBA>          myColorTable;
  std::map<std::string, int> myProtoByEntry;
  Handle(XCAFDoc_DimTolTool) myDimTols;
  Handle(XCAFDoc_ViewTool)   myViews;
  std::vector<Pmi>           myPmi;
  std::map<std::string, int> myPmiByEntry;
  std::map<std::string, int> myDatumByKey; // part, type and name → PMI index
  std::vector<SavedView>     myViewList;
};

// Readers: each fills the XCAF document and describes the source.

struct Source
{
  std::string format;
  std::string schema; // STEP only
  std::string unit;   // file length unit name as in STEP ("MILLIMETRE", "INCH", ...); empty = mm
  JtPmi       jtPmi;  // JT only (STEP PMI is in the XCAF document)
};

// OCCT's IGES reader, TKJT (and glTF buffers, read lazily by file name) need a real file: MEMFS.
class TempFile
{
public:
  TempFile(const std::string& ext, const std::string& bytes) : myPath("/tmp/model" + ext)
  {
    std::ofstream(myPath, std::ios::binary).write(bytes.data(), std::streamsize(bytes.size()));
  }
  ~TempFile() { std::remove(myPath.c_str()); }
  TempFile(const TempFile&)            = delete;
  TempFile& operator=(const TempFile&) = delete;

  const char* path() const { return myPath.c_str(); }

private:
  std::string myPath;
};

std::string fileSchema(const Handle(StepData_StepModel)& model)
{
  if (model.IsNull())
    return {};
  Handle(HeaderSection_FileSchema) fs =
    Handle(HeaderSection_FileSchema)::DownCast(model->HeaderEntity(STANDARD_TYPE(HeaderSection_FileSchema)));
  if (fs.IsNull() || fs->NbSchemaIdentifiers() < 1)
    return {};
  return fs->SchemaIdentifiersValue(1)->ToCString();
}

std::string fileLengthUnit(STEPControl_Reader& reader)
{
  NCollection_Sequence<TCollection_AsciiString> len, ang, solid;
  reader.FileUnits(len, ang, solid);
  return len.IsEmpty() ? std::string() : std::string(len.First().ToCString());
}

Source readStepDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  STEPCAFControl_Reader reader;
  reader.SetNameMode(true);
  reader.SetColorMode(true);
  reader.SetLayerMode(true);
  reader.SetGDTMode(true);  // PMI: dimensions, tolerances, datums with their presentations
  reader.SetViewMode(true); // saved views
  reader.SetPropsMode(false);

  MemBuf       buf(const_cast<char*>(bytes.data()), bytes.size(), progress);
  std::istream stream(&buf);
  if (reader.ReadStream("model.stp", stream) != IFSelect_RetDone)
    throw std::runtime_error("Not a readable STEP file");

  Source src{"STEP", fileSchema(reader.ChangeReader().StepModel()), fileLengthUnit(reader.ChangeReader())};

  // Skip the self-intersection fixes: they cost ~13% of a large assembly's load and made
  // no visible difference on the samples. Set after reading, which creates the actor that takes them.
  using FixMode             = DE_ShapeFixParameters::FixMode;
  DE_ShapeFixParameters fix = DESTEP_Parameters::GetDefaultShapeFixParameters();
  fix.FixSelfIntersectionMode             = FixMode::NotFix;
  fix.FixSelfIntersectingEdgeMode         = FixMode::NotFix;
  fix.FixIntersectingEdgesMode            = FixMode::NotFix;
  fix.FixNonAdjacentIntersectingEdgesMode = FixMode::NotFix;
  fix.FixIntersectingWiresMode            = FixMode::NotFix;
  reader.SetShapeFixParameters(fix);

  // OCCT's transfer progress stalls for most of the stage on single-root assemblies; don't show it.
  progress("transfer", -1);
  if (!reader.Transfer(doc))
    throw std::runtime_error("STEP transfer failed");
  return src;
}

// IGES global section unit flag → STEP-style unit name.
std::string igesUnit(int flag)
{
  switch (flag)
  {
    case 1: return "INCH";
    case 2: return "MILLIMETRE";
    case 4: return "FOOT";
    case 6: return "METRE";
    case 10: return "CENTIMETRE";
    default: return {};
  }
}

Source readIgesDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  progress("read", -1);
  IGESCAFControl_Reader reader;
  reader.SetNameMode(true);
  reader.SetColorMode(true);
  reader.SetLayerMode(true);
  {
    TempFile file(".igs", bytes);
    if (reader.ReadFile(file.path()) != IFSelect_RetDone)
      throw std::runtime_error("Not a readable IGES file");
  }
  Source src{"IGES", {}, {}};
  if (auto model = Handle(IGESData_IGESModel)::DownCast(reader.Model()); !model.IsNull())
    src.unit = igesUnit(model->GlobalSection().UnitFlag());

  progress("transfer", -1);
  if (!reader.Transfer(doc))
    throw std::runtime_error("IGES transfer failed");
  return src;
}

// Mesh formats. Output is in mm and Z-up like the rest; readers convert from their file conventions.
Source readMeshDoc(RWMesh_CafReader&              reader,
                   Source                         src,
                   const std::string&             ext,
                   const std::string&             bytes,
                   const Handle(TDocStd_Document)& doc,
                   Progress&                      progress)
{
  progress("read", -1);
  reader.SetDocument(doc);
  reader.SetSystemLengthUnit(0.001);
  reader.SetSystemCoordinateSystem(RWMesh_CoordinateSystem_Zup);
  TempFile file(ext, bytes);
  if (!reader.Perform(file.path(), Message_ProgressRange()))
    throw std::runtime_error("Not a readable " + src.format + " file");
  return src;
}

Source readGltfDoc(const std::string& ext, const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  RWGltf_CafReader reader; // glTF is defined in metres, Y-up
  if (ext == ".glb")
    return readMeshDoc(reader, {"glTF", {}, "METRE"}, ext, bytes, doc, progress);

  // OCCT only decodes octet-stream data URIs; the spec also allows gltf-buffer.
  static const std::string kSpecUri = "data:application/gltf-buffer;base64,";
  static const std::string kOcctUri = "data:application/octet-stream;base64,";
  std::string json = bytes;
  for (size_t at = json.find(kSpecUri); at != std::string::npos; at = json.find(kSpecUri, at))
    json.replace(at, kSpecUri.size(), kOcctUri);
  return readMeshDoc(reader, {"glTF", {}, "METRE"}, ext, json, doc, progress);
}

Source readObjDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  RWObj_CafReader reader; // OBJ has no units; OCCT assumes Y-up
  return readMeshDoc(reader, {"OBJ", {}, {}}, ".obj", bytes, doc, progress);
}

Source readVrmlDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  // VRML is metres by spec, but CAD exporters rarely honour it; coordinates are taken as mm.
  VrmlAPI_CafReader reader;
  reader.SetFileLengthUnit(1.0); // VrmlData multiplies coordinates by this
  return readMeshDoc(reader, {"VRML", {}, {}}, ".wrl", bytes, doc, progress);
}

TDF_Label addShape(const Handle(TDocStd_Document)& doc, const TopoDS_Shape& shape, const std::string& name)
{
  const TDF_Label l = XCAFDoc_DocumentTool::ShapeTool(doc->Main())->AddShape(shape, true);
  TDataStd_Name::Set(l, TCollection_ExtendedString(name.c_str(), true));
  return l;
}

// Each triangle corner gets the area-weighted average normal of the triangles at its node that lie
// within creaseAngle of the corner's own triangle (area, not corner angle: sliver normals are noisy).
// Unlike RWStl's merge angle (compared against whichever triangle reached a node first) this does
// not depend on triangle order. Nodes are split once per distinct normal.
Handle(Poly_Triangulation) withCreasedNormals(const Handle(Poly_Triangulation)& tri, double creaseAngle)
{
  const int nbTris = tri->NbTriangles();
  std::vector<gp_XYZ>             triNormal(nbTris), triArea(nbTris); // unit normal, area-scaled normal
  std::vector<std::array<int, 3>> triNodes(nbTris);
  std::vector<std::vector<int>>   nodeTris(tri->NbNodes() + 1);
  for (int i = 0; i < nbTris; ++i)
  {
    auto& n = triNodes[i];
    tri->Triangle(i + 1).Get(n[0], n[1], n[2]);
    const gp_XYZ p[3] = {tri->Node(n[0]).XYZ(), tri->Node(n[1]).XYZ(), tri->Node(n[2]).XYZ()};
    const gp_XYZ c    = (p[1] - p[0]).Crossed(p[2] - p[0]);
    triNormal[i]      = c.Modulus() > 0 ? c / c.Modulus() : gp_XYZ();
    triArea[i]        = c;
    for (int k = 0; k < 3; ++k)
      nodeTris[n[k]].push_back(i);
  }

  const double                                    cosCrease = std::cos(creaseAngle);
  std::vector<std::vector<std::pair<gp_XYZ, int>>> split(nodeTris.size()); // per old node: (normal, new node)
  std::vector<gp_XYZ>                             nodes, normals;
  std::vector<std::array<int, 3>>                 tris(nbTris);
  for (int i = 0; i < nbTris; ++i)
    for (int k = 0; k < 3; ++k)
    {
      const int v = triNodes[i][k];
      gp_XYZ    sum;
      for (const int j : nodeTris[v])
        if (triNormal[j].Dot(triNormal[i]) >= cosCrease)
          sum += triArea[j];
      const gp_XYZ n     = sum.Modulus() > 0 ? sum / sum.Modulus() : gp_XYZ(0, 0, 1);
      auto&        known = split[v];
      auto         found = std::find_if(known.begin(), known.end(), [&](const auto& e) { return e.first.IsEqual(n, 1e-6); });
      if (found == known.end())
      {
        nodes.push_back(tri->Node(v).XYZ());
        normals.push_back(n);
        found = known.insert(known.end(), {n, int(nodes.size())});
      }
      tris[i][k] = found->second;
    }

  Handle(Poly_Triangulation) out = new Poly_Triangulation(int(nodes.size()), nbTris, false, true);
  for (int i = 0; i < int(nodes.size()); ++i)
  {
    out->SetNode(i + 1, nodes[i]);
    out->SetNormal(i + 1, gp_Dir(normals[i]));
  }
  for (int i = 0; i < nbTris; ++i)
    out->SetTriangle(i + 1, Poly_Triangle(tris[i][0], tris[i][1], tris[i][2]));
  return out;
}

Source readStlDoc(const std::string& bytes, const std::string& name, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  progress("read", -1);
  Handle(Poly_Triangulation) tri;
  {
    TempFile file(".stl", bytes);
    tri = RWStl::ReadFile(file.path(), M_PI / 2.0); // merge all coincident nodes; creases are handled below
  }
  if (tri.IsNull() || tri->NbTriangles() == 0)
    throw std::runtime_error("Not a readable STL file");
  TopoDS_Face face;
  // 20°, not 30°: CAD exports put shallow chamfers at 20-30° to long sliver walls, and smoothing across
  // them shades the slivers as dark wedges.
  BRep_Builder().MakeFace(face, withCreasedNormals(tri, 20.0 * M_PI / 180.0));
  addShape(doc, face, name);
  return {"STL", {}, {}}; // no units in STL; taken as mm
}

Source readBrepDoc(const std::string& bytes, const std::string& name, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  progress("read", -1);
  std::istringstream stream(bytes);
  TopoDS_Shape       shape;
  BRepTools::Read(shape, stream, BRep_Builder());
  if (shape.IsNull())
    throw std::runtime_error("Not a readable BREP file");
  addShape(doc, shape, name);
  return {"BREP", {}, {}};
}

Source readJtDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  progress("read", -1);
  TempFile file(".jt", bytes);
  Source   src{"JT", {}, {}, {}};
  src.unit = readJt(file.path(), doc, src.jtPmi);
  return src;
}

std::string lowerExtension(const std::string& fileName)
{
  const size_t dot = fileName.rfind('.');
  std::string  ext = dot == std::string::npos ? std::string() : fileName.substr(dot);
  for (char& c : ext)
    c = char(std::tolower(static_cast<unsigned char>(c)));
  return ext;
}

Source readDoc(const std::string&              bytes,
               const std::string&              fileName,
               const Handle(TDocStd_Document)& doc,
               Progress&                       progress)
{
  const std::string ext  = lowerExtension(fileName);
  const std::string name = fileName.substr(0, fileName.size() - ext.size());
  if (ext == ".stp" || ext == ".step")
    return readStepDoc(bytes, doc, progress);
  if (ext == ".igs" || ext == ".iges")
    return readIgesDoc(bytes, doc, progress);
  if (ext == ".gltf" || ext == ".glb")
    return readGltfDoc(ext, bytes, doc, progress);
  if (ext == ".obj")
    return readObjDoc(bytes, doc, progress);
  if (ext == ".wrl" || ext == ".vrml")
    return readVrmlDoc(bytes, doc, progress);
  if (ext == ".stl")
    return readStlDoc(bytes, name, doc, progress);
  if (ext == ".brep" || ext == ".brp")
    return readBrepDoc(bytes, name, doc, progress);
  if (ext == ".jt")
    return readJtDoc(bytes, doc, progress);
  throw std::runtime_error("Unsupported file type: " + (ext.empty() ? fileName : ext));
}

// ---------------------------------------------------------------------------
// JSON

void writeRange(std::ostringstream& o, const char* key, const Range& r)
{
  o << '"' << key << "\":[" << r.offset << ',' << r.count << ']';
}

std::string toJson(const Source& src, const Builder& b)
{
  std::ostringstream o;
  o.precision(9);
  o << "{\"format\":\"" << src.format << "\",\"schema\":\"" << jsonEscape(src.schema)
    << "\",\"fileUnit\":\"" << jsonEscape(src.unit) << "\",";

  o << "\"colors\":[";
  for (size_t i = 0; i < b.colors().size(); ++i)
  {
    const auto& c = b.colors()[i];
    o << (i ? "," : "") << '[' << c[0] << ',' << c[1] << ',' << c[2] << ',' << c[3] << ']';
  }
  o << "],\"nodes\":[";
  for (size_t i = 0; i < b.nodes().size(); ++i)
  {
    const Node& n = b.nodes()[i];
    o << (i ? "," : "") << "{\"name\":\"" << jsonEscape(n.name) << "\",\"parent\":" << n.parent
      << ",\"proto\":" << n.proto << ",\"color\":" << n.color;
    if (n.hasMatrix)
    {
      o << ",\"matrix\":[";
      for (int k = 0; k < 16; ++k)
        o << (k ? "," : "") << n.matrix[k];
      o << ']';
    }
    o << '}';
  }
  o << "],\"protos\":[";
  for (size_t i = 0; i < b.protos().size(); ++i)
  {
    const Proto& p = b.protos()[i];
    o << (i ? "," : "") << '{';
    writeRange(o, "positions", p.positions);
    o << ',';
    writeRange(o, "normals", p.normals);
    o << ',';
    writeRange(o, "indices", p.indices);
    o << ',';
    writeRange(o, "edges", p.edges);
    o << ',';
    writeRange(o, "faceStarts", p.faceStarts);
    o << ',';
    writeRange(o, "faceData", p.faceData);
    o << ',';
    writeRange(o, "edgeStarts", p.edgeStarts);
    o << ',';
    writeRange(o, "edgeData", p.edgeData);
    o << ",\"groups\":[";
    for (size_t g = 0; g < p.groups.size(); ++g)
      o << (g ? "," : "") << '[' << p.groups[g].start << ',' << p.groups[g].count << ','
        << p.groups[g].color << ']';
    o << "]}";
  }
  o << "],\"pmi\":[";
  auto numbers = [&o](const char* key, const std::vector<double>& v) {
    if (v.empty())
      return;
    o << ",\"" << key << "\":[";
    for (size_t k = 0; k < v.size(); ++k)
      o << (k ? "," : "") << v[k];
    o << ']';
  };
  auto xyz = [&o](const char* key, const gp_XYZ& v) {
    o << ",\"" << key << "\":[" << v.X() << ',' << v.Y() << ',' << v.Z() << ']';
  };
  for (size_t i = 0; i < b.pmi().size(); ++i)
  {
    const Pmi& p = b.pmi()[i];
    o << (i ? "," : "") << "{\"kind\":\"" << p.kind << "\",\"type\":\"" << jsonEscape(p.type) << "\",\"name\":\""
      << jsonEscape(p.name) << "\",\"proto\":" << p.proto << ',';
    writeRange(o, "segments", p.segments);
    o << ',';
    writeRange(o, "triangles", p.triangles);
    o << ",\"faces\":[";
    for (size_t k = 0; k < p.faces.size(); ++k)
      o << (k ? "," : "") << p.faces[k];
    o << ']';
    numbers("value", p.value);
    numbers("plusMinus", p.plusMinus);
    numbers("range", p.range);
    if (p.angular)
      o << ",\"angular\":true";
    if (!p.datums.empty())
    {
      o << ",\"datums\":[";
      for (size_t k = 0; k < p.datums.size(); ++k)
        o << (k ? "," : "") << '"' << jsonEscape(p.datums[k]) << '"';
      o << ']';
    }
    o << '}';
  }
  o << "],\"views\":[";
  for (size_t i = 0; i < b.views().size(); ++i)
  {
    const SavedView& v = b.views()[i];
    o << (i ? "," : "") << "{\"name\":\"" << jsonEscape(v.name) << '"';
    xyz("direction", v.direction.XYZ());
    xyz("up", v.up.XYZ());
    o << ",\"pmi\":[";
    for (size_t k = 0; k < v.pmi.size(); ++k)
      o << (k ? "," : "") << v.pmi[k];
    o << "]}";
  }
  o << "]}";
  return o.str();
}

// ---------------------------------------------------------------------------
// Entry point

val readModel(const std::string& bytes, const std::string& fileName, val jsOptions, val onProgress)
{
  Options opts;
  if (!jsOptions.isUndefined() && !jsOptions.isNull())
  {
    if (jsOptions["linearDeflection"].isNumber())
      opts.linearDeflection = jsOptions["linearDeflection"].as<double>();
    if (jsOptions["angularDeflection"].isNumber())
      opts.angularDeflection = jsOptions["angularDeflection"].as<double>();
  }

  // Silence OCCT's default stdout messenger; errors are returned to JS.
  static const bool quiet =
    (Message::DefaultMessenger()->RemovePrinters(STANDARD_TYPE(Message_Printer)), true);
  (void)quiet;

  gGeometry.clear();
  gGeometry.shrink_to_fit();

  val result = val::object();
  try
  {
    Progress progress(onProgress);

    Handle(TDocStd_Document) doc;
    XCAFApp_Application::GetApplication()->NewDocument("BinXCAF", doc);

    const Source src = readDoc(bytes, fileName, doc, progress);

    Builder builder(doc, opts, progress);
    builder.build(src.jtPmi);

    result.set("json", toJson(src, builder));
    result.set("geometry", val(emscripten::typed_memory_view(gGeometry.size(), gGeometry.data())));

    XCAFApp_Application::GetApplication()->Close(doc);
  }
  catch (const Standard_Failure& e)
  {
    result.set("error", std::string("OCCT: ") + e.what());
  }
  catch (const std::exception& e)
  {
    result.set("error", std::string(e.what()));
  }
  return result;
}

} // namespace

EMSCRIPTEN_BINDINGS(occt_viewer)
{
  emscripten::function("readModel", &readModel);
}
