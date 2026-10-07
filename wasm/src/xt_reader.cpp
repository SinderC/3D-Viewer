// Parasolid XT data, as specified by the Parasolid XT Format Reference (Siemens, July 2022).
//
// The node stream is read generically: every node type's field layout is the base schema
// SCH_13006 (xt_schema13006.inc) edited by the schema differences the data carries (§2.1.2). The
// edges are then built from the topology (edge → fins → vertices, §5.3) and the edge curves.

#include "xt_reader.h"

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Precision.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <gp_Ax2.hxx>

#include <algorithm>
#include <cstring>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>

namespace
{

// Node types (§6.1).
enum : int
{
  kTerminator    = 1,
  kEdge          = 16,
  kHalfedge      = 17,
  kVertex        = 18,
  kPoint         = 29,
  kLine          = 30,
  kCircle        = 31,
  kEllipse       = 32,
  kIntersection  = 38,
  kChart         = 40,
  kLimit         = 41,
  kBsplineVerts  = 45,
  kKnotMult      = 127,
  kKnotSet       = 128,
  kTrimmedCurve  = 133,
  kBCurve        = 134,
  kNurbsCurve    = 136,
  kLastBaseType  = 184, // SCH_13006 has no node types above this, and no PART_XMT_BLOCK (176)
  kPartXmtBlock  = 176,
};

struct Field
{
  std::string name;
  char        type;  // §2.1.4
  int         count; // 0 scalar, 1 variable length, n > 1 fixed array
  bool        transmitted = true;
};
using Layout = std::vector<Field>;

struct BaseField
{
  int         type;
  const char* name;
  char        code;
  int         count;
};

const BaseField kBase13006[] = {
#include "xt_schema13006.inc"
};

const std::map<int, Layout>& baseSchema()
{
  static const std::map<int, Layout> schema = [] {
    std::map<int, Layout> s;
    for (const BaseField& f : kBase13006)
      s[f.type].push_back({f.name, f.code, f.count});
    return s;
  }();
  return schema;
}

bool inBaseSchema(int type) { return type <= kLastBaseType && type != kPartXmtBlock; }

// Doubles one element of a field occupies once read (integers, characters and pointers included).
int width(char type)
{
  switch (type)
  {
    case 'i': return 2;
    case 'v':
    case 'h': return 3; // hvec: only the position is transmitted
    case 'b': return 6;
    default: return 1;
  }
}

// Neutral binary: big-endian, IEEE doubles (§3.3.3).
class Stream
{
public:
  Stream(const uint8_t* data, size_t size) : myData(data), mySize(size) {}

  uint8_t byte()
  {
    need(1);
    return myData[myPos++];
  }
  int16_t i16()
  {
    need(2);
    const int16_t v = int16_t(myData[myPos] << 8 | myData[myPos + 1]);
    myPos += 2;
    return v;
  }
  int32_t i32()
  {
    need(4);
    uint32_t v = 0;
    for (int i = 0; i < 4; ++i)
      v = v << 8 | myData[myPos++];
    return int32_t(v);
  }
  double f64()
  {
    need(8);
    uint64_t v = 0;
    for (int i = 0; i < 8; ++i)
      v = v << 8 | myData[myPos++];
    double d;
    std::memcpy(&d, &v, sizeof d);
    return d;
  }
  std::string chars(size_t n)
  {
    need(n);
    std::string s(reinterpret_cast<const char*>(myData + myPos), n);
    myPos += n;
    return s;
  }
  std::string shortString() { return chars(byte()); }
  // Pointer indices and other positive integers: one short below 32767, else two (§3.3.3).
  int index()
  {
    int r = i16(), q = 0;
    if (r < 0)
    {
      q = i16();
      r = -r;
    }
    return q * 32767 + r - 1;
  }

private:
  void need(size_t n) const
  {
    if (mySize - myPos < n)
      throw std::runtime_error("XT data is truncated");
  }

  const uint8_t* myData;
  size_t         mySize;
  size_t         myPos = 0;
};

struct Node
{
  int           type   = 0;
  const Layout* layout = nullptr;
  int           varLength = 0;
  std::vector<double> values; // transmitted fields in layout order, `width` doubles per element

  // The named field's values, or null when the layout has none.
  const double* get(const char* name, int* elements = nullptr) const
  {
    size_t at = 0;
    for (const Field& f : *layout)
    {
      if (!f.transmitted)
        continue;
      const int n = f.count == 1 ? varLength : std::max(f.count, 1);
      if (f.name == name)
      {
        if (elements)
          *elements = n;
        return values.data() + at;
      }
      at += size_t(n) * width(f.type);
    }
    return nullptr;
  }
  double num(const char* name) const
  {
    const double* v = get(name);
    if (!v)
      throw std::runtime_error(std::string("XT node lacks field ") + name);
    return *v;
  }
  int ref(const char* name) const { return int(num(name)); }
  gp_XYZ xyz(const char* name) const
  {
    const double* v = get(name);
    if (!v)
      throw std::runtime_error(std::string("XT node lacks field ") + name);
    return gp_XYZ(v[0], v[1], v[2]);
  }
};

class Reader
{
public:
  explicit Reader(Stream& in) : myIn(in) {}

  std::map<int, Node> read()
  {
    readHeader();
    std::map<int, Node> nodes;
    for (;;)
    {
      const int type = myIn.i16();
      if (type == kTerminator)
        return nodes;
      const Layout& layout = layoutOf(type);
      Node node;
      node.type   = type;
      node.layout = &layout;
      if (std::any_of(layout.begin(), layout.end(), [](const Field& f) { return f.count == 1; }))
        node.varLength = myIn.i32();
      const int index = myIn.index();
      for (const Field& f : layout)
        if (f.transmitted)
          readValues(f, f.count == 1 ? node.varLength : std::max(f.count, 1), node.values);
      nodes[index] = std::move(node);
    }
  }

private:
  // §3.3: "PS\0\0", modeller version, schema key, [node type count,] user field size.
  void readHeader()
  {
    if (myIn.chars(4) != std::string("PS\0\0", 4))
      throw std::runtime_error("Not neutral-binary XT data");
    myIn.chars(size_t(myIn.i16()));
    const std::string key = myIn.chars(size_t(myIn.i32())); // SCH_<version>_<schema>[_<base>]
    const size_t      last = key.rfind('_');
    if (std::count(key.begin(), key.end(), '_') == 3)
    {
      if (key.substr(last + 1) != "13006")
        throw std::runtime_error("Unsupported XT base schema " + key);
      myEmbedded = true;
      myIn.i16(); // number of node types
    }
    else if (key.substr(last + 1) != "13006")
    {
      throw std::runtime_error("XT data without an embedded schema: " + key);
    }
    if (myIn.i32() != 0)
      throw std::runtime_error("XT data with user fields is not supported");
  }

  // The layout of a node type; its first node carries the schema differences (§2.1.2.2).
  const Layout& layoutOf(int type)
  {
    if (auto it = myLayouts.find(type); it != myLayouts.end())
      return it->second;
    const auto& base   = baseSchema();
    const auto  baseIt = base.find(type);
    if (inBaseSchema(type) && baseIt == base.end())
      throw std::runtime_error("XT node type " + std::to_string(type) + " has no known base layout");
    Layout layout;
    if (!myEmbedded)
    {
      if (baseIt == base.end())
        throw std::runtime_error("Unknown XT node type " + std::to_string(type));
      layout = baseIt->second;
    }
    else if (baseIt == base.end())
    {
      const int n = myIn.byte(); // new type: full definition
      myIn.shortString();        // name
      myIn.shortString();        // description
      for (int i = 0; i < n; ++i)
        layout.push_back(fieldDefinition());
    }
    else
    {
      const int    n     = myIn.byte();
      const Layout& from = baseIt->second;
      if (n == 0xff)
        layout = from;
      else
      {
        size_t b = 0;
        for (char op; (op = char(myIn.byte())) != 'Z';)
        {
          if (op == 'C' && b < from.size())
            layout.push_back(from[b++]); // copied
          else if (op == 'D' && b < from.size())
            ++b; // deleted
          else if (op == 'I' || op == 'A')
            layout.push_back(fieldDefinition()); // inserted, appended
          else
            throw std::runtime_error("Bad XT schema edit for node type " + std::to_string(type));
        }
        if (int(layout.size()) != n)
          throw std::runtime_error("Inconsistent XT schema for node type " + std::to_string(type));
      }
    }
    return myLayouts[type] = std::move(layout);
  }

  Field fieldDefinition()
  {
    Field f;
    f.name         = myIn.shortString();
    const int cls  = myIn.i16();
    f.count        = myIn.index();
    const auto t   = cls != 0 ? std::string("p") : myIn.shortString();
    f.type         = t.empty() ? '?' : t[0];
    f.transmitted  = f.count == 1 ? myIn.byte() != 0 : true;
    return f;
  }

  void readValues(const Field& f, int n, std::vector<double>& out)
  {
    for (int i = 0; i < n; ++i)
      switch (f.type)
      {
        case 'u':
        case 'c':
        case 'l': out.push_back(myIn.byte()); break;
        case 'n':
        case 'w': out.push_back(myIn.i16()); break;
        case 'd': out.push_back(myIn.i32()); break;
        case 'p': out.push_back(myIn.index()); break;
        case 'f':
        case 'i':
        case 'v':
        case 'b':
        case 'h':
          for (int k = 0; k < width(f.type); ++k)
            out.push_back(myIn.f64());
          break;
        default: throw std::runtime_error(std::string("Unknown XT field type ") + f.type);
      }
  }

  Stream&               myIn;
  bool                  myEmbedded = false;
  std::map<int, Layout> myLayouts;
};

// Edges from the decoded nodes, in XT units (scaled by the caller).
class EdgeBuilder
{
public:
  explicit EdgeBuilder(const std::map<int, Node>& nodes) : myNodes(nodes) {}

  std::vector<TopoDS_Edge> build(double scale)
  {
    gp_Trsf toMm;
    toMm.SetScale(gp::Origin(), scale);
    std::vector<TopoDS_Edge> edges;
    for (const auto& entry : myNodes)
    {
      const Node& node = entry.second;
      if (node.type != kEdge)
        continue;
      try
      {
        if (TopoDS_Edge e = makeEdge(node, toMm); !e.IsNull())
          edges.push_back(e);
      }
      catch (const std::exception&)
      {
        // Unsupported curve, or geometry OCCT rejects: leave this edge out.
      }
    }
    return edges;
  }

private:
  const Node* find(int index, int type) const
  {
    auto it = myNodes.find(index);
    return it != myNodes.end() && it->second.type == type ? &it->second : nullptr;
  }

  // An edge's start vertex is edge->halfedge->other->vertex, its end edge->halfedge->vertex (§5.3.9.1).
  TopoDS_Edge makeEdge(const Node& edge, const gp_Trsf& toMm) const
  {
    const auto curveIt = myNodes.find(edge.ref("curve"));
    if (curveIt == myNodes.end())
      throw std::runtime_error("Tolerant edge"); // geometry on the fins' SP-curves: not supported
    const Node&        curveNode = curveIt->second;
    Handle(Geom_Curve) curve     = toCurve(curveNode);

    const Node* fin   = find(edge.ref("halfedge"), kHalfedge);
    const Node* other = fin ? find(fin->ref("other"), kHalfedge) : nullptr;
    const Node* end   = fin ? find(fin->ref("vertex"), kVertex) : nullptr;
    const Node* start = other ? find(other->ref("vertex"), kVertex) : nullptr;

    double u1, u2;
    if (curveNode.type == kTrimmedCurve || !start || !end)
    {
      // Trimmed curves span exactly their edge; ring edges (no vertices) the whole closed curve.
      u1 = curve->FirstParameter();
      u2 = curve->LastParameter();
    }
    else
    {
      u1 = parameter(curve, point(*start));
      u2 = parameter(curve, point(*end));
      if (char(curveNode.num("sense")) == '-')
        std::swap(u1, u2); // the edge runs against the curve
      if (curve->IsPeriodic())
      {
        const double period = curve->Period();
        while (u2 <= u1 + 1e-12)
          u2 += period; // also: a closed edge on one vertex is a full period
        while (u2 - u1 > period)
          u2 -= period;
      }
      else if (u1 > u2)
        std::swap(u1, u2);
    }
    if (Precision::IsInfinite(u1) || Precision::IsInfinite(u2))
      throw std::runtime_error("Unbounded edge");

    curve->Transform(toMm);
    u1 = curve->TransformedParameter(u1, toMm);
    u2 = curve->TransformedParameter(u2, toMm);
    BRepBuilderAPI_MakeEdge make(curve, u1, u2);
    return make.IsDone() ? make.Edge() : TopoDS_Edge();
  }

  gp_Pnt point(const Node& vertex) const
  {
    const Node* p = find(vertex.ref("point"), kPoint);
    if (!p)
      throw std::runtime_error("Vertex without point");
    return gp_Pnt(p->xyz("pvec"));
  }

  static double parameter(const Handle(Geom_Curve)& curve, const gp_Pnt& p)
  {
    GeomAPI_ProjectPointOnCurve proj(p, curve);
    if (proj.NbPoints() == 0)
      throw std::runtime_error("Vertex not on its edge curve");
    return proj.LowerDistanceParameter();
  }

  Handle(Geom_Curve) toCurve(const Node& c) const
  {
    switch (c.type)
    {
      case kLine: return new Geom_Line(gp_Pnt(c.xyz("pvec")), gp_Dir(c.xyz("direction")));
      case kCircle:
        return new Geom_Circle(gp_Ax2(gp_Pnt(c.xyz("centre")), gp_Dir(c.xyz("normal")), gp_Dir(c.xyz("x_axis"))),
                               c.num("radius"));
      case kEllipse:
        return new Geom_Ellipse(gp_Ax2(gp_Pnt(c.xyz("centre")), gp_Dir(c.xyz("normal")), gp_Dir(c.xyz("x_axis"))),
                                c.num("major_radius"),
                                c.num("minor_radius"));
      case kBCurve: return bspline(c);
      case kTrimmedCurve:
      {
        // parm_2 > parm_1 for a positive basis curve sense, < for a negative one (§5.2.1.6).
        const double p1 = c.num("parm_1"), p2 = c.num("parm_2");
        const auto   it = myNodes.find(c.ref("basis_curve"));
        if (it == myNodes.end())
          throw std::runtime_error("Trimmed curve without basis");
        return new Geom_TrimmedCurve(toCurve(it->second), std::min(p1, p2), std::max(p1, p2));
      }
      case kIntersection: return intersection(c);
      default: throw std::runtime_error("Unsupported XT curve type " + std::to_string(c.type));
    }
  }

  // §5.2.1.4: distinct knots with multiplicities, n_knots = n_vertices + degree + 1 in full; rational
  // vertices carry the weight as a 4th coordinate, with x, y, z multiplied by it.
  Handle(Geom_Curve) bspline(const Node& c) const
  {
    const Node* n = find(c.ref("nurbs"), kNurbsCurve);
    if (!n)
      throw std::runtime_error("B-curve without NURBS data");
    const int   degree = n->ref("degree"), count = n->ref("n_vertices"), dim = n->ref("vertex_dim");
    const int   nk     = n->ref("n_knots"); // the knot arrays may be longer, padded with null values
    const Node* verts  = find(n->ref("bspline_vertices"), kBsplineVerts);
    const Node* mults  = find(n->ref("knot_mult"), kKnotMult);
    const Node* knots  = find(n->ref("knots"), kKnotSet);
    if (!verts || !mults || !knots || (dim != 3 && dim != 4) || verts->varLength != count * dim
        || mults->varLength < nk || knots->varLength < nk)
      throw std::runtime_error("Unsupported B-curve");

    const double*      v = verts->get("vertices");
    TColgp_Array1OfPnt poles(1, count);
    TColStd_Array1OfReal weights(1, count);
    for (int i = 0; i < count; ++i)
    {
      const double* p = v + size_t(i) * dim;
      const double  w = dim == 4 ? p[3] : 1.0;
      poles(i + 1)    = gp_Pnt(p[0] / w, p[1] / w, p[2] / w);
      weights(i + 1)  = w;
    }
    TColStd_Array1OfReal    kv(1, nk);
    TColStd_Array1OfInteger km(1, nk);
    for (int i = 0; i < nk; ++i)
    {
      kv(i + 1) = knots->get("knots")[i];
      km(i + 1) = int(mults->get("mult")[i]);
    }
    // The full (possibly unclamped) knot vector is a valid non-periodic OCCT B-spline as well.
    if (dim == 4)
      return new Geom_BSplineCurve(poles, weights, kv, km, degree);
    return new Geom_BSplineCurve(poles, kv, km, degree);
  }

  // §5.2.1.5: the exact curve is a surface/surface intersection; the chart samples it closely
  // enough to interpolate, from the start limit to the end limit.
  Handle(Geom_Curve) intersection(const Node& c) const
  {
    std::vector<gp_Pnt> pts;
    auto add = [&](const Node* n) {
      int           count = 0;
      const double* h     = n ? n->get("hvec", &count) : nullptr;
      for (int i = 0; h && i < count; ++i)
      {
        const gp_Pnt p(h[3 * i], h[3 * i + 1], h[3 * i + 2]);
        if (pts.empty() || pts.back().SquareDistance(p) > 1e-20)
          pts.push_back(p);
      }
    };
    add(find(c.ref("start"), kLimit));
    add(find(c.ref("chart"), kChart));
    add(find(c.ref("end"), kLimit));
    if (pts.size() < 2)
      throw std::runtime_error("Intersection curve without chart");
    Handle(TColgp_HArray1OfPnt) arr = new TColgp_HArray1OfPnt(1, int(pts.size()));
    for (size_t i = 0; i < pts.size(); ++i)
      arr->SetValue(int(i) + 1, pts[i]);
    GeomAPI_Interpolate interp(arr, false, 1e-12);
    interp.Perform();
    if (!interp.IsDone())
      throw std::runtime_error("Intersection curve interpolation failed");
    return interp.Curve();
  }

  const std::map<int, Node>& myNodes;
};

} // namespace

std::vector<TopoDS_Edge> readXtEdges(const uint8_t* data, size_t size, double scale)
{
  Stream in(data, size);
  Reader reader(in); // owns the layouts the nodes point to
  const std::map<int, Node> nodes = reader.read();
  return EdgeBuilder(nodes).build(scale);
}
