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
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
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
        myColors(XCAFDoc_DocumentTool::ColorTool(doc->Main()))
  {
  }

  void build()
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
  }

  const std::vector<Node>&  nodes() const { return myNodes; }
  const std::vector<Proto>& protos() const { return myProtos; }
  const std::vector<RGBA>&  colors() const { return myColorTable; }

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
    {
      TopoDS_Compound toMesh;
      BRep_Builder    bb;
      bb.MakeCompound(toMesh);
      bool any = false;
      for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
      {
        const TopoDS_Face& f = TopoDS::Face(ex.Current());
        if (!BRep_Tool::Surface(f).IsNull())
        {
          bb.Add(toMesh, f);
          any = true;
        }
      }
      if (any)
      {
        Bnd_Box box;
        BRepBndLib::Add(shape, box);
        const double diag = box.IsVoid() ? 1.0 : std::sqrt(box.SquareExtent());
        BRepMesh_IncrementalMesh(toMesh,
                                 std::max(diag * myOpts.linearDeflection, 1e-4),
                                 false,
                                 myOpts.angularDeflection,
                                 false);
      }
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

      const int* found = colorOf.Seek(face);
      const int  color = found ? *found : partColor;
      const auto count = uint32_t(idx.size()) - start;
      if (!proto.groups.empty() && proto.groups.back().color == color)
        proto.groups.back().count += count;
      else
        proto.groups.push_back({start, count, color});
    }

    collectEdges(shape, edges, edgeStarts, edgeData);

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
  static void collectEdges(const TopoDS_Shape&    shape,
                           std::vector<float>&    out,
                           std::vector<uint32_t>& starts,
                           std::vector<double>&   data)
  {
    EdgeFacesMap edgeFaces;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

    for (int i = 1; i <= edgeFaces.Extent(); ++i)
    {
      const TopoDS_Edge& edge = TopoDS::Edge(edgeFaces.FindKey(i));
      if (BRep_Tool::Degenerated(edge) || edgeFaces(i).IsEmpty())
        continue;
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
};

// Readers: each fills the XCAF document and describes the source.

struct Source
{
  std::string format;
  std::string schema; // STEP only
  std::string unit;   // file length unit name as in STEP ("MILLIMETRE", "INCH", ...); empty = mm
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
  reader.SetGDTMode(false); // PMI out of scope for now
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

Source readStlDoc(const std::string& bytes, const std::string& name, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  progress("read", -1);
  Handle(Poly_Triangulation) tri;
  {
    TempFile file(".stl", bytes);
    tri = RWStl::ReadFile(file.path(), 30.0 * M_PI / 180.0); // split nodes at creases for flat shading there
  }
  if (tri.IsNull() || tri->NbTriangles() == 0)
    throw std::runtime_error("Not a readable STL file");
  TopoDS_Face face;
  BRep_Builder().MakeFace(face, tri);
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
  return {"JT", {}, readJt(file.path(), doc)};
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
    builder.build();

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
