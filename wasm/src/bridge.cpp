// STEP / IGES / BREP / JT / OBJ / STL / VRML → mesh bridge for the browser (glTF is read in the browser).
//
// readModel(bytes, fileName, options) returns { json, geometry, memory }:
//   json     — model description (format, schema, units, node tree, prototypes, colors)
//   geometry — Uint8Array view over one packed buffer; JSON offsets point into it.
//              The view aliases WASM memory and is valid until the next call: copy it.
//   memory   — allocated bytes and heap size as each stage started, for diagnostics.
//
// Every format is read into an XCAF document; the Builder turns that into the output.
// Geometry is meshed once per prototype (part definition) and shared by all instances.

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <DESTEP_Parameters.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <GProp_GProps.hxx>
#include <HeaderSection_FileSchema.hxx>
#include <IGESCAFControl_Reader.hxx>
#include <IGESData_IGESModel.hxx>
#include <Interface_EntityIterator.hxx>
#include <Interface_Graph.hxx>
#include <Interface_Static.hxx>
#include <Interface_HArray1OfHAsciiString.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <NCollection_DataMap.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_Sequence.hxx>
#include <OSD_Path.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <RWObj_CafReader.hxx>
#include <RWStl.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPConstruct_ExternRefs.hxx>
#include <STEPConstruct_UnitContext.hxx>
#include <STEPConstruct_ValidationProps.hxx>
#include <STEPControl_Reader.hxx>
#include <StepBasic_Approval.hxx>
#include <StepBasic_ApprovalAssignment.hxx>
#include <StepBasic_ApprovalDateTime.hxx>
#include <StepBasic_ApprovalPersonOrganization.hxx>
#include <StepBasic_ApprovalRole.hxx>
#include <StepBasic_ApprovalStatus.hxx>
#include <StepBasic_AreaUnit.hxx>
#include <StepBasic_CalendarDate.hxx>
#include <StepBasic_DateAndTime.hxx>
#include <StepBasic_DateAndTimeAssignment.hxx>
#include <StepBasic_DateAssignment.hxx>
#include <StepBasic_DateRole.hxx>
#include <StepBasic_DateTimeSelect.hxx>
#include <StepBasic_DateTimeRole.hxx>
#include <StepBasic_DerivedUnit.hxx>
#include <StepAP214_AppliedExternalIdentificationAssignment.hxx>
#include <StepBasic_DerivedUnitElement.hxx>
#include <StepBasic_DocumentFile.hxx>
#include <StepBasic_DocumentRepresentationType.hxx>
#include <StepBasic_ExternalSource.hxx>
#include <StepData_SelectNamed.hxx>
#include <StepBasic_LocalTime.hxx>
#include <StepBasic_MeasureValueMember.hxx>
#include <StepBasic_MeasureWithUnit.hxx>
#include <StepBasic_NamedUnit.hxx>
#include <StepBasic_Organization.hxx>
#include <StepBasic_OrganizationAssignment.hxx>
#include <StepBasic_OrganizationRole.hxx>
#include <StepBasic_Person.hxx>
#include <StepBasic_PersonAndOrganization.hxx>
#include <StepBasic_PersonAndOrganizationAssignment.hxx>
#include <StepBasic_PersonAndOrganizationRole.hxx>
#include <StepBasic_PersonOrganizationSelect.hxx>
#include <StepBasic_Product.hxx>
#include <StepBasic_ProductDefinition.hxx>
#include <StepBasic_ProductDefinitionFormation.hxx>
#include <StepBasic_SecurityClassification.hxx>
#include <StepBasic_SecurityClassificationAssignment.hxx>
#include <StepBasic_SecurityClassificationLevel.hxx>
#include <StepBasic_VolumeUnit.hxx>
#include <StepData_StepModel.hxx>
#include <StepBasic_ConversionBasedUnit.hxx>
#include <StepBasic_SiUnit.hxx>
#include <STEPConstruct_Tool.hxx>
#include <StepBasic_ProductDefinitionReferenceWithLocalRepresentation.hxx>
#include <StepRepr_QuantifiedNextAssemblyUsageOccurrence.hxx>
#include <StepRepr_PromissoryUsageOccurrence.hxx>
#include <StepGeom_GeomRepContextAndGlobUnitAssCtxAndGlobUncertaintyAssCtx.hxx>
#include <StepGeom_GeometricRepresentationContextAndGlobalUnitAssignedContext.hxx>
#include <StepRepr_GlobalUnitAssignedContext.hxx>
#include <StepRepr_CharacterizedDefinition.hxx>
#include <StepRepr_MaterialDesignation.hxx>
#include <StepRepr_MeasureRepresentationItem.hxx>
#include <StepRepr_ProductDefinitionShape.hxx>
#include <StepRepr_PropertyDefinition.hxx>
#include <StepRepr_PropertyDefinitionRepresentation.hxx>
#include <StepRepr_Representation.hxx>
#include <StepRepr_ValueRepresentationItem.hxx>
#include <TDF_Tool.hxx>
#include <TDataStd_Name.hxx>
#include <TDataStd_NamedData.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <NCollection_List.hxx>
#include <NCollection_Map.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TransferBRep.hxx>
#include <Transfer_TransientProcess.hxx>
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
#include <XCAFDoc_Editor.hxx>
#include <XCAFDoc_GeomTolerance.hxx>
#include <XCAFDoc_GraphNode.hxx>
#include <XCAFDoc_LayerTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFDoc_View.hxx>
#include <XCAFDoc_ViewTool.hxx>
#include <XCAFDoc_VisMaterial.hxx>
#include <XCAFView_Object.hxx>
#include <XCAFPrs.hxx>
#include <XCAFPrs_Style.hxx>
#include <XSControl_TransferReader.hxx>
#include <XSControl_WorkSession.hxx>

#include "jt_reader.h"
#include "qif_reader.h"

#include <emscripten/bind.h>
#include <emscripten/heap.h>
#include <emscripten/val.h>
#include <malloc.h>
#include <sys/stat.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <fstream>
#include <map>
#include <set>
#include <tuple>
#include <sstream>
#include <string>
#include <vector>

using emscripten::val;

using LabelSequence = NCollection_Sequence<TDF_Label>;
using FaceColorMap  = NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher>;
using ShapeIndex    = NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher>;
using FaceSet       = NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>;
using ShapeStyleMap = NCollection_IndexedDataMap<TopoDS_Shape, XCAFPrs_Style, TopTools_ShapeMapHasher>;
using EdgeFacesMap  = NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>;

namespace
{

using RGBA = std::array<float, 4>;

struct Options
{
  double linearDeflection  = 0.001; // relative to the part's bounding-box diagonal
  double angularDeflection = 0.5;   // radians
  double maxDeflection     = 0;     // mm ceiling on the linear deflection, 0 = none
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

constexpr int kMeshBatch = 2000; // faces per BRepMesh run, see meshPart; smaller batches open cracks at their seams

struct Proto
{
  Range              positions, normals, indices, edges;
  Range              faceStarts, faceData; // first index of each face (uint32) / kFaceStride doubles
  Range              edgeStarts, edgeData; // first segment of each edge (uint32) / kEdgeStride doubles
  Range              vertices;             // B-rep vertices of the drawn edges, float32 xyz
  std::vector<Group> groups;
  // B-rep face, edge and vertex → index into faceStarts, edgeStarts and vertices, to resolve PMI
  // references. Not serialised.
  ShapeIndex faceIndex, edgeIndex, vertexIndex;
};

// What PMI refers to in a part: indices into its faceStarts, edgeStarts and vertices.
struct Refs
{
  std::vector<int> faces, edges, vertices;
  bool             empty() const { return faces.empty() && edges.empty() && vertices.empty(); }
};

// JSON keys of each list in Refs, and of its per-instance form (assembly PMI).
const std::tuple<const char*, const char*, std::vector<int> Refs::*> kRefLists[] = {
  {"faces", "nodeFaces", &Refs::faces},
  {"edges", "nodeEdges", &Refs::edges},
  {"vertices", "nodeVertices", &Refs::vertices},
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
  Refs                     refs;       // what it refers to in the owning part
  // Assembly PMI: drawn in each of these nodes (the instances of the assembly it is defined in),
  // with what it refers to on the instances: per owner node and instance node
  std::vector<int>                        nodes;
  std::vector<std::tuple<int, int, Refs>> nodeRefs;
  std::vector<double>      value;      // nominal value (dimension, tolerance), if any
  std::vector<double>      plusMinus;  // lower and upper tolerance, if any
  std::vector<double>      range;      // lower and upper limit, if any
  std::string              bound;      // "max" or "min": value is a one-sided limit
  bool                     angular = false; // values in degrees, not model units
  std::vector<double>      perUnit;  // length or area sides a tolerance applies per, if any
  std::string              unitArea; // circular, rectangular or square for a unit area
  std::string              zone;      // tolerance zone form: diameter (Ø) or spherical (SØ), if either
  std::vector<std::string> modifiers; // tolerance modifiers, e.g. maximumMaterial, commonZone
  std::vector<double>      projected; // projected tolerance zone length, if any
  std::vector<double>      runout;    // runout tolerance zone orientation angle, if any
  std::vector<double>      maxValue;  // maximum upper tolerance, if any
  std::vector<double>      unequal;   // displacement of an unequally disposed zone (Ⓤ), if any
  // Datum reference frame: compartments in precedence order; several datums in one are a
  // common datum (A-B).
  std::vector<std::vector<DatumRef>> datums;
  std::optional<gp_Ax2>              datumAxes; // axis system of the datum reference frame, if given
};

// A saved view (STEP camera model) with the PMI it shows. OCCT keeps no camera position, so the
// viewer frames the view's PMI from its direction.
struct SavedView
{
  std::string      name;
  gp_Dir           direction, up; // direction the camera looks
  std::vector<int> pmi;
};

// Assembly PMI: per GD&T label entry, the component instances it refers to.
using AssemblyRefs = std::map<std::string, std::vector<STEPCAFControl_Reader::AssemblyShapeReference>>;

// Name/value pairs in display order.
using Props = std::vector<std::pair<std::string, std::string>>;
// Product data per XCAF definition label entry.
using ProductProps = std::map<std::string, Props>;

// Geometric validation properties a file states for a part or assembly, in mm.
struct FileValidation
{
  std::vector<double> volume, area; // empty = not stated
  std::vector<double> centroid;     // xyz
  bool                wetted = false; // area of the solids' boundary only, not of every face
};
using ValidationProps = std::map<std::string, FileValidation>; // by definition label entry

// What a file says about a part or assembly definition, beyond its shape.
struct Product
{
  Props               props;      // STEP product data: part number, revision, approval, ...
  Props               attributes; // user-defined attributes
  std::vector<double> volume;     // validation property from the file, then as computed, if any
  std::vector<double> area;       // same, for the surface area
  std::vector<double> centroid;   // same, xyz then xyz
};

struct Node
{
  std::string name;
  int         parent = -1;
  bool        hasMatrix = false;
  double      matrix[16]; // column-major
  int         proto = -1;
  int         color = -1;
  int         product = -1;
  bool        hidden  = false; // invisible in the file (STEP invisibility, hidden layers)
  Props       attributes;      // user-defined attributes of this occurrence (not of its definition)
  Props       occurrence;      // what identifies this occurrence in its assembly, and its quantity
};

std::vector<uint8_t> gGeometry;
// The file a JT load reads when it is not the one given; kept for the error of a load that fails.
std::string gMainFile;

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
// Also records the heap as each stage starts, for memory diagnostics.
class Progress
{
public:
  explicit Progress(val cb) : myCb(std::move(cb)) {}

  void operator()(const std::string& stage, int pct)
  {
    if (stage == myStage && pct == myLast)
      return;
    if (stage != myStage)
      mark(stage);
    myStage = stage;
    myLast  = pct;
    if (!myCb.isUndefined())
      myCb(stage, pct);
  }

  // Bytes allocated and WASM heap size (its high-water mark: the heap never shrinks), in MB.
  void mark(const std::string& point)
  {
    val m = val::object();
    m.set("at", point);
    m.set("allocatedMB", double(mallinfo().uordblks) / (1 << 20));
    m.set("heapMB", double(emscripten_get_heap_size()) / (1 << 20));
    myMemory.call<void>("push", m);
  }

  const val& memory() const { return myMemory; }

private:
  val         myCb;
  std::string myStage;
  int         myLast   = -1;
  val         myMemory = val::array();
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

std::string entryOf(const TDF_Label& l)
{
  TCollection_AsciiString entry;
  TDF_Tool::Entry(l, entry);
  return entry.ToCString();
}

std::string labelName(const TDF_Label& l)
{
  Handle(TDataStd_Name) n;
  if (!l.FindAttribute(TDataStd_Name::GetID(), n))
    return {};
  return TCollection_AsciiString(n->Get()).ToCString(); // UTF-8
}

// STEP string without the blanks files put in for "no value".
std::string stepText(const Handle(TCollection_HAsciiString)& s)
{
  std::string t = s.IsNull() ? std::string() : s->ToCString();
  t.erase(0, t.find_first_not_of(' '));
  t.erase(t.find_last_not_of(' ') + 1);
  return t;
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

// The mesh cannot follow features smaller than its deflection (a fan blade's 1 mm leading edge round
// at 0.9 mm), so exact surface normals at nodes on them disagree with the triangles around them and
// shade as spikes. Such nodes take the area-weighted normal of their triangles instead.
void matchNormalsToMesh(const Handle(Poly_Triangulation)& tri, double maxAngle)
{
  std::vector<gp_XYZ> sum(tri->NbNodes() + 1);
  for (int i = 1; i <= tri->NbTriangles(); ++i)
  {
    int n[3];
    tri->Triangle(i).Get(n[0], n[1], n[2]);
    const gp_XYZ p[3] = {tri->Node(n[0]).XYZ(), tri->Node(n[1]).XYZ(), tri->Node(n[2]).XYZ()};
    const gp_XYZ c    = (p[1] - p[0]).Crossed(p[2] - p[0]);
    for (const int v : n)
      sum[v] += c;
  }
  const double cosMax = std::cos(maxAngle);
  for (int i = 1; i <= tri->NbNodes(); ++i)
  {
    const double length = sum[i].Modulus();
    if (length > 0 && gp_XYZ(tri->Normal(i).XYZ()).Dot(sum[i]) < cosMax * length)
      tri->SetNormal(i, gp_Dir(sum[i]));
  }
}

// ---------------------------------------------------------------------------
// Model builder

// Whether any face is exact (has a surface), not only a triangulation.
bool hasSurface(const TopoDS_Shape& shape)
{
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
    if (!BRep_Tool::Surface(TopoDS::Face(ex.Current())).IsNull())
      return true;
  return false;
}

// Label entries: bodies whose faces without a surface are not drawn, components not drawn; see exactBodies.
struct ExactBodies
{
  std::set<std::string> bodies, skip;
};

class Builder
{
public:
  Builder(const Handle(TDocStd_Document)& doc, const Options& opts, Progress& progress)
      : myOpts(opts),
        myProgress(progress),
        myShapes(XCAFDoc_DocumentTool::ShapeTool(doc->Main())),
        myColors(XCAFDoc_DocumentTool::ColorTool(doc->Main())),
        myLayers(XCAFDoc_DocumentTool::LayerTool(doc->Main())),
        myDimTols(XCAFDoc_DocumentTool::DimTolTool(doc->Main())),
        myViews(XCAFDoc_DocumentTool::ViewTool(doc->Main()))
  {
  }

  void build(const FilePmi& filePmi, const ProductProps& productProps, const ValidationProps& validation, const AssemblyRefs& assemblyRefs,
             const ProductProps& occurrences, const ExactBodies& exactBodies)
  {
    myExactBodies  = &exactBodies;
    myOccurrences  = &occurrences;
    myAssemblyRefs = &assemblyRefs;
    myProductProps = &productProps;
    myValidation   = &validation;

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
      visit(root, -1, {});

    collectPmi();
    collectViews();
    addFilePmi(filePmi);
  }

  const std::vector<Node>&      nodes() const { return myNodes; }
  const std::vector<Proto>&     protos() const { return myProtos; }
  const std::vector<RGBA>&      colors() const { return myColorTable; }
  const std::vector<Pmi>&       pmi() const { return myPmi; }
  const std::vector<SavedView>& views() const { return myViewList; }
  const std::vector<Product>&   products() const { return myProducts; }

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

  // Hidden in the file: the label is invisible, or all the layers it is on are (as XCAFPrs decides).
  bool isVisible(const TDF_Label& l) const
  {
    if (!XCAFDoc_ColorTool::IsVisible(l))
      return false;
    LabelSequence layers;
    if (!myLayers->GetLayers(l, layers) || layers.IsEmpty())
      return true;
    return std::any_of(layers.begin(), layers.end(), [this](const TDF_Label& layer) { return myLayers->IsVisible(layer); });
  }

  // path: the component labels from the root down to this one, for colours and visibility a file
  // sets on one occurrence of a nested component (SHUO).
  void visit(const TDF_Label& label, int parent, LabelSequence path)
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
    node.color  = labelColor(label);
    node.hidden = !isVisible(label) || !isVisible(def);
    if (XCAFDoc_ShapeTool::IsComponent(label))
    {
      if (myExactBodies->skip.count(entryOf(label)))
        return;
      path.Append(label);
      occurrenceStyle(path, node);
      node.attributes = occurrenceAttributes(path);
      if (const auto o = myOccurrences->find(entryOf(label)); o != myOccurrences->end())
        node.occurrence = o->second;
    }

    const bool assembly = XCAFDoc_ShapeTool::IsAssembly(def);
    if (!assembly)
    {
      node.proto = protoFor(def);
      if (node.proto < 0)
        return; // no renderable geometry (e.g. empty PMI/presentation shapes)
    }
    node.product = productFor(def);

    const int id = int(myNodes.size());
    myNodes.push_back(node);
    myNodesByDef[entryOf(def)].push_back(id);
    if (XCAFDoc_ShapeTool::IsComponent(label))
      myChildByComponent[{parent, entryOf(label)}] = id;

    if (assembly)
    {
      LabelSequence comps;
      XCAFDoc_ShapeTool::GetComponents(def, comps, false);
      for (const TDF_Label& c : comps)
        visit(c, id, path);
    }
  }

  // User-defined attributes of this occurrence: set on its component (a STEP NAUO), or through a
  // higher-level one (SHUO; a STEP multi_level_reference_designator).
  Props occurrenceAttributes(const LabelSequence& path) const
  {
    Props out = namedData(path.Last());
    for (int first = 1; first < path.Length(); ++first)
    {
      LabelSequence chain;
      for (int i = first; i <= path.Length(); ++i)
        chain.Append(path(i));
      Handle(XCAFDoc_GraphNode) shuo;
      if (myShapes->FindSHUO(chain, shuo))
        for (auto& attribute : namedData(shuo->Label()))
          out.push_back(std::move(attribute));
    }
    return out;
  }

  // Colour and visibility set on this occurrence through a higher-level one (SHUO). The longest
  // chain the file styles wins: it names the occurrence most specifically.
  void occurrenceStyle(const LabelSequence& path, Node& node)
  {
    for (int first = 1; first < path.Length(); ++first)
    {
      LabelSequence chain;
      for (int i = first; i <= path.Length(); ++i)
        chain.Append(path(i));
      Handle(XCAFDoc_GraphNode) shuo;
      if (!myShapes->FindSHUO(chain, shuo))
        continue;
      const TDF_Label    l = shuo->Label();
      Quantity_ColorRGBA c;
      if (myColors->GetColor(l, XCAFDoc_ColorSurf, c) || myColors->GetColor(l, XCAFDoc_ColorGen, c))
        node.color = colorIndex(toRGBA(c));
      node.hidden = node.hidden || !XCAFDoc_ColorTool::IsVisible(l);
      return;
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
    const int idx   = proto.indices.count || proto.edges.count ? int(myProtos.size()) : -1; // line-only parts too
    if (idx >= 0)
      myProtos.push_back(std::move(proto));
    myProtoByEntry[entry.ToCString()] = idx;
    myProgress("mesh", int(100 * std::min(++myPartsMeshed, myPartCount) / std::max(myPartCount, 1)));
    return idx;
  }

  // Product data, user-defined attributes and validation properties of a definition; -1 if none.
  int productFor(const TDF_Label& def)
  {
    TCollection_AsciiString entry;
    TDF_Tool::Entry(def, entry);
    auto it = myProductByEntry.find(entry.ToCString());
    if (it != myProductByEntry.end())
      return it->second;

    Product p;
    if (auto props = myProductProps->find(entry.ToCString()); props != myProductProps->end())
      p.props = props->second;
    addLayers(def, p.props);
    p.attributes = namedData(def);

    // Validation properties: the file's value, then the B-rep's when it has exact surfaces.
    if (auto v = myValidation->find(entry.ToCString()); v != myValidation->end())
    {
      const FileValidation& file = v->second;
      p.volume                   = file.volume;
      p.area                     = file.area;
      p.centroid                 = file.centroid;
      const TopoDS_Shape shape   = XCAFDoc_ShapeTool::GetShape(def);
      // Volume and centroid of the solids when there are any (open surfaces have no volume). Of what is
      // drawn: each solid and face once, and no tessellation beside exact surfaces (see exactBodies).
      TopoDS_Compound solids, faces;
      BRep_Builder    bb;
      bb.MakeCompound(solids);
      bb.MakeCompound(faces);
      FaceSet   seen;
      bool      hasSolids = false;
      const bool exact    = hasSurface(shape);
      for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next())
        if (seen.Add(ex.Current()) && hasSurface(ex.Current()))
        {
          bb.Add(solids, ex.Current());
          hasSolids = true;
        }
      for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
        if (seen.Add(ex.Current()) && !BRep_Tool::Surface(TopoDS::Face(ex.Current())).IsNull())
          bb.Add(faces, ex.Current());
      if (exact)
      {
        GProp_GProps volume, area;
        if (hasSolids && (!p.volume.empty() || !p.centroid.empty()))
          BRepGProp::VolumeProperties(solids, volume);
        if (!p.area.empty() || (!p.centroid.empty() && !hasSolids))
          BRepGProp::SurfaceProperties(file.wetted && hasSolids ? TopoDS_Shape(solids) : TopoDS_Shape(faces), area);
        if (!p.volume.empty() && hasSolids)
          p.volume.push_back(volume.Mass());
        if (!p.area.empty())
          p.area.push_back(area.Mass());
        if (!p.centroid.empty())
        {
          const gp_Pnt g = (hasSolids ? volume : area).CentreOfMass();
          p.centroid.insert(p.centroid.end(), {g.X(), g.Y(), g.Z()});
        }
      }
    }

    int idx = -1;
    if (!p.props.empty() || !p.attributes.empty() || !p.volume.empty() || !p.area.empty() || !p.centroid.empty())
    {
      idx = int(myProducts.size());
      myProducts.push_back(std::move(p));
    }
    myProductByEntry[entry.ToCString()] = idx;
    return idx;
  }

  // Layers a definition or its bodies are on.
  void addLayers(const TDF_Label& def, Props& props) const
  {
    LabelSequence labels;
    labels.Append(def);
    XCAFDoc_ShapeTool::GetSubShapes(def, labels);
    for (const TDF_Label& l : labels)
    {
      const auto layers = myLayers->GetLayers(l); // held: a range-for over *GetLayers(l) frees it
      for (const TCollection_ExtendedString& layer : *layers)
      {
        const std::pair<std::string, std::string> p("Layer", TCollection_AsciiString(layer).ToCString());
        if (std::find(props.begin(), props.end(), p) == props.end())
          props.push_back(p);
      }
    }
  }

  // Strings, integers and reals of a label's named data (e.g. STEP user-defined attributes), by name.
  static Props namedData(const TDF_Label& l)
  {
    Handle(TDataStd_NamedData) data;
    if (!l.FindAttribute(TDataStd_NamedData::GetID(), data))
      return {};
    data->LoadDeferredData();
    Props out;
    auto  name = [](const TCollection_ExtendedString& s) { return std::string(TCollection_AsciiString(s).ToCString()); };
    if (data->HasStrings())
      for (const auto& [key, value] : data->GetStringsContainer().Items())
        out.emplace_back(name(key), name(value));
    if (data->HasIntegers())
      for (const auto& [key, value] : data->GetIntegersContainer().Items())
        out.emplace_back(name(key), std::to_string(value));
    if (data->HasReals())
      for (const auto& [key, value] : data->GetRealsContainer().Items())
      {
        std::ostringstream s;
        s.precision(9);
        s << value;
        out.emplace_back(name(key), s.str());
      }
    std::sort(out.begin(), out.end()); // the maps keep no file order
    return out;
  }

  Proto meshPart(const TDF_Label& def, const TopoDS_Shape& shape)
  {
    // B-rep faces need meshing; AP242 tessellated faces already carry a triangulation.
    // Meshed in batches: BRepMesh keeps working data for every face it is given until it is done,
    // which is ~1 GB on a part with 14k faces. Shared edges keep the polygon the first batch made.
    bool hasSurfaces = false;
    {
      const double    linear = deflection(shape);
      TopoDS_Compound batch;
      BRep_Builder    bb;
      int             inBatch = 0;
      auto            flush   = [&] {
        if (inBatch)
          BRepMesh_IncrementalMesh(batch, linear, false, myOpts.angularDeflection, false);
        bb.MakeCompound(batch);
        inBatch = 0;
      };
      flush();
      for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
      {
        const TopoDS_Face& f = TopoDS::Face(ex.Current());
        if (BRep_Tool::Surface(f).IsNull())
          continue;
        bb.Add(batch, f);
        hasSurfaces = true;
        if (++inBatch == kMeshBatch)
          flush();
      }
      flush();
    }

    int        partColor = -1;
    FaceSet    hidden;
    const auto colorOf   = faceStyles(def, shape, partColor, hidden);
    const bool exactOnly = myExactBodies->bodies.count(entryOf(def)) > 0;

    std::vector<float>    pos, nrm, edges, vertices;
    std::vector<uint32_t> idx, faceStarts, edgeStarts;
    std::vector<double>   faceData, edgeData;
    Proto                 proto;

    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
    {
      const TopoDS_Face&         face = TopoDS::Face(ex.Current());
      TopLoc_Location            loc;
      Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
      if (tri.IsNull() || tri->NbTriangles() == 0 || hidden.Contains(face) || (exactOnly && BRep_Tool::Surface(face).IsNull()))
        continue;

      if (!tri->HasNormals())
      {
        BRepLib_ToolTriangulatedShape::ComputeNormals(face, tri);
        // Nodes the mesher resolved lie within about half its angular deflection of their triangles.
        matchNormalsToMesh(tri, 0.7 * myOpts.angularDeflection);
      }

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
    collectEdges(shape, !hasSurfaces, hidden, edges, edgeStarts, edgeData, proto, vertices);

    proto.positions  = append(pos);
    proto.normals    = append(nrm);
    proto.indices    = append(idx);
    proto.edges      = append(edges);
    proto.faceStarts = append(faceStarts);
    proto.faceData   = append(faceData);
    proto.edgeStarts = append(edgeStarts);
    proto.edgeData   = append(edgeData);
    proto.vertices   = append(vertices);
    return proto;
  }

  // Linear meshing deflection for a part, relative to its size.
  double deflection(const TopoDS_Shape& shape) const
  {
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    const double diag = box.IsVoid() ? 1.0 : std::sqrt(box.SquareExtent());
    double d = diag * myOpts.linearDeflection;
    if (myOpts.maxDeflection > 0)
      d = std::min(d, myOpts.maxDeflection);
    return std::max(d, 1e-4);
  }

  // Styles from the part and its sub-shape labels; larger shapes first so faces override solids.
  // Faces of sub-shapes the file hides (e.g. a construction body in a multi-body part) go in hidden.
  FaceColorMap faceStyles(const TDF_Label&    def,
                                            const TopoDS_Shape& shape,
                                            int&                partColor,
                                            FaceSet&            hidden)
  {
    FaceColorMap     result;
    ShapeStyleMap     styles;
    XCAFPrs::CollectStyleSettings(def, TopLoc_Location(), styles);

    std::vector<std::pair<TopoDS_Shape, int>> entries;
    for (ShapeStyleMap::Iterator it(styles); it.More(); it.Next())
    {
      // Mesh readers may give a visual material only, no surface colour.
      const XCAFPrs_Style& st = it.Value();
      if (!st.IsVisible() && !it.Key().IsPartner(shape)) // a hidden part is a hidden node, see visit
        for (TopExp_Explorer ex(it.Key(), TopAbs_FACE); ex.More(); ex.Next())
          hidden.Add(ex.Current());
      if (st.IsSetColorSurf())
        entries.emplace_back(it.Key(), colorIndex(toRGBA(st.GetColorSurfRGBA())));
      else if (!st.Material().IsNull())
        entries.emplace_back(it.Key(), colorIndex(toRGBA(st.Material()->BaseColor())));
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
  // The drawn edges and their vertices go in proto's edge and vertex index.
  void collectEdges(const TopoDS_Shape&    shape,
                    bool                   freeEdges,
                    const FaceSet&         hidden,
                    std::vector<float>&    out,
                    std::vector<uint32_t>& starts,
                    std::vector<double>&   data,
                    Proto&                 proto,
                    std::vector<float>&    vertices) const
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
        if (sampleEdge(edge, freeDeflection, out, starts, data))
          indexEdge(edge, int(starts.size()) - 1, proto, vertices);
        continue;
      }
      // The edge follows the mesh of a face that is drawn.
      const auto shown = std::find_if(edgeFaces(i).begin(), edgeFaces(i).end(), [&](const TopoDS_Shape& f) { return !hidden.Contains(f); });
      if (shown == edgeFaces(i).end())
        continue;
      const TopoDS_Face& face = TopoDS::Face(*shown);
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
      indexEdge(edge, int(starts.size()) - 1, proto, vertices);
    }
  }

  static void indexEdge(const TopoDS_Edge& edge, int index, Proto& proto, std::vector<float>& vertices)
  {
    proto.edgeIndex.TryBind(edge, index);
    TopoDS_Vertex ends[2];
    TopExp::Vertices(edge, ends[0], ends[1]);
    for (const TopoDS_Vertex& v : ends)
      if (!v.IsNull() && proto.vertexIndex.TryBind(v, int(vertices.size() / 3)))
      {
        const gp_Pnt p = BRep_Tool::Pnt(v);
        vertices.insert(vertices.end(), {float(p.X()), float(p.Y()), float(p.Z())});
      }
  }

  // Returns whether the edge had any segments.
  bool sampleEdge(const TopoDS_Edge&     edge,
                  double                 linearDeflection,
                  std::vector<float>&    out,
                  std::vector<uint32_t>& starts,
                  std::vector<double>&   data) const
  {
    const size_t at     = out.size();
    const double length = sampleCurve(edge, linearDeflection, out);
    if (out.size() == at)
      return false;
    starts.push_back(uint32_t(at / 6));
    appendEdgeData(edge, length, data);
    return true;
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
      if (obj->GetUnitSize() > 0)
      {
        p.perUnit = {obj->GetUnitSize()};
        switch (obj->GetUnitArea())
        {
          case XCAFDimTolObjects_GeomToleranceUnitArea_Circular: p.unitArea = "circular"; break;
          case XCAFDimTolObjects_GeomToleranceUnitArea_Square: p.unitArea = "square"; break;
          case XCAFDimTolObjects_GeomToleranceUnitArea_Rectangular:
            p.unitArea = "rectangular";
            p.perUnit.push_back(obj->GetSecondUnitSize());
            break;
          default: break;
        }
      }
      if (obj->GetTypeOfValue() == XCAFDimTolObjects_GeomToleranceTypeValue_Diameter)
        p.zone = "diameter";
      else if (obj->GetTypeOfValue() == XCAFDimTolObjects_GeomToleranceTypeValue_SphericalDiameter)
        p.zone = "spherical";
      if (obj->GetMaterialRequirementModifier() == XCAFDimTolObjects_GeomToleranceMatReqModif_M)
        p.modifiers.push_back("maximumMaterial");
      else if (obj->GetMaterialRequirementModifier() == XCAFDimTolObjects_GeomToleranceMatReqModif_L)
        p.modifiers.push_back("leastMaterial");
      for (const XCAFDimTolObjects_GeomToleranceModif m : obj->GetModifiers())
        if (const char* name = toleranceModifier(m))
          p.modifiers.push_back(name);
      if (obj->GetZoneModifier() == XCAFDimTolObjects_GeomToleranceZoneModif_Projected)
        p.projected = {obj->GetValueOfZoneModifier()};
      else if (obj->GetZoneModifier() == XCAFDimTolObjects_GeomToleranceZoneModif_Runout)
        p.runout = {obj->GetValueOfZoneModifier()};
      if (obj->GetMaxValueModifier() > 0)
        p.maxValue = {obj->GetMaxValueModifier()};
      if (const std::optional<double> unequal = obj->GetUnequalDisplacement())
        p.unequal = {*unequal};
      p.datums = datumFrame(l);
      if (obj->HasAxis())
        p.datumAxes = obj->GetAxis();
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

    // The owning part and what the PMI refers to in it; or, for assembly PMI, the assembly and
    // what it refers to on its instances.
    if (const auto refs = myAssemblyRefs->find(entryOf(label)); refs != myAssemblyRefs->end())
      addInstanceRefs(refs->second, p);
    else
    {
      LabelSequence first, second;
      XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
      for (const LabelSequence* refs : {&first, &second})
        for (const TDF_Label& ref : *refs)
          addRefs(ref, p);
    }

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

  // A referenced (sub-)shape, if it belongs to the PMI's part. The first part referenced owns the
  // PMI; references into other parts are not highlighted.
  void addRefs(const TDF_Label& ref, Pmi& p) const
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
    addRefs(XCAFDoc_ShapeTool::GetShape(ref), myProtos[size_t(p.proto)], p.refs);
  }

  // The faces of a shape, and the edges and vertices it has outside them, as drawn in a part.
  static void addRefs(const TopoDS_Shape& shape, const Proto& proto, Refs& refs)
  {
    const auto add = [&](const ShapeIndex& index, TopAbs_ShapeEnum type, TopAbs_ShapeEnum outside, std::vector<int>& out) {
      // The explorer does not avoid the shape itself, only its sub-shapes.
      if (shape.IsNull() || shape.ShapeType() == outside)
        return;
      for (TopExp_Explorer ex(shape, type, outside); ex.More(); ex.Next())
        if (const int* i = index.Seek(ex.Current()); i && std::find(out.begin(), out.end(), *i) == out.end())
          out.push_back(*i);
    };
    add(proto.faceIndex, TopAbs_FACE, TopAbs_SHAPE, refs.faces);
    add(proto.edgeIndex, TopAbs_EDGE, TopAbs_FACE, refs.edges);
    add(proto.vertexIndex, TopAbs_VERTEX, TopAbs_EDGE, refs.vertices);
  }

  // Assembly PMI: drawn with every instance of the assembly it is defined in, and what it refers to
  // on the instances (paths of component labels from that assembly).
  void addInstanceRefs(const std::vector<STEPCAFControl_Reader::AssemblyShapeReference>& refs, Pmi& p) const
  {
    for (const auto& ref : refs)
    {
      const auto owners = myNodesByDef.find(entryOf(ref.Assembly));
      for (int owner : owners == myNodesByDef.end() ? std::vector<int>() : owners->second)
      {
        if (std::find(p.nodes.begin(), p.nodes.end(), owner) == p.nodes.end())
          p.nodes.push_back(owner);
        int node = owner;
        for (auto it = ref.Path.cbegin(); it != ref.Path.cend() && node >= 0; ++it)
        {
          const auto child = myChildByComponent.find({node, entryOf(*it)});
          node             = child == myChildByComponent.end() ? -1 : child->second;
        }
        if (node < 0 || myNodes[size_t(node)].proto < 0)
          continue;
        Refs refs;
        for (const TDF_Label& shape : ref.Shapes)
          addRefs(XCAFDoc_ShapeTool::GetShape(shape), myProtos[size_t(myNodes[size_t(node)].proto)], refs);
        if (!refs.empty())
          p.nodeRefs.emplace_back(owner, node, std::move(refs));
      }
    }
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

  // JT and QIF PMI come drawn already, in the coordinates of their part (or the model).
  void addFilePmi(const FilePmi& file)
  {
    const int first = int(myPmi.size());
    for (const FilePmiItem& item : file.items)
    {
      Pmi p;
      p.kind      = item.kind;
      p.type      = item.type;
      p.name      = item.name;
      p.value     = item.value;
      p.plusMinus = item.plusMinus;
      p.range     = item.range;
      p.bound     = item.bound;
      p.angular   = item.angular;
      p.datums    = item.datums;
      if (!item.part.IsNull())
        if (const auto it = myProtoByEntry.find(entryOf(item.part)); it != myProtoByEntry.end())
          p.proto = it->second;
      if (p.proto >= 0)
        for (const TopoDS_Shape& shape : item.shapes)
          addRefs(shape, myProtos[size_t(p.proto)], p.refs);
      p.segments  = append(item.segments);
      p.triangles = append(item.triangles);
      myPmi.push_back(std::move(p));
    }
    for (const FilePmiView& v : file.views)
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

  // OCCT gives each datum of a tolerance its compartment (position) and modifiers; datums sharing a
  // position are a common datum.
  static std::vector<std::vector<DatumRef>> datumFrame(const TDF_Label& tolerance)
  {
    std::map<int, std::vector<DatumRef>> byPosition;
    LabelSequence                        labels;
    XCAFDoc_DimTolTool::GetDatumOfTolerLabels(tolerance, labels);
    for (const TDF_Label& l : labels)
    {
      Handle(XCAFDoc_Datum) attr;
      if (!l.FindAttribute(XCAFDoc_Datum::GetID(), attr) || attr->GetObject().IsNull())
        continue;
      const Handle(XCAFDimTolObjects_DatumObject) obj = attr->GetObject();
      DatumRef d{str(obj->GetName())};
      for (const XCAFDimTolObjects_DatumSingleModif m : obj->GetModifiers())
        if (const char* name = datumModifier(m))
          d.modifiers.push_back(name);
      XCAFDimTolObjects_DatumModifWithValue type;
      obj->GetModifierWithValue(type, d.size);
      // the patched reader keeps a projected length apart, never as the modifier with value
      static const char* const kSizeTypes[] = {"", "diameter", "distance", "", "spherical"};
      if (size_t(type) < sizeof kSizeTypes / sizeof *kSizeTypes)
        d.sizeType = kSizeTypes[size_t(type)];
      if (obj->GetProjectedLength() > 0)
        d.projected = obj->GetProjectedLength();
      for (const auto& [modifier, axis] : obj->GetSituationFeatures())
        if (const char* name = datumModifier(modifier))
          d.situations.emplace_back(name, axis);
      // A datum set up from targets (A1, A2) comes once per target: the frame names it once.
      std::vector<DatumRef>& compartment = byPosition[obj->GetPosition()];
      const auto same = [&](const DatumRef& c) { return c.name == d.name; };
      if (std::none_of(compartment.begin(), compartment.end(), same))
        compartment.push_back(std::move(d));
    }
    std::vector<std::vector<DatumRef>> frame;
    for (auto& [position, compartment] : byPosition)
      frame.push_back(std::move(compartment));
    return frame;
  }

  static const char* datumModifier(XCAFDimTolObjects_DatumSingleModif m)
  {
    static const char* const kNames[] = {
      "anyCrossSection", "anyLongitudinalSection", "basic", "contactingFeature",
      "dofU", "dofV", "dofW", "dofX", "dofY", "dofZ",
      "distanceVariable", "freeState", "leastMaterial", "line", "majorDiameter", "maximumMaterial",
      "minorDiameter", "orientation", "pitchDiameter", "plane", "point", "translation"};
    const auto i = size_t(m);
    return i < sizeof kNames / sizeof *kNames ? kNames[i] : nullptr;
  }

  static const char* toleranceModifier(XCAFDimTolObjects_GeomToleranceModif m)
  {
    static const char* const kNames[] = {
      "anyCrossSection", "commonZone",     "eachRadialElement", "freeState",     "leastMaterial",
      "lineElement",     "majorDiameter",  "maximumMaterial",   "minorDiameter", "notConvex",
      "pitchDiameter",   "reciprocity",    "separate",          "statistical",   "tangentPlane",
      "allAround",       "allOver"};
    const auto i = size_t(m);
    return i < sizeof kNames / sizeof *kNames ? kNames[i] : nullptr;
  }

  Options                    myOpts;
  Progress&                  myProgress;
  int                        myPartCount   = 0;
  int                        myPartsMeshed = 0;
  Handle(XCAFDoc_ShapeTool)  myShapes;
  Handle(XCAFDoc_ColorTool)  myColors;
  Handle(XCAFDoc_LayerTool)  myLayers;
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
  std::vector<Product>       myProducts;
  std::map<std::string, int> myProductByEntry;
  const ProductProps*        myProductProps = nullptr;
  const AssemblyRefs*        myAssemblyRefs = nullptr;
  const ProductProps*        myOccurrences  = nullptr;
  const ExactBodies*         myExactBodies  = nullptr;
  // For assembly PMI: the nodes of each definition label entry, and each node's child by its
  // component label entry
  std::map<std::string, std::vector<int>>       myNodesByDef;
  std::map<std::pair<int, std::string>, int>    myChildByComponent;
  const ValidationProps*     myValidation   = nullptr;
};

// Readers: each fills the XCAF document and describes the source.

// A file a STEP assembly references, whether it was opened with it, and where the file says it is
// (a folder relative to the assembly, or a URL; empty when not stated).
struct ExternalRef
{
  std::string name;
  bool        loaded = false;
  std::string location;
};

struct Source
{
  std::string format;
  std::string schema; // STEP only
  std::string unit;   // file length unit name as in STEP ("MILLIMETRE", "INCH", ...); empty = mm
  FilePmi     pmi;    // JT and QIF (STEP PMI is in the XCAF document)
  // STEP only:
  ProductProps    products;
  ValidationProps validation;
  AssemblyRefs    assemblyRefs;
  ProductProps    occurrences; // occurrence identification and quantity, by component label entry
  ExactBodies     exactBodies;
  // Counts the file states for validation; -1 = not stated.
  int annotations = -1, views = -1;
  // Files the assembly references (external references).
  std::vector<ExternalRef> externalFiles;
  // The file read, when it is not the one given (a JT assembly picked from the files opened together).
  std::string mainFile;
};

// Files opened together with the main one: name and bytes (Uint8Array).
using ExtraFiles = std::vector<std::pair<std::string, val>>;

std::string lowercase(std::string s)
{
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return char(std::tolower(c)); });
  return s;
}

// File name without folders, Windows ones included.
std::string baseName(const std::string& path)
{
  const size_t slash = path.find_last_of("/\\");
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

std::string lowerExtension(const std::string& fileName);
// part: a part placed by an assembly, read in its own frame (no Y-up to Z-up turn for OBJ and VRML)
Source      readDoc(std::string&                    bytes,
                    const std::string&              fileName,
                    const ExtraFiles&               extra,
                    const Handle(TDocStd_Document)& doc,
                    Progress&                       progress,
                    bool                            part = false);

// Formats other than STEP that readDoc reads, for parts a STEP assembly keeps in such files.
bool isOtherPartFormat(const std::string& fileName)
{
  static const std::set<std::string> kExts = {".jt", ".igs", ".iges", ".stl", ".brep", ".brp", ".obj", ".wrl", ".vrml"};
  return kExts.count(lowerExtension(fileName)) > 0;
}

// ExtRef RP 5.2.1.2: a document on paper (or other media), not a file.
bool isPhysical(const Interface_Graph& graph, const Handle(StepBasic_DocumentFile)& file)
{
  if (file.IsNull())
    return false;
  for (Interface_EntityIterator it = graph.Sharings(file); it.More(); it.Next())
    if (const auto type = Handle(StepBasic_DocumentRepresentationType)::DownCast(it.Value());
        !type.IsNull() && lowercase(stepText(type->Name())) == "physical")
      return true;
  return false;
}

// StepData_SelectMember::Kind of a string (StepData_Field numbering; OCCT names no constant for it)
constexpr int kStringKind = 6;

// ExtRef RP 5.2.3: the path in a referenced file's 'external document id and location'
// (external_source), unless it is only the name.
std::string fileLocation(const Interface_Graph& graph, const Handle(StepBasic_DocumentFile)& file, const std::string& name)
{
  if (file.IsNull())
    return {};
  for (Interface_EntityIterator it = graph.Sharings(file); it.More(); it.Next())
  {
    const auto aeia = Handle(StepAP214_AppliedExternalIdentificationAssignment)::DownCast(it.Value());
    const auto id   = aeia.IsNull() || aeia->Source().IsNull()
                        ? Handle(StepData_SelectNamed)()
                        : Handle(StepData_SelectNamed)::DownCast(aeia->Source()->SourceId().Value());
    if (!id.IsNull() && id->Kind() == kStringKind && id->String() && *id->String() && baseName(id->String()) != name)
      return id->String();
  }
  return {};
}

// Puts the files a STEP assembly references where OCCT looks for them (relative to the main
// file), from those opened with it, matched by name without folders or case. All STEP ones also go
// next to the main file, for references from referenced files. Removed when done.
// Parts in other formats readDoc reads (JT, IGES, ...) are not for OCCT: insertOtherParts reads
// them after the transfer and puts them into their parts.
class ExternalFiles
{
public:
  static constexpr const char* kDir = "/step/"; // the main file is read as if it were here

  ExternalFiles(STEPCAFControl_Reader& reader, const std::string& mainPath, const ExtraFiles& extra)
  {
    for (const auto& [name, bytes] : extra)
      if (!isOtherPartFormat(name))
        write(kDir + baseName(name), bytes);

    OSD_Path main(mainPath.c_str());
    main.SetName("");
    main.SetExtension("");
    TCollection_AsciiString dir;
    main.SystemName(dir);
    STEPConstruct_ExternRefs refs(reader.ChangeReader().WS());
    refs.LoadExternRefs();
    const Interface_Graph& graph = reader.ChangeReader().WS()->Graph();
    for (int i = 1; i <= refs.NbExternRefs(); ++i)
    {
      // As OCCT: STEP documents, by a path relative to the main file; and parts in other formats.
      // Without a format, a name with an extension of neither (a PDF, a native CAD file) is not a
      // part file either.
      const char* file = refs.FileName(i);
      if (!file || !*file || isPhysical(graph, refs.DocFile(i)))
        continue;
      const std::string name  = baseName(file);
      const std::string ext   = lowerExtension(name);
      const bool        other = isOtherPartFormat(name);
      const auto        fmt   = refs.Format(i);
      if (!other && (!STEPCAFControl_Reader::IsStepExternFormat(fmt)
                     || ((fmt.IsNull() || fmt->IsEmpty()) && !ext.empty() && ext != ".stp" && ext != ".step" && ext != ".p21")))
        continue;
      const auto match = std::find_if(extra.begin(), extra.end(), [&](const auto& e) { return lowercase(baseName(e.first)) == lowercase(name); });
      if (other && !refs.ProdDef(i).IsNull())
        myOthers.push_back({refs.ProdDef(i), name, match != extra.end() ? &match->second : nullptr});
      if (std::any_of(myRefs.begin(), myRefs.end(), [&](const auto& r) { return r.name == name; }))
        continue;
      myRefs.push_back({name, match != extra.end(), fileLocation(graph, refs.DocFile(i), name)});
      if (other)
        continue;
      TCollection_AsciiString path = OSD_Path::AbsolutePath(dir, file);
      if (match != extra.end() && path.Length() > 0 && path.ToCString() != kDir + baseName(match->first))
        write(path.ToCString(), match->second);
    }
  }
  ~ExternalFiles()
  {
    for (const std::string& path : myWritten)
      std::remove(path.c_str());
  }
  ExternalFiles(const ExternalFiles&)            = delete;
  ExternalFiles& operator=(const ExternalFiles&) = delete;

  const std::vector<ExternalRef>& references() const { return myRefs; }

  // Reads the parts in other formats into their (empty) parts of the transferred document: the
  // file's shapes become components of the part, with their names and colours.
  void insertOtherParts(STEPCAFControl_Reader& reader, const Handle(TDocStd_Document)& doc, Progress& progress) const
  {
    const Handle(Transfer_TransientProcess)& tp = reader.ChangeReader().WS()->TransferReader()->TransientProcess();
    const auto& labels = reader.GetShapeLabelMap();
    // By name: a file used by several parts is read once. Closed when done, also when one fails.
    struct Documents : std::map<std::string, Handle(TDocStd_Document)>
    {
      ~Documents()
      {
        for (auto& [name, doc] : *this)
          if (!doc.IsNull())
            XCAFApp_Application::GetApplication()->Close(doc);
      }
    } read;
    for (const OtherPart& part : myOthers)
    {
      const int    index = part.bytes ? tp->MapIndex(part.pd) : 0;
      TopoDS_Shape shape = index > 0 ? TransferBRep::ShapeResult(tp->MapItem(index)) : TopoDS_Shape();
      shape.Location(TopLoc_Location());
      if (shape.IsNull() || !labels.IsBound(shape))
        continue;
      Handle(TDocStd_Document)& from = read[lowercase(part.name)];
      if (from.IsNull())
      {
        XCAFApp_Application::GetApplication()->NewDocument("BinXCAF", from);
        std::string bytes((*part.bytes)["length"].as<size_t>(), '\0');
        val(emscripten::typed_memory_view(bytes.size(), bytes.data())).call<void>("set", *part.bytes);
        // A file that cannot be read fails the whole model, as when opened alone
        readDoc(bytes, part.name, {}, from, progress, true);
      }
      NCollection_Sequence<TDF_Label> roots;
      XCAFDoc_DocumentTool::ShapeTool(from->Main())->GetFreeShapes(roots);
      XCAFDoc_Editor::Extract(roots, labels.Find(shape));
    }
  }

private:
  struct OtherPart
  {
    Handle(StepBasic_ProductDefinition) pd;
    std::string                         name;
    const val*                          bytes; // null: not opened with the assembly
  };

  void write(const std::string& path, const val& bytes)
  {
    for (size_t slash = path.find('/', 1); slash != std::string::npos; slash = path.find('/', slash + 1))
      mkdir(path.substr(0, slash).c_str(), 0777); // folders on the way; existing ones fail harmlessly
    std::string data(bytes["length"].as<size_t>(), '\0');
    val(emscripten::typed_memory_view(data.size(), data.data())).call<void>("set", bytes);
    std::ofstream(path, std::ios::binary).write(data.data(), std::streamsize(data.size()));
    myWritten.push_back(path);
  }

  std::vector<std::string>                  myWritten;
  std::vector<ExternalRef>                  myRefs;
  std::vector<OtherPart>                    myOthers;
};

// OCCT's IGES and mesh readers and TKJT need a real file: MEMFS.
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

// "design_owner" → "Design owner"
std::string roleLabel(const Handle(TCollection_HAsciiString)& role)
{
  std::string t = stepText(role);
  std::replace(t.begin(), t.end(), '_', ' ');
  if (!t.empty())
    t[0] = char(std::toupper(static_cast<unsigned char>(t[0])));
  return t;
}

std::string dateText(const Handle(StepBasic_Date)& date, const Handle(StepBasic_LocalTime)& time)
{
  const auto cal = Handle(StepBasic_CalendarDate)::DownCast(date);
  if (cal.IsNull() || cal->YearComponent() <= 0) // year 0: a placeholder date
    return {};
  char buf[32];
  int  n = std::snprintf(buf, sizeof buf, "%04d-%02d-%02d", cal->YearComponent(), cal->MonthComponent(), cal->DayComponent());
  const int minute = time.IsNull() || !time->HasMinuteComponent() ? 0 : time->MinuteComponent();
  if (!time.IsNull() && (time->HourComponent() || minute)) // midnight: most writers give no time
    std::snprintf(buf + n, sizeof buf - n, " %02d:%02d", time->HourComponent(), minute);
  return buf;
}

std::string personText(const Handle(StepBasic_Person)& p, const Handle(StepBasic_Organization)& o)
{
  std::string person, org;
  if (!p.IsNull())
  {
    const std::string first = p->HasFirstName() ? stepText(p->FirstName()) : std::string();
    const std::string last  = p->HasLastName() ? stepText(p->LastName()) : std::string();
    person                  = first.empty() || last.empty() ? first + last : first + ' ' + last;
    if (person.empty())
      person = stepText(p->Id());
  }
  if (!o.IsNull())
    org = stepText(o->Name());
  return person.empty() || org.empty() ? person + org : person + ", " + org;
}

std::string personText(const Handle(StepBasic_PersonAndOrganization)& po)
{
  return personText(po->ThePerson(), po->TheOrganization());
}

std::string personText(const StepBasic_PersonOrganizationSelect& s)
{
  if (const auto po = s.PersonAndOrganization(); !po.IsNull())
    return personText(po);
  return personText(s.Person(), s.Organization());
}

// XCAF label entry of a product definition's shape; empty if it has none.
std::string pdEntry(STEPCAFControl_Reader& reader, const Handle(StepBasic_ProductDefinition)& pd)
{
  const Handle(Transfer_TransientProcess)& tp     = reader.ChangeReader().WS()->TransferReader()->TransientProcess();
  const Handle(Transfer_Binder)            binder = pd.IsNull() ? nullptr : tp->Find(pd);
  const TopoDS_Shape shape = binder.IsNull() ? TopoDS_Shape() : TransferBRep::ShapeResult(tp, binder);
  const TDF_Label*   label = shape.IsNull() ? nullptr : reader.GetShapeLabelMap().Seek(shape); // transferred shape → label
  if (!label)
    return {};
  TCollection_AsciiString entry;
  TDF_Tool::Entry(*label, entry);
  return entry.ToCString();
}

// The bodies of an XCAF assembly that are not parts, also below sub-assemblies that are not parts either
// (representations of mapped items). skip: the components not to draw if the part is exact: those that
// place a body again where an earlier one does, as a tessellated solid linked to the exact one (Tess RP
// 5.4.5) comes out, and sub-assemblies without exact geometry, which would be left empty.
void partBodies(const TDF_Label& assembly, const std::set<std::string>& parts, LabelSequence& bodies,
                std::vector<std::string>& skip)
{
  LabelSequence components;
  XCAFDoc_ShapeTool::GetComponents(assembly, components, false);
  std::vector<std::pair<std::string, TopLoc_Location>> placed;
  for (const TDF_Label& c : components)
  {
    TDF_Label body;
    if (!XCAFDoc_ShapeTool::GetReferredShape(c, body) || parts.count(entryOf(body)))
      continue;
    const std::pair<std::string, TopLoc_Location> at(entryOf(body), XCAFDoc_ShapeTool::GetLocation(c));
    if (std::any_of(placed.begin(), placed.end(), [&](const auto& p) { return p.first == at.first && p.second.IsEqual(at.second); }))
    {
      skip.push_back(entryOf(c));
      continue;
    }
    placed.push_back(at);
    if (XCAFDoc_ShapeTool::IsAssembly(body))
    {
      partBodies(body, parts, bodies, skip);
      if (!hasSurface(XCAFDoc_ShapeTool::GetShape(body)))
        skip.push_back(entryOf(c));
    }
    else
      bodies.Append(body);
  }
}

// The bodies of parts with exact geometry, by label entry; meshPart leaves out their tessellated faces.
// OCCT reads all of a part's shapes (Alt Shapes RP 5), so an exact and a tessellated one overlap. A
// part with several shapes is an assembly in XCAF: its components are its bodies and its sub-parts.
// A tessellated body that is not an alternative of the exact one cannot be told apart, and goes too.
ExactBodies exactBodies(STEPCAFControl_Reader& reader, const Handle(TDocStd_Document)& doc)
{
  const Handle(Interface_InterfaceModel) model = reader.ChangeReader().WS()->Model();
  std::set<std::string>                  parts, inexact;
  ExactBodies                            out;
  for (int i = 1; i <= model->NbEntities(); ++i)
    if (const auto pd = Handle(StepBasic_ProductDefinition)::DownCast(model->Value(i)); !pd.IsNull())
      if (std::string entry = pdEntry(reader, pd); !entry.empty())
        parts.insert(std::move(entry));
  std::set<std::string> otherFiles; // whose sub-parts are not known here
  using Files = std::decay_t<decltype(reader.ExternFiles())>;
  for (Files::Iterator it(reader.ExternFiles()); it.More(); it.Next())
    if (!it.Value().IsNull() && !it.Value()->GetLabel().IsNull())
      otherFiles.insert(entryOf(it.Value()->GetLabel()));
  for (const std::string& entry : parts)
  {
    TDF_Label part;
    TDF_Tool::Label(doc->GetData(), entry.c_str(), part);
    if (part.IsNull() || otherFiles.count(entry))
      continue;
    LabelSequence            bodies;
    std::vector<std::string> skip;
    if (XCAFDoc_ShapeTool::IsAssembly(part))
      partBodies(part, parts, bodies, skip);
    else
      bodies.Append(part);
    const bool exact = std::any_of(bodies.begin(), bodies.end(), [](const TDF_Label& body) { return hasSurface(XCAFDoc_ShapeTool::GetShape(body)); });
    for (const TDF_Label& body : bodies)
      (exact ? out.bodies : inexact).insert(entryOf(body));
    if (exact)
      out.skip.insert(skip.begin(), skip.end());
  }
  for (const std::string& body : inexact) // a body shared with a part without exact geometry stays
    out.bodies.erase(body);
  return out;
}

// A unit as text: an SI unit's symbol ("m", "kg"), a conversion based unit's name ("INCH"), or
// nothing for a count (a named unit without dimensions).
std::string unitSymbol(const StepBasic_Unit& unit)
{
  static const char* const kPrefixes[] = {"E", "P", "T", "G", "M", "k", "h", "da", "d", "c", "m", "µ", "n", "p", "f", "a"};
  static const char* const kNames[]    = {"m",  "g",  "s",  "A",  "K",  "mol", "cd", "rad", "sr", "Hz", "N",  "Pa", "J", "W",
                                          "C",  "V",  "F",  "Ω",  "S",  "Wb",  "T",  "H",   "°C", "lm", "lx", "Bq", "Gy", "Sv"};
  const Handle(StepBasic_NamedUnit) named = unit.NamedUnit();
  if (const auto conversion = Handle(StepBasic_ConversionBasedUnit)::DownCast(named); !conversion.IsNull())
    return stepText(conversion->Name());
  if (const auto si = Handle(StepBasic_SiUnit)::DownCast(named); !si.IsNull())
    return std::string(si->HasPrefix() ? kPrefixes[si->Prefix()] : "") + kNames[si->Name()];
  return {};
}

// What identifies each component occurrence (PDM UG 4.1.1.2: id, name, which may hold the item find
// number, description, reference designator) and its quantity (4.1.2), by component label entry.
// And, as product data of the assembly, the usages that cannot be placed: promissory ones (4.1.4:
// somewhere below, the structure in between not given) and ones without a placement.
void readUsages(STEPCAFControl_Reader& reader, const Handle(TDocStd_Document)& doc, ProductProps& props, ProductProps& occurrences)
{
  const Handle(XSControl_WorkSession)    ws    = reader.ChangeReader().WS();
  const Handle(Interface_InterfaceModel) model = ws->Model();
  const STEPConstruct_Tool               tool(ws);
  const Handle(XCAFDoc_ShapeTool)        shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  for (int i = 1; i <= model->NbEntities(); ++i)
  {
    const auto nauo       = Handle(StepRepr_NextAssemblyUsageOccurrence)::DownCast(model->Value(i));
    const auto promissory = Handle(StepRepr_PromissoryUsageOccurrence)::DownCast(model->Value(i));
    const Handle(StepRepr_AssemblyComponentUsage) usage = nauo.IsNull() ? Handle(StepRepr_AssemblyComponentUsage)(promissory) : nauo;
    // Usages between parts in other files are references for navigating there (ExtRef RP 7.4.1)
    const Handle(StepBasic_ProductDefinition) parent = usage.IsNull() ? nullptr : usage->RelatingProductDefinition();
    const Handle(StepBasic_ProductDefinition) child  = usage.IsNull() ? nullptr : usage->RelatedProductDefinition();
    if (parent.IsNull() || child.IsNull() || parent->IsKind(STANDARD_TYPE(StepBasic_ProductDefinitionReferenceWithLocalRepresentation)))
      continue;
    std::string quantity;
    if (const auto quantified = Handle(StepRepr_QuantifiedNextAssemblyUsageOccurrence)::DownCast(usage))
      if (const auto measure = Handle(StepBasic_MeasureWithUnit)::DownCast(quantified->Quantity()); !measure.IsNull())
      {
        std::ostringstream q;
        q << measure->ValueComponent();
        if (const std::string unit = unitSymbol(measure->UnitComponent()); !unit.empty())
          q << ' ' << unit;
        quantity = q.str();
      }
    if (!nauo.IsNull())
      if (const TDF_Label instance = STEPCAFControl_Reader::FindInstance(nauo, shapes, tool, reader.GetShapeLabelMap()); !instance.IsNull())
      {
        Props& rows = occurrences[entryOf(instance)];
        for (const auto& [label, value] : {std::pair<const char*, Handle(TCollection_HAsciiString)>{"Id", nauo->Id()},
                                           {"Name", nauo->Name()},
                                           {"Description", nauo->HasDescription() ? nauo->Description() : nullptr},
                                           {"Reference designator", nauo->HasReferenceDesignator() ? nauo->ReferenceDesignator() : nullptr}})
          if (const std::string text = stepText(value); !text.empty())
            rows.emplace_back(label, text);
        if (!quantity.empty())
          rows.emplace_back("Quantity", quantity);
        continue;
      }
    const auto  product = child->Formation().IsNull() ? nullptr : child->Formation()->OfProduct();
    std::string name    = product.IsNull() ? stepText(child->Id()) : stepText(product->Name());
    if (name.empty() && !product.IsNull())
      name = stepText(product->Id());
    const std::string entry = pdEntry(reader, parent);
    if (entry.empty())
      continue;
    // A usage OCCT did not link to an instance may still be placed (e.g. by another usage of the
    // same part): say "not placed" only when the assembly has no component of that part at all.
    TDF_Label assembly;
    TDF_Tool::Label(doc->GetData(), entry.c_str(), assembly);
    LabelSequence components;
    XCAFDoc_ShapeTool::GetComponents(assembly, components, false);
    const std::string part   = pdEntry(reader, child);
    const bool        placed = std::any_of(components.begin(), components.end(), [&](const TDF_Label& c) {
      TDF_Label referred;
      return XCAFDoc_ShapeTool::GetReferredShape(c, referred) && entryOf(referred) == part;
    });
    if (!nauo.IsNull() && placed)
      continue;
    props[entry].emplace_back(nauo.IsNull() ? "Somewhere below" : "Not placed", quantity.empty() ? name : name + " × " + quantity);
  }
}

// Configuration management data of each product (ISO 10303-203 part, version and their approvals,
// security classification, people and dates; AP214/AP242 assign the same through applied_*
// subtypes), keyed by the product definition's XCAF label.
ProductProps readProductProps(STEPCAFControl_Reader& reader)
{
  const Handle(XSControl_WorkSession)    ws    = reader.ChangeReader().WS();
  const Interface_Graph&                 graph = ws->Graph();
  const Handle(Interface_InterfaceModel) model = ws->Model();

  ProductProps out;
  for (int i = 1; i <= model->NbEntities(); ++i)
  {
    const auto        pd    = Handle(StepBasic_ProductDefinition)::DownCast(model->Value(i));
    const std::string entry = pdEntry(reader, pd);
    if (entry.empty())
      continue;

    Props props;
    auto  add = [&props](const std::string& key, const std::string& value) {
      if (!key.empty() && !value.empty() && std::find(props.begin(), props.end(), std::pair(key, value)) == props.end())
        props.emplace_back(key, value);
    };
    const Handle(StepBasic_ProductDefinitionFormation) version = pd->Formation();
    const Handle(StepBasic_Product) product = version.IsNull() ? nullptr : version->OfProduct();
    if (!product.IsNull())
      add("Part number", stepText(product->Id()));
    if (!version.IsNull())
      add("Revision", stepText(version->Id()));
    if (!product.IsNull())
      add("Description", stepText(product->Description()));

    for (const Handle(Standard_Transient)& item : {Handle(Standard_Transient)(product), Handle(Standard_Transient)(version), Handle(Standard_Transient)(pd)})
    {
      if (item.IsNull())
        continue;
      for (Interface_EntityIterator it = graph.Sharings(item); it.More(); it.Next())
      {
        const Handle(Standard_Transient)& e = it.Value();
        if (const auto a = Handle(StepBasic_ApprovalAssignment)::DownCast(e); !a.IsNull())
        {
          const Handle(StepBasic_Approval) approval = a->AssignedApproval();
          if (approval.IsNull())
            continue;
          if (!approval->Status().IsNull())
            add("Approval", stepText(approval->Status()->Name()));
          // Who approved, and when, refer to the approval.
          for (Interface_EntityIterator by = graph.Sharings(approval); by.More(); by.Next())
          {
            if (const auto po = Handle(StepBasic_ApprovalPersonOrganization)::DownCast(by.Value()); !po.IsNull())
            {
              const std::string role = po->Role().IsNull() ? std::string() : roleLabel(po->Role()->Role());
              add(role.empty() ? "Approver" : role, personText(po->PersonOrganization()));
            }
            else if (const auto dt = Handle(StepBasic_ApprovalDateTime)::DownCast(by.Value()); !dt.IsNull())
            {
              const StepBasic_DateTimeSelect& when = dt->DateTime();
              add("Approval date",
                  !when.DateAndTime().IsNull() ? dateText(when.DateAndTime()->DateComponent(), when.DateAndTime()->TimeComponent())
                                               : dateText(when.Date(), nullptr));
            }
          }
        }
        else if (const auto s = Handle(StepBasic_SecurityClassificationAssignment)::DownCast(e); !s.IsNull())
        {
          const auto c = s->AssignedSecurityClassification();
          if (!c.IsNull() && !c->SecurityLevel().IsNull())
            add("Security", stepText(c->SecurityLevel()->Name()));
        }
        else if (const auto p = Handle(StepBasic_PersonAndOrganizationAssignment)::DownCast(e); !p.IsNull())
        {
          if (!p->AssignedPersonAndOrganization().IsNull() && !p->Role().IsNull())
            add(roleLabel(p->Role()->Name()), personText(p->AssignedPersonAndOrganization()));
        }
        else if (const auto o = Handle(StepBasic_OrganizationAssignment)::DownCast(e); !o.IsNull())
        {
          if (!o->AssignedOrganization().IsNull() && !o->Role().IsNull())
            add(roleLabel(o->Role()->Name()), stepText(o->AssignedOrganization()->Name()));
        }
        else if (const auto d = Handle(StepBasic_DateAndTimeAssignment)::DownCast(e); !d.IsNull())
        {
          const auto dt = d->AssignedDateAndTime();
          if (!dt.IsNull() && !d->Role().IsNull())
            add(roleLabel(d->Role()->Name()), dateText(dt->DateComponent(), dt->TimeComponent()));
        }
        else if (const auto d = Handle(StepBasic_DateAssignment)::DownCast(e); !d.IsNull())
        {
          if (!d->Role().IsNull())
            add(roleLabel(d->Role()->Name()), dateText(d->AssignedDate(), nullptr));
        }
      }
    }

    if (!props.empty())
      out[entry] = std::move(props);
  }

  // Materials (AP203/AP214 material_designation) of a part or its shape. OCCT's own material
  // reader takes any descriptive item on a part's properties, such as a 'CAD_SOURCE', for one.
  for (int i = 1; i <= model->NbEntities(); ++i)
  {
    const auto m = Handle(StepRepr_MaterialDesignation)::DownCast(model->Value(i));
    if (m.IsNull())
      continue;
    Handle(StepBasic_ProductDefinition) pd = m->OfDefinition().ProductDefinition();
    if (const auto pds = m->OfDefinition().ProductDefinitionShape(); pd.IsNull() && !pds.IsNull())
      pd = pds->Definition().ProductDefinition();
    const std::string entry = pdEntry(reader, pd);
    const std::pair<std::string, std::string> material("Material", stepText(m->Name()));
    Props& props = out[entry];
    if (!entry.empty() && !material.second.empty() && std::find(props.begin(), props.end(), material) == props.end())
      props.push_back(material);
    if (props.empty())
      out.erase(entry);
  }
  return out;
}

// Length unit in mm of a STEP unit; 0 if it is not a length unit.
double unitLength(const Handle(StepBasic_NamedUnit)& unit)
{
  STEPConstruct_UnitContext ctx;
  return ctx.ComputeFactors(unit) == 0 && ctx.LengthDone() ? ctx.LengthFactor() : 0.;
}

// Length unit in mm of a representation context (as OCCT's GetPropPnt reads it); 1 if it has none.
double contextLength(const Handle(StepRepr_RepresentationContext)& context)
{
  Handle(StepRepr_GlobalUnitAssignedContext) units;
  if (const auto c = Handle(StepGeom_GeometricRepresentationContextAndGlobalUnitAssignedContext)::DownCast(context); !c.IsNull())
    units = c->GlobalUnitAssignedContext();
  else if (const auto c = Handle(StepGeom_GeomRepContextAndGlobUnitAssCtxAndGlobUncertaintyAssCtx)::DownCast(context); !c.IsNull())
    units = c->GlobalUnitAssignedContext();
  STEPConstruct_UnitContext ctx;
  return !units.IsNull() && ctx.ComputeFactors(units) == 0 ? ctx.LengthFactor() : 1.;
}

// Factor from a measure's unit to mm^dim (a measure without a unit is in the representation's);
// 0 if unknown. OCCT's own validation property reader does not convert derived units.
double measureFactor(const StepBasic_Unit& unit, int dim, double contextLength)
{
  if (const auto derived = unit.DerivedUnit(); !derived.IsNull())
  {
    double f = 1;
    for (int i = 1; i <= derived->NbElements(); ++i)
    {
      const auto   e = derived->ElementsValue(i);
      const double l = e.IsNull() ? 0. : unitLength(e->Unit());
      if (l <= 0)
        return 0;
      f *= std::pow(l, e->Exponent());
    }
    return f;
  }
  if (const auto named = unit.NamedUnit(); !named.IsNull())
  {
    // OCCT reads AREA_UNIT((DERIVED_UNIT_ELEMENT(...))) and VOLUME_UNIT as plain named units and
    // drops their elements: assume they are built on the representation's length unit.
    if (named->DynamicType() == STANDARD_TYPE(StepBasic_AreaUnit) || named->DynamicType() == STANDARD_TYPE(StepBasic_VolumeUnit))
      return std::pow(contextLength, dim);
    STEPConstruct_UnitContext ctx;
    if (ctx.ComputeFactors(named) != 0)
      return 0;
    if (dim == 2 && ctx.AreaDone())
      return ctx.AreaFactor();
    if (dim == 3 && ctx.VolumeDone())
      return ctx.VolumeFactor();
    return ctx.LengthDone() ? std::pow(ctx.LengthFactor(), dim) : 0.;
  }
  return std::pow(contextLength, dim);
}

// Geometric validation properties (ISO 10303-203 Amd 1 property_definition_representation) of
// product definitions: 'volume measure', 'surface area measure' (AP242: 'wetted area measure') and
// 'centre point', in mm. Only
// those on the product definition (or its shape) itself: properties of shape aspects, such as
// a part's construction surfaces, describe something else.
ValidationProps readValidationProps(STEPCAFControl_Reader& reader)
{
  const Handle(XSControl_WorkSession)    ws    = reader.ChangeReader().WS();
  const Interface_Graph&                 graph = ws->Graph();
  const Handle(Interface_InterfaceModel) model = ws->Model();
  STEPConstruct_ValidationProps          props(ws);

  ValidationProps out;
  for (int i = 1; i <= model->NbEntities(); ++i)
  {
    const auto prop = Handle(StepRepr_PropertyDefinition)::DownCast(model->Value(i));
    if (prop.IsNull() || stepText(prop->Name()) != "geometric validation property")
      continue;
    Handle(StepBasic_ProductDefinition) pd = prop->Definition().ProductDefinition();
    if (const auto pds = prop->Definition().ProductDefinitionShape(); pd.IsNull() && !pds.IsNull())
      pd = pds->Definition().ProductDefinition();
    const std::string entry = pdEntry(reader, pd);
    if (entry.empty())
      continue;

    FileValidation& v = out[entry];
    for (Interface_EntityIterator it = graph.Sharings(prop); it.More(); it.Next())
    {
      const auto pdr = Handle(StepRepr_PropertyDefinitionRepresentation)::DownCast(it.Value());
      const auto rep = pdr.IsNull() ? nullptr : pdr->UsedRepresentation();
      if (rep.IsNull() || rep->Items().IsNull())
        continue;
      gp_Pnt centre;
      for (const auto& item : *rep->Items())
      {
        const std::string name = item.IsNull() ? std::string() : stepText(item->Name());
        if (const auto m = Handle(StepRepr_MeasureRepresentationItem)::DownCast(item); !m.IsNull() && !m->Measure().IsNull())
        {
          // A surface area is of every face; a wetted area (AP242) of the solids' boundary only.
          const int dim = name == "volume measure" ? 3 : name == "surface area measure" || name == "wetted area measure" ? 2 : 0;
          if (!dim)
            continue;
          const double f = measureFactor(m->Measure()->UnitComponent(), dim, contextLength(rep->ContextOfItems()));
          if (f > 0)
            (dim == 3 ? v.volume : v.area) = {m->Measure()->ValueComponent() * f};
          if (dim == 2)
            v.wetted = name == "wetted area measure";
        }
        else if (name == "centre point" && props.GetPropPnt(item, rep->ContextOfItems(), centre))
          v.centroid = {centre.X(), centre.Y(), centre.Z()};
      }
    }
  }
  return out;
}

// Counts that validation properties state for the whole file: PMI annotations and saved views
// (presentation PMI).
void readValidationCounts(const Handle(Interface_InterfaceModel)& model, Source& src)
{
  for (int i = 1; i <= model->NbEntities(); ++i)
  {
    const Handle(Standard_Transient)& e = model->Value(i);
    if (const auto v = Handle(StepRepr_ValueRepresentationItem)::DownCast(e); !v.IsNull() && !v->ValueComponentMember().IsNull())
    {
      const std::string name = stepText(v->Name());
      if (name == "number of annotations")
        src.annotations = int(v->ValueComponentMember()->Real());
      else if (name == "number of views")
        src.views = int(v->ValueComponentMember()->Real());
    }
  }
}

// Frees bytes once parsed: the file is not needed for the transfer. extra: files opened with it,
// for the ones it references.
Source readStepDoc(std::string&                    bytes,
                   const std::string&              fileName,
                   const ExtraFiles&               extra,
                   const Handle(TDocStd_Document)& doc,
                   Progress&                       progress)
{
  STEPCAFControl_Reader reader;
  // A tessellated face linked to an exact one would replace its mesh; see also exactBodies. Static, as
  // OCCT reads the files of external references with readers of its own.
  Interface_Static::SetIVal("read.step.tessellated", DESTEP_Parameters::RWMode_Tessellated_OnNoBRep);
  reader.SetNameMode(true);
  reader.SetColorMode(true);
  reader.SetLayerMode(true);
  reader.SetGDTMode(true);  // PMI: dimensions, tolerances, datums with their presentations
  reader.SetViewMode(true); // saved views
  reader.SetPropsMode(false); // validation properties are read by readValidationProps
  reader.SetMetaMode(true);   // user-defined attributes
  reader.SetMatMode(false);   // materials are read by readProductProps
  reader.SetSHUOMode(true);   // colours and visibility of one occurrence of a nested component

  MemBuf       buf(const_cast<char*>(bytes.data()), bytes.size(), progress);
  std::istream stream(&buf);
  const std::string mainPath = ExternalFiles::kDir + baseName(fileName);
  if (reader.ReadStream(mainPath.c_str(), stream) != IFSelect_RetDone)
    throw std::runtime_error("Not a readable STEP file");
  std::string().swap(bytes);
  const ExternalFiles external(reader, mainPath, extra);

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
  src.externalFiles = external.references();
  if (!reader.Transfer(doc))
  {
    std::vector<std::string> missing;
    for (const ExternalRef& ref : src.externalFiles)
      if (!ref.loaded)
        missing.push_back(ref.name);
    throw std::runtime_error(missing.empty() ? "STEP transfer failed"
                                             : "This assembly is in other files too. Open them together with it:\n" + nameLines(missing));
  }
  external.insertOtherParts(reader, doc, progress);
  progress.mark("transferred");
  src.exactBodies = exactBodies(reader, doc);
  src.products   = readProductProps(reader);
  readUsages(reader, doc, src.products, src.occurrences);
  src.validation = readValidationProps(reader);
  using GDTAssemblyRefs = std::decay_t<decltype(reader.GetGDTAssemblyReferences())>;
  for (GDTAssemblyRefs::Iterator it(reader.GetGDTAssemblyReferences()); it.More(); it.Next())
    src.assemblyRefs[entryOf(it.Key())] = {it.Value().begin(), it.Value().end()};
  readValidationCounts(reader.ChangeReader().Model(), src);
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
                   Progress&                      progress,
                   bool                           part)
{
  progress("read", -1);
  reader.SetDocument(doc);
  reader.SetSystemLengthUnit(0.001);
  reader.SetSystemCoordinateSystem(RWMesh_CoordinateSystem_Zup);
  if (part) // the assembly's placement says how it stands
    reader.SetFileCoordinateSystem(RWMesh_CoordinateSystem_Zup);
  TempFile file(ext, bytes);
  if (!reader.Perform(file.path(), Message_ProgressRange()))
    throw std::runtime_error("Not a readable " + src.format + " file");
  return src;
}

Source readObjDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress, bool part)
{
  RWObj_CafReader reader; // OBJ has no units; OCCT assumes Y-up
  return readMeshDoc(reader, {"OBJ", {}, {}}, ".obj", bytes, doc, progress, part);
}

Source readVrmlDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress, bool part)
{
  // VRML is metres by spec, but CAD exporters rarely honour it; coordinates are taken as mm.
  VrmlAPI_CafReader reader;
  reader.SetFileLengthUnit(1.0); // VrmlData multiplies coordinates by this
  return readMeshDoc(reader, {"VRML", {}, {}}, ".wrl", bytes, doc, progress, part);
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

Source readQifDoc(const std::string& bytes, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  progress("read", -1);
  Source src{"QIF", {}, {}, {}};
  src.unit = readQif(bytes, doc, src.pmi);
  return src;
}

// Which of the JT files opened together to read: the one that names others of them and that none of
// them names, else the first (see mainFileIndex in web/src/core/mainFile.ts).
size_t jtAssemblyIndex(const JtFiles& files)
{
  std::vector<size_t> assemblies;
  std::vector<bool>   named(files.size());
  for (size_t i = 0; i < files.size(); ++i)
  {
    const TempFile file(".jt", files[i].second);
    bool           names = false;
    for (const std::string& ref : jtReferences(file.path()))
      for (size_t j = 0; j < files.size(); ++j)
        if (j != i && lowercase(baseName(files[j].first)) == lowercase(ref))
          names = named[j] = true;
    if (names)
      assemblies.push_back(i);
  }
  const auto top = std::find_if(assemblies.begin(), assemblies.end(), [&](size_t i) { return !named[i]; });
  return top != assemblies.end() ? *top : assemblies.empty() ? 0 : assemblies[0];
}

Source readJtDoc(std::string& bytes, const std::string& fileName, const ExtraFiles& extra, const Handle(TDocStd_Document)& doc, Progress& progress)
{
  progress("read", -1);
  JtFiles files;
  files.emplace_back(fileName, std::move(bytes));
  for (const auto& [name, data] : extra)
    if (lowerExtension(name) == ".jt")
    {
      std::string copy(data["length"].as<size_t>(), '\0');
      val(emscripten::typed_memory_view(copy.size(), copy.data())).call<void>("set", data);
      files.emplace_back(name, std::move(copy));
    }
  if (files.size() > 1)
    std::swap(files[0], files[jtAssemblyIndex(files)]);
  Source src{"JT", {}, {}, {}};
  std::vector<JtReference> references;
  if (files[0].first != fileName)
    src.mainFile = gMainFile = files[0].first;
  {
    const TempFile file(".jt", files[0].second);
    std::string().swap(files[0].second);
    src.unit = readJt(file.path(), doc, src.pmi, files, references);
  }
  for (const JtReference& ref : references)
    src.externalFiles.push_back({ref.name, ref.loaded, {}});
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

Source readDoc(std::string&                    bytes,
               const std::string&              fileName,
               const ExtraFiles&               extra,
               const Handle(TDocStd_Document)& doc,
               Progress&                       progress,
               bool                            part)
{
  const std::string ext  = lowerExtension(fileName);
  const std::string name = fileName.substr(0, fileName.size() - ext.size());
  if (ext == ".stp" || ext == ".step")
    return readStepDoc(bytes, fileName, extra, doc, progress);
  if (ext == ".igs" || ext == ".iges")
    return readIgesDoc(bytes, doc, progress);
  if (ext == ".obj")
    return readObjDoc(bytes, doc, progress, part);
  if (ext == ".wrl" || ext == ".vrml")
    return readVrmlDoc(bytes, doc, progress, part);
  if (ext == ".stl")
    return readStlDoc(bytes, name, doc, progress);
  if (ext == ".brep" || ext == ".brp")
    return readBrepDoc(bytes, name, doc, progress);
  if (ext == ".jt")
    return readJtDoc(bytes, fileName, extra, doc, progress);
  if (ext == ".qif")
    return readQifDoc(bytes, doc, progress);
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
  auto pairs = [&o](const Props& props) {
    o << '[';
    for (size_t k = 0; k < props.size(); ++k)
      o << (k ? "," : "") << "[\"" << jsonEscape(props[k].first) << "\",\"" << jsonEscape(props[k].second) << "\"]";
    o << ']';
  };
  o << "],\"nodes\":[";
  for (size_t i = 0; i < b.nodes().size(); ++i)
  {
    const Node& n = b.nodes()[i];
    o << (i ? "," : "") << "{\"name\":\"" << jsonEscape(n.name) << "\",\"parent\":" << n.parent
      << ",\"proto\":" << n.proto << ",\"color\":" << n.color;
    if (n.product >= 0)
      o << ",\"product\":" << n.product;
    if (n.hidden)
      o << ",\"hidden\":true";
    if (!n.occurrence.empty())
    {
      o << ",\"occurrence\":";
      pairs(n.occurrence);
    }
    if (!n.attributes.empty())
    {
      o << ",\"attributes\":";
      pairs(n.attributes);
    }
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
    o << ',';
    writeRange(o, "vertices", p.vertices);
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
    for (const auto& [key, nodeKey, list] : kRefLists)
    {
      o << ",\"" << key << "\":[";
      for (size_t k = 0; k < (p.refs.*list).size(); ++k)
        o << (k ? "," : "") << (p.refs.*list)[k];
      o << ']';
    }
    if (!p.nodes.empty())
    {
      o << ",\"nodes\":[";
      for (size_t k = 0; k < p.nodes.size(); ++k)
        o << (k ? "," : "") << p.nodes[k];
      o << ']';
      for (const auto& [key, nodeKey, list] : kRefLists)
      {
        o << ",\"" << nodeKey << "\":[";
        bool first = true;
        for (const auto& [owner, node, refs] : p.nodeRefs)
        {
          if ((refs.*list).empty())
            continue;
          o << (first ? "" : ",") << '[' << owner << ',' << node;
          for (int i : refs.*list)
            o << ',' << i;
          o << ']';
          first = false;
        }
        o << ']';
      }
    }
    numbers("value", p.value);
    numbers("plusMinus", p.plusMinus);
    numbers("range", p.range);
    numbers("perUnit", p.perUnit);
    if (!p.unitArea.empty())
      o << ",\"unitArea\":\"" << p.unitArea << '"';
    if (!p.zone.empty())
      o << ",\"zone\":\"" << p.zone << '"';
    if (!p.modifiers.empty())
    {
      o << ",\"modifiers\":[";
      for (size_t k = 0; k < p.modifiers.size(); ++k)
        o << (k ? "," : "") << '"' << p.modifiers[k] << '"';
      o << ']';
    }
    numbers("projected", p.projected);
    numbers("runout", p.runout);
    numbers("maxValue", p.maxValue);
    numbers("unequal", p.unequal);
    if (!p.bound.empty())
      o << ",\"bound\":\"" << p.bound << '"';
    if (p.angular)
      o << ",\"angular\":true";
    if (p.datumAxes)
    {
      const gp_XYZ origin = p.datumAxes->Location().XYZ();
      o << ",\"datumAxes\":{\"origin\":[" << origin.X() << ',' << origin.Y() << ',' << origin.Z() << ']';
      xyz("x", p.datumAxes->XDirection().XYZ());
      xyz("z", p.datumAxes->Direction().XYZ());
      o << '}';
    }
    if (!p.datums.empty())
    {
      o << ",\"datums\":[";
      for (size_t k = 0; k < p.datums.size(); ++k)
      {
        o << (k ? ",[" : "[");
        for (size_t j = 0; j < p.datums[k].size(); ++j)
        {
          const DatumRef& d = p.datums[k][j];
          o << (j ? "," : "") << "{\"name\":\"" << jsonEscape(d.name) << '"';
          if (!d.modifiers.empty())
          {
            o << ",\"modifiers\":[";
            for (size_t m = 0; m < d.modifiers.size(); ++m)
              o << (m ? "," : "") << '"' << jsonEscape(d.modifiers[m]) << '"';
            o << ']';
          }
          if (!d.sizeType.empty())
            o << ",\"sizeType\":\"" << d.sizeType << "\",\"size\":" << d.size;
          if (d.projected)
            o << ",\"projected\":" << *d.projected;
          if (!d.situations.empty())
          {
            o << ",\"situations\":[";
            for (size_t f = 0; f < d.situations.size(); ++f)
            {
              const auto& [type, axis] = d.situations[f];
              o << (f ? "," : "") << "{\"type\":\"" << type << '"';
              xyz("origin", axis.Location().XYZ());
              if (type != "point")
                xyz("direction", axis.Direction().XYZ());
              o << '}';
            }
            o << ']';
          }
          o << '}';
        }
        o << ']';
      }
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
  o << "],\"products\":[";
  for (size_t i = 0; i < b.products().size(); ++i)
  {
    const Product& p = b.products()[i];
    o << (i ? "," : "") << "{\"props\":";
    pairs(p.props);
    o << ",\"attributes\":";
    pairs(p.attributes);
    numbers("volume", p.volume);
    numbers("area", p.area);
    numbers("centroid", p.centroid);
    o << '}';
  }
  o << "],\"counts\":{";
  const char* sep = "";
  for (const auto& [key, n] : {std::pair("annotations", src.annotations), std::pair("views", src.views)})
    if (n >= 0)
    {
      o << sep << '"' << key << "\":" << n;
      sep = ",";
    }
  o << '}';
  if (!src.mainFile.empty())
    o << ",\"mainFile\":\"" << jsonEscape(src.mainFile) << '"';
  if (!src.externalFiles.empty())
  {
    o << ",\"externalFiles\":[";
    for (size_t i = 0; i < src.externalFiles.size(); ++i)
    {
      const ExternalRef& ref = src.externalFiles[i];
      o << (i ? "," : "") << "{\"name\":\"" << jsonEscape(ref.name) << "\",\"loaded\":" << (ref.loaded ? "true" : "false");
      if (!ref.location.empty())
        o << ",\"location\":\"" << jsonEscape(ref.location) << '"';
      o << '}';
    }
    o << ']';
  }
  o << '}';
  return o.str();
}

// ---------------------------------------------------------------------------
// Entry point

// jsBytes: Uint8Array. Copied into the heap once, not via std::string (embind keeps two copies for the call).
val readModel(val jsBytes, const std::string& fileName, val jsOptions, val onProgress)
{
  Options    opts;
  ExtraFiles extra;
  if (!jsOptions.isUndefined() && !jsOptions.isNull())
  {
    // [{name, bytes}]: files opened together with this one, for the files it references.
    if (const val files = jsOptions["files"]; files.isArray())
      for (int i = 0, n = files["length"].as<int>(); i < n; ++i)
        extra.emplace_back(files[i]["name"].as<std::string>(), files[i]["bytes"]);
    if (jsOptions["linearDeflection"].isNumber())
      opts.linearDeflection = jsOptions["linearDeflection"].as<double>();
    if (jsOptions["angularDeflection"].isNumber())
      opts.angularDeflection = jsOptions["angularDeflection"].as<double>();
    if (jsOptions["maxDeflection"].isNumber())
      opts.maxDeflection = jsOptions["maxDeflection"].as<double>();
  }

  // Silence OCCT's default stdout messenger; errors are returned to JS.
  static const bool quiet =
    (Message::DefaultMessenger()->RemovePrinters(STANDARD_TYPE(Message_Printer)), true);
  (void)quiet;

  gGeometry.clear();
  gGeometry.shrink_to_fit();
  gMainFile.clear();

  val result = val::object();
  try
  {
    Progress progress(onProgress);

    Handle(TDocStd_Document) doc;
    XCAFApp_Application::GetApplication()->NewDocument("BinXCAF", doc);

    std::string bytes(jsBytes["length"].as<size_t>(), '\0');
    val(emscripten::typed_memory_view(bytes.size(), bytes.data())).call<void>("set", jsBytes);
    progress.mark("start");
    const Source src = readDoc(bytes, fileName, extra, doc, progress);
    std::string().swap(bytes); // the other readers are done with it too

    Builder builder(doc, opts, progress);
    builder.build(src.pmi, src.products, src.validation, src.assemblyRefs, src.occurrences, src.exactBodies);
    progress.mark("built");

    result.set("json", toJson(src, builder));
    progress.mark("json");
    result.set("geometry", val(emscripten::typed_memory_view(gGeometry.size(), gGeometry.data())));

    XCAFApp_Application::GetApplication()->Close(doc);
    progress.mark("closed");
    result.set("memory", progress.memory());
  }
  catch (const Standard_Failure& e)
  {
    result.set("error", std::string("OCCT: ") + e.what());
  }
  catch (const std::exception& e)
  {
    result.set("error", std::string(e.what()));
  }
  if (result.hasOwnProperty("error") && !gMainFile.empty())
    result.set("mainFile", gMainFile);
  return result;
}

} // namespace

EMSCRIPTEN_BINDINGS(occt_viewer)
{
  emscripten::function("readModel", &readModel);
}
