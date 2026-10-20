// QIF 3 (ISO 23952) reader. The model is a B-rep like STEP's (§7.5.3): bodies of shells of faces,
// each face a surface trimmed by loops of co-edges, each co-edge an edge with its 2D curve on the
// surface. Built into OCCT shapes here, so meshing, measuring and the rest work as for STEP.
//
// QIF surfaces have parameterisations of their own (§7.5.2.4: scaled and turned u/v, plane vectors
// that need not be orthonormal, revolution's u and v swapped). For every type the map from QIF (u,v)
// to OCCT (u,v) is affine, so 2D curves are mapped exactly: as B-splines, by mapping their poles.
// QIF 2D and 3D curves are parameterised independently, so edges are brought to the same parameter
// by ShapeFix afterwards.
//
// Drawn PMI (PMIDisplay) is 2D geometry and text in a plane; the text is drawn in a font of our own
// (pmi_text.h), not the exporter's.
//
// Not read: mesh faces, point clouds, spline (polynomial) curves and surfaces; of drawn PMI, areas
// given as loops, flag and weld symbol frames.

#include "qif_reader.h"
#include "pmi_text.h"

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <GeomAdaptor_Curve.hxx>
#include <BSplCLib.hxx>
#include <Geom2d_BSplineCurve.hxx>
#include <GeomConvert.hxx>
#include <GeomConvert_CompCurveToBSplineCurve.hxx>
#include <GeomFill.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Circle.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Hyperbola.hxx>
#include <Geom_Line.hxx>
#include <Geom_OffsetSurface.hxx>
#include <Geom_Parabola.hxx>
#include <Geom_Plane.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <LDOMParser.hxx>
#include <NCollection_DataMap.hxx>
#include <LDOM_Document.hxx>
#include <LDOM_Element.hxx>
#include <Precision.hxx>
#include <Quantity_Color.hxx>
#include <ShapeBuild_ReShape.hxx>
#include <ShapeFix_Shape.hxx>
#include <TDataStd_Name.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Wire.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Ax3.hxx>
#include <gp_GTrsf2d.hxx>
#include <gp_Quaternion.hxx>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace
{

// ---------------------------------------------------------------------------
// XML access

std::string str(const LDOMBasicString& s)
{
  if (s.Type() == LDOMBasicString::LDOM_Integer) // LDOM keeps integer-looking values as integers
  {
    int i = 0;
    s.GetInteger(i);
    return std::to_string(i);
  }
  return s.GetString();
}

std::string tagOf(const LDOM_Element& e)
{
  return str(e.getTagName());
}

std::string attr(const LDOM_Element& e, const char* name)
{
  return e.isNull() ? std::string() : str(e.getAttribute(name));
}

bool flag(const LDOM_Element& e, const char* name)
{
  const std::string v = attr(e, name);
  return v == "true" || v == "1";
}

std::vector<LDOM_Element> elements(const LDOM_Element& e)
{
  std::vector<LDOM_Element> out;
  if (!e.isNull())
    for (LDOM_Node n = e.getFirstChild(); !n.isNull(); n = n.getNextSibling())
      if (n.getNodeType() == LDOM_Node::ELEMENT_NODE)
        out.push_back(static_cast<const LDOM_Element&>(n));
  return out;
}

LDOM_Element child(const LDOM_Element& e, const std::string& name)
{
  for (const LDOM_Element& c : elements(e))
    if (tagOf(c) == name)
      return c;
  return {};
}

// The geometric core inside a wrapper (<Nurbs13 id><Nurbs13Core>) or a container (<Generatrix>).
LDOM_Element coreOf(const LDOM_Element& e)
{
  for (const LDOM_Element& c : elements(e))
    if (const std::string t = tagOf(c); t.size() > 4 && t.compare(t.size() - 4, 4, "Core") == 0)
      return c;
  throw std::runtime_error("QIF: " + tagOf(e) + " has no geometry core");
}

std::string text(const LDOM_Element& e)
{
  std::string out;
  if (!e.isNull())
    for (LDOM_Node n = e.getFirstChild(); !n.isNull(); n = n.getNextSibling())
      if (n.getNodeType() == LDOM_Node::TEXT_NODE || n.getNodeType() == LDOM_Node::CDATA_SECTION_NODE)
        out += str(n.getNodeValue());
  return out;
}

// An element's text without surrounding white space, for enumerations and Booleans.
std::string token(const LDOM_Element& e)
{
  const std::string s     = text(e);
  const size_t      first = s.find_first_not_of(" \t\r\n");
  return first == std::string::npos ? std::string() : s.substr(first, s.find_last_not_of(" \t\r\n") - first + 1);
}

std::vector<double> parseNumbers(const std::string& s)
{
  std::vector<double> out;
  const char* p = s.c_str();
  for (char* end = nullptr;; p = end)
  {
    const double v = std::strtod(p, &end);
    if (end == p)
      break;
    if (!std::isfinite(v)) // strtod also reads nan and inf
      throw std::runtime_error("QIF: " + std::string(p, static_cast<const char*>(end)) + " is not a finite number");
    out.push_back(v);
  }
  return out;
}

std::vector<double> base64Doubles(const std::string& s)
{
  std::vector<uint8_t> bytes;
  uint32_t             acc = 0;
  int                  bits = 0;
  for (const char c : s)
  {
    int v = c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52 : c == '+' ? 62 : c == '/' ? 63 : -1;
    if (v < 0)
      continue;
    acc  = (acc << 6) | uint32_t(v);
    bits += 6;
    if (bits >= 8)
    {
      bits -= 8;
      bytes.push_back(uint8_t(acc >> bits));
    }
  }
  std::vector<double> out(bytes.size() / 8);
  std::memcpy(out.data(), bytes.data(), out.size() * 8); // little-endian, as WebAssembly
  if (!std::all_of(out.begin(), out.end(), [](double v) { return std::isfinite(v); }))
    throw std::runtime_error("QIF: binary array with a value that is not a finite number");
  return out;
}

// Numbers of child name, or of its binary form (nameBinary, base64 doubles).
std::vector<double> numbers(const LDOM_Element& e, const std::string& name)
{
  if (const LDOM_Element c = child(e, name); !c.isNull())
    return parseNumbers(text(c));
  if (const LDOM_Element c = child(e, name + "Binary"); !c.isNull())
    return base64Doubles(text(c));
  return {};
}

double number(const LDOM_Element& e, const std::string& name)
{
  const std::vector<double> v = numbers(e, name);
  if (v.empty())
    throw std::runtime_error("QIF: " + tagOf(e) + " has no " + name);
  return v[0];
}

gp_XYZ xyz(const LDOM_Element& e, const std::string& name) // 2D values get z = 0
{
  const std::vector<double> v = numbers(e, name);
  if (v.size() < 2)
    throw std::runtime_error("QIF: " + tagOf(e) + " has no " + name);
  return {v[0], v[1], v.size() > 2 ? v[2] : 0.0};
}

gp_Dir dir(const LDOM_Element& e, const std::string& name)
{
  return gp_Dir(xyz(e, name));
}

int idOf(const LDOM_Element& e)
{
  return std::atoi(text(e).c_str());
}

// Ids listed under child name (<FaceIds><Id>..</Id>...</FaceIds>).
std::vector<int> ids(const LDOM_Element& e, const std::string& name)
{
  std::vector<int> out;
  for (const LDOM_Element& c : elements(child(e, name)))
    if (tagOf(c) == "Id")
      out.push_back(idOf(c));
  return out;
}

// The id referenced by child name (<Surface><Id>..</Id></Surface>); 0 if none.
int ref(const LDOM_Element& e, const std::string& name)
{
  return idOf(child(child(e, name), "Id"));
}

// Words of a CamelCase name: SurfaceProfile → Surface profile.
std::string words(const std::string& camel)
{
  std::string out;
  for (size_t i = 0; i < camel.size(); ++i)
  {
    const char c = camel[i];
    if (i > 0 && std::isupper(static_cast<unsigned char>(c)))
      out += ' ', out += char(std::tolower(static_cast<unsigned char>(c)));
    else
      out += c;
  }
  return out;
}

std::optional<Quantity_Color> colorOf(const LDOM_Element& e)
{
  const std::vector<double> rgb = parseNumbers(attr(e, "color"));
  if (rgb.size() != 3)
    return std::nullopt;
  return Quantity_Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, Quantity_TOC_sRGB);
}

// ---------------------------------------------------------------------------
// Geometry

// A curve over its QIF domain: OCCT parameters first..last. Where the QIF parameter maps to OCCT's
// as scale * t + shift (exact), extrusions and revolutions of it map their parameters too.
struct Curve
{
  Handle(Geom_Curve) curve;
  double             first = 0, last = 0;
  double             scale = 1, shift = 0;
  bool               affine = true;
};

Handle(Geom_BSplineCurve) toBSpline(const Curve& c)
{
  return GeomConvert::CurveToBSplineCurve(new Geom_TrimmedCurve(c.curve, c.first, c.last));
}

void reparametrize(const Handle(Geom_BSplineCurve)& bs, double first, double last)
{
  NCollection_Array1<double> knots = bs->Knots();
  BSplCLib::Reparametrize(first, last, knots);
  bs->SetKnots(knots);
}

// Flat knot vector (with repetitions, as QIF and STEP write them) → knots and multiplicities.
void splitKnots(const std::vector<double>& flat, NCollection_Array1<double>& knots, NCollection_Array1<int>& mults)
{
  NCollection_Array1<double> seq(1, int(flat.size()));
  for (int i = 0; i < int(flat.size()); ++i)
    seq(i + 1) = flat[size_t(i)];
  const int n = BSplCLib::KnotsLength(seq);
  knots.Resize(1, n, false);
  mults.Resize(1, n, false);
  BSplCLib::Knots(seq, knots, mults);
}

Handle(Geom_BSplineCurve) nurbsCurve(const LDOM_Element& c)
{
  const int                 degree  = int(number(c, "Order")) - 1;
  const std::vector<double> flat    = numbers(c, "Knots");
  std::vector<double>       cps     = numbers(c, "CPs");
  const std::vector<double> weights = numbers(c, "Weights");
  const int                 dim     = tagOf(c).find("12") != std::string::npos ? 2 : 3;
  const int                 n       = int(cps.size()) / dim;
  if (degree < 1 || n < 2 || int(flat.size()) != n + degree + 1 || (!weights.empty() && int(weights.size()) != n))
    throw std::runtime_error("QIF: inconsistent NURBS curve");
  NCollection_Array1<gp_Pnt> poles(1, n);
  for (int i = 0; i < n; ++i)
    poles(i + 1) = gp_Pnt(cps[size_t(dim * i)], cps[size_t(dim * i + 1)], dim == 3 ? cps[size_t(dim * i + 2)] : 0.0);
  NCollection_Array1<double> knots;
  NCollection_Array1<int>    mults;
  splitKnots(flat, knots, mults);
  if (weights.empty())
    return new Geom_BSplineCurve(poles, knots, mults, degree);
  NCollection_Array1<double> w(1, n);
  for (int i = 0; i < n; ++i)
    w(i + 1) = weights[size_t(i)];
  return new Geom_BSplineCurve(poles, w, knots, mults, degree);
}

Handle(Geom_BSplineCurve) polyline(const std::vector<gp_Pnt>& pts)
{
  const int                  n = int(pts.size());
  NCollection_Array1<gp_Pnt> poles(1, n);
  NCollection_Array1<double> knots(1, n);
  NCollection_Array1<int>    mults(1, n);
  for (int i = 0; i < n; ++i)
  {
    poles(i + 1) = pts[size_t(i)];
    knots(i + 1) = i;
    mults(i + 1) = i == 0 || i == n - 1 ? 2 : 1;
  }
  return new Geom_BSplineCurve(poles, knots, mults, 1);
}

Curve curveOf(const LDOM_Element& c);

// A concatenation of sub-curves, each converted to a B-spline over its share of the domain.
Curve aggregate(const LDOM_Element& c)
{
  GeomConvert_CompCurveToBSplineCurve join;
  double                              t = 0;
  for (const LDOM_Element& sub : elements(child(c, "SubCurves")))
  {
    const Curve               part = curveOf(coreOf(sub));
    Handle(Geom_BSplineCurve) bs   = toBSpline(part);
    if (flag(sub, "turned"))
      bs->Reverse();
    const double length = std::abs(part.last - part.first);
    reparametrize(bs, t, t + length);
    if (!join.Add(bs, 1e-4, true, false))
      throw std::runtime_error("QIF: aggregate curve with a gap");
    t += length;
  }
  if (join.BSplineCurve().IsNull())
    throw std::runtime_error("QIF: empty aggregate curve");
  const Handle(Geom_BSplineCurve) bs = join.BSplineCurve();
  return {bs, bs->FirstParameter(), bs->LastParameter(), 1, bs->FirstParameter(), false};
}

// A QIF curve core (2D or 3D; 2D in the z = 0 plane) over its domain.
Curve curveOf(const LDOM_Element& c)
{
  const std::string         tag    = tagOf(c);
  const std::string         kind   = tag.substr(0, tag.size() - 6); // without 12Core / 13Core
  const bool                is2d   = tag.find("12Core") != std::string::npos;
  const std::vector<double> domain = parseNumbers(attr(c, "domain"));
  if (kind == "Aggregate")
    return aggregate(c);
  if (domain.size() != 2)
    throw std::runtime_error("QIF: " + tag + " has no domain");
  const double t0 = domain[0], t1 = domain[1];
  // 2D arcs turn clockwise when turned: as 3D arcs about -z.
  const gp_Dir normal = is2d ? gp_Dir(0, 0, flag(c, "turned") ? -1 : 1) : gp_Dir(0, 0, 1);

  if (kind == "Segment")
  {
    const gp_Pnt s = xyz(c, "StartPoint"), e = xyz(c, "EndPoint");
    const double len = s.Distance(e);
    if (len < Precision::Confusion())
      throw std::runtime_error("QIF: zero-length segment");
    return {new Geom_Line(s, gp_Dir(gp_Vec(s, e))), len * t0, len * t1, len, 0};
  }
  if (kind == "Polyline")
  {
    const std::vector<double> v   = numbers(c, "Points");
    const int                 dim = is2d ? 2 : 3;
    std::vector<gp_Pnt>       pts;
    for (size_t i = 0; i + dim <= v.size(); i += dim)
      pts.emplace_back(v[i], v[i + 1], is2d ? 0.0 : v[i + 2]);
    if (pts.size() < 2)
      throw std::runtime_error("QIF: polyline with fewer than 2 points");
    return {polyline(pts), t0, t1};
  }
  if (kind == "ArcCircular")
  {
    const gp_Ax2 ax(xyz(c, "Center"), is2d ? normal : dir(c, "Normal"), dir(c, "DirBeg"));
    return {new Geom_Circle(ax, number(c, "Radius")), t0, t1};
  }
  if (kind == "ArcConic")
  {
    const gp_Pnt      center = xyz(c, "Center");
    const gp_Dir      n      = is2d ? normal : dir(c, "Normal");
    const gp_Dir      x      = dir(c, "DirBeg");
    const gp_Dir      y      = n.Crossed(x);
    const double      a = number(c, "A"), b = number(c, "B");
    const std::string form = attr(c, "form");
    if (form == "ELLIPSE")
    {
      if (a >= b)
        return {new Geom_Ellipse(gp_Ax2(center, n, x), a, b), t0, t1};
      // OCCT's major axis comes first: along DirY, starting a quarter turn later.
      return {new Geom_Ellipse(gp_Ax2(center, n, y), b, a), t0 - M_PI / 2, t1 - M_PI / 2, 1, -M_PI / 2};
    }
    if (form == "PARABOLA") // x = A t, y = B t²: OCCT's axis along ±DirY, its parameter |A| t
    {
      const gp_Dir axis = b >= 0 ? y : -y, side = a >= 0 ? x : -x;
      const gp_Ax2 ax(center, axis.Crossed(side), axis);
      const double s = std::abs(a);
      return {new Geom_Parabola(ax, a * a / (4 * std::abs(b))), s * t0, s * t1, s, 0};
    }
    if (form == "HYPERBOLA") // x = A √(1 + t²/B²), y = t: OCCT's u = asinh(t / B), not affine
    {
      const double bb = std::abs(b);
      return {new Geom_Hyperbola(gp_Ax2(center, n, x), a, bb), std::asinh(t0 / bb), std::asinh(t1 / bb), 1, 0, false};
    }
    throw std::runtime_error("QIF: unknown conic form " + form);
  }
  if (kind == "Nurbs")
  {
    const Handle(Geom_BSplineCurve) bs = nurbsCurve(c);
    return {bs, std::max(t0, bs->FirstParameter()), std::min(t1, bs->LastParameter())};
  }
  throw std::runtime_error("QIF: " + tag + " is not supported");
}

// 2D curve in QIF (u,v) → B-spline in OCCT (u,v).
Handle(Geom2d_BSplineCurve) mapCurve(const Curve& c, const gp_GTrsf2d& uv)
{
  const Handle(Geom_BSplineCurve) bs = toBSpline(c);
  NCollection_Array1<gp_Pnt2d>    poles(1, bs->NbPoles());
  for (int i = 1; i <= bs->NbPoles(); ++i)
  {
    gp_XY p(bs->Pole(i).X(), bs->Pole(i).Y());
    uv.Transforms(p);
    poles(i) = gp_Pnt2d(p);
  }
  if (bs->IsRational())
    return new Geom2d_BSplineCurve(poles, *bs->Weights(), bs->Knots(), bs->Multiplicities(), bs->Degree());
  return new Geom2d_BSplineCurve(poles, bs->Knots(), bs->Multiplicities(), bs->Degree());
}

// A surface and the map from QIF (u,v) to its OCCT (u,v).
struct Surface
{
  Handle(Geom_Surface) surface;
  gp_GTrsf2d           uv;
};

gp_GTrsf2d affine(double a11, double a12, double a21, double a22, double tu = 0, double tv = 0)
{
  return gp_GTrsf2d(gp_Mat2d(gp_XY(a11, a21), gp_XY(a12, a22)), gp_XY(tu, tv));
}

double attrOr(const LDOM_Element& e, const char* name, double fallback)
{
  const std::vector<double> v = parseNumbers(attr(e, name));
  return v.empty() ? fallback : v[0];
}

Surface surfaceOf(const LDOM_Element& c)
{
  const std::string tag = tagOf(c);
  const double      su = attrOr(c, "scaleU", 1), sv = attrOr(c, "scaleV", 1);
  const double      tv = flag(c, "turnedV") ? -sv : sv; // v' = ±scaleV v (+ offset)
  const LDOM_Element axis = child(c, "Axis");

  if (tag == "Plane23Core") // Origin + u DirU + v DirV, DirU and DirV of any length and angle
  {
    const gp_Vec a(xyz(c, "DirU")), b(xyz(c, "DirV"));
    const gp_Dir n = a.Crossed(b), x = a;
    const gp_Dir y = n.Crossed(x);
    return {new Geom_Plane(gp_Ax3(xyz(c, "Origin"), n, x)), affine(a.Magnitude(), b.Dot(x), 0, b.Dot(y))};
  }
  if (tag == "Cylinder23Core" || tag == "Cone23Core")
  {
    const LDOM_Element sweep = child(c, "Sweep");
    const gp_Ax3       ax(xyz(axis, "AxisPoint"), dir(axis, "Direction"), dir(sweep, "DirBeg"));
    const double       len = number(c, "Length");
    const double       rb  = (tag == "Cone23Core" ? number(c, "DiameterBottom") : number(c, "Diameter")) / 2;
    const double       rt  = tag == "Cone23Core" ? number(c, "DiameterTop") / 2 : rb;
    const double       v0  = flag(c, "turnedV") ? len : 0;
    if (std::abs(rt - rb) <= Precision::Confusion())
      return {new Geom_CylindricalSurface(ax, rb), affine(su, 0, 0, tv, 0, v0)};
    // OCCT runs v along the cone's side: v = axial distance / cos(semi-angle).
    const double angle = std::atan2(rt - rb, len), k = 1 / std::cos(angle);
    return {new Geom_ConicalSurface(ax, angle, rb), affine(su, 0, 0, tv * k, 0, v0 * k)};
  }
  if (tag == "Sphere23Core")
  {
    const LDOM_Element sweep = child(c, "LatitudeLongitudeSweep");
    const gp_Ax3       ax(xyz(c, "Location"), dir(sweep, "DirNorthPole"), dir(sweep, "DirMeridianPrime"));
    return {new Geom_SphericalSurface(ax, number(c, "Diameter") / 2), affine(su, 0, 0, tv)};
  }
  if (tag == "Torus23Core")
  {
    const LDOM_Element sweep = child(c, "LatitudeLongitudeSweep");
    const gp_Ax3       ax(xyz(axis, "AxisPoint"), dir(axis, "Direction"), dir(sweep, "DirMeridianPrime"));
    return {new Geom_ToroidalSurface(ax, number(c, "DiameterMajor") / 2, number(c, "DiameterMinor") / 2),
            affine(su, 0, 0, tv, 0, attrOr(c, "offsetV", 0))};
  }
  if (tag == "Nurbs23Core") // control points with u running fastest
  {
    const int                 du = int(number(c, "OrderU")) - 1, dv = int(number(c, "OrderV")) - 1;
    const std::vector<double> ku = numbers(c, "KnotsU"), kv = numbers(c, "KnotsV");
    const std::vector<double> cps = numbers(c, "CPs"), weights = numbers(c, "Weights");
    const int                 nu = int(ku.size()) - du - 1, nv = int(kv.size()) - dv - 1;
    if (du < 1 || dv < 1 || nu < 2 || nv < 2 || int(cps.size()) != 3 * nu * nv
        || (!weights.empty() && int(weights.size()) != nu * nv))
      throw std::runtime_error("QIF: inconsistent NURBS surface");
    NCollection_Array2<gp_Pnt> poles(1, nu, 1, nv);
    NCollection_Array2<double> w(1, nu, 1, nv);
    for (int j = 0; j < nv; ++j)
      for (int i = 0; i < nu; ++i)
      {
        const size_t k     = size_t(j * nu + i);
        poles(i + 1, j + 1) = gp_Pnt(cps[3 * k], cps[3 * k + 1], cps[3 * k + 2]);
        w(i + 1, j + 1)     = weights.empty() ? 1.0 : weights[k];
      }
    NCollection_Array1<double> uk, vk;
    NCollection_Array1<int>    um, vm;
    splitKnots(ku, uk, um);
    splitKnots(kv, vk, vm);
    return {new Geom_BSplineSurface(poles, w, uk, vk, um, vm, du, dv), gp_GTrsf2d()};
  }
  if (tag == "Extrude23Core") // Curve(u) + (TerminationPoint − Curve(start)) v
  {
    const Curve curve = curveOf(coreOf(child(c, "Curve")));
    if (!curve.affine)
      throw std::runtime_error("QIF: extrusion of this curve type is not supported");
    const gp_Vec d(curve.curve->Value(curve.first), xyz(c, "TerminationPoint"));
    return {new Geom_SurfaceOfLinearExtrusion(curve.curve, d), affine(curve.scale, 0, 0, d.Magnitude(), curve.shift, 0)};
  }
  if (tag == "Revolution23Core") // u along the generatrix, v the angle: OCCT has them the other way round
  {
    const Curve curve = curveOf(coreOf(child(c, "Generatrix")));
    if (!curve.affine)
      throw std::runtime_error("QIF: revolution of this curve type is not supported");
    const gp_Ax1 ax(xyz(axis, "AxisPoint"), dir(axis, "Direction"));
    return {new Geom_SurfaceOfRevolution(curve.curve, ax), affine(0, 1, curve.scale, 0, 0, curve.shift)};
  }
  if (tag == "Ruled23Core") // both curves over u in [0, 1], v from the first to the second
  {
    std::vector<Handle(Geom_BSplineCurve)> curves;
    for (const LDOM_Element& e : elements(c))
      if (tagOf(e) == "Curve")
      {
        curves.push_back(toBSpline(curveOf(coreOf(e))));
        reparametrize(curves.back(), 0, 1);
      }
    if (curves.size() != 2)
      throw std::runtime_error("QIF: ruled surface without two curves");
    if (flag(c, "turnedSecondCurve"))
      curves[1]->Reverse(), reparametrize(curves[1], 0, 1);
    return {GeomFill::Surface(curves[0], curves[1]), gp_GTrsf2d()};
  }
  if (tag == "Offset23Core") // along the base surface's normal in QIF terms: flip if OCCT's is opposite
  {
    Surface      base = surfaceOf(coreOf(child(c, "Surface")));
    const double d    = number(c, "Distance");
    base.surface      = new Geom_OffsetSurface(base.surface, base.uv.VectorialPart().Determinant() < 0 ? -d : d);
    return base;
  }
  throw std::runtime_error("QIF: " + tag + " is not supported");
}

// ---------------------------------------------------------------------------
// Drawn PMI (§7.5.7.5): 2D lines, frames, leaders and text in the plane of a PMIDisplay

std::vector<gp_XY> points2d(const LDOM_Element& e, const std::string& name)
{
  const std::vector<double> v = numbers(e, name);
  std::vector<gp_XY>        out;
  for (size_t i = 0; i + 1 < v.size(); i += 2)
    out.emplace_back(v[i], v[i + 1]);
  return out;
}

gp_XY xy(const LDOM_Element& e, const std::string& name)
{
  const gp_XYZ p = xyz(e, name);
  return {p.X(), p.Y()};
}

std::optional<gp_XY> optionalXy(const LDOM_Element& e, const std::string& name)
{
  return numbers(e, name).empty() ? std::nullopt : std::optional<gp_XY>(xy(e, name));
}

// UTF-8, with a byte that does not start a valid sequence taken as Latin-1: LDOM keeps a character
// reference such as &#216; as that one byte.
std::u32string decode(const std::string& s)
{
  std::u32string out;
  for (size_t i = 0; i < s.size();)
  {
    const unsigned char c  = static_cast<unsigned char>(s[i]);
    const size_t        n  = c < 0xC2 ? 0 : c < 0xE0 ? 1 : c < 0xF0 ? 2 : c < 0xF5 ? 3 : 0; // continuation bytes
    char32_t            cp = c & (0x3F >> n);
    bool                ok = n > 0 && i + n < s.size();
    for (size_t k = 1; ok && k <= n; ++k)
    {
      const unsigned char b = static_cast<unsigned char>(s[i + k]);
      ok                    = (b & 0xC0) == 0x80;
      cp                    = cp << 6 | (b & 0x3F);
    }
    out.push_back(ok ? cp : c);
    i += ok ? n + 1 : 1;
  }
  return out;
}

// Special symbols (§7.5.7.3, Table 7) as the font's characters; {BR} breaks the line. Tokens not
// listed (weld symbols) are drawn as written.
std::vector<std::u32string> textLines(const std::string& data)
{
  static const std::map<std::string, std::u32string> kSymbols = {
    {"STRAIGHTNESS", U"⏤"}, {"FLATNESS", U"⏥"}, {"CIRCULARITY", U"○"}, {"CYLINDRICITY", U"⌭"},
    {"PROFILE_LINE", U"⌒"}, {"PROFILE_SURFACE", U"⌓"}, {"ANGULARITY", U"∠"},
    {"PERPENDICULARITY", U"⟂"}, {"PARALLELISM", U"∥"}, {"POSITION", U"⌖"},
    {"CONCENTRICITY", U"◎"}, {"SYMMETRY", U"⌯"}, {"RUNOUT_CIRCULAR", U"↗"}, {"RUNOUT_TOTAL", U"⌰"},
    {"DIAMETER", U"⌀"}, {"DIAMETER_SPHERICAL", U"S⌀"}, {"RADIUS", U"R"}, {"RADIUS_SPHERICAL", U"SR"},
    {"RADIUS_CONTROLLED", U"CR"}, {"BETWEEN", U"↔"}, {"CONICAL_TAPER", U"⌲"}, {"SLOPE", U"⌳"},
    {"COUNTERBORE", U"⌴"}, {"SPOTFACE", U"SF"}, {"COUNTERSINK", U"⌵"}, {"DEPTH", U"↧"},
    {"SQUARE", U"□"}, {"PLUS_MINUS", U"±"}, {"DEGREE", U"°"}, {"ST", U"ST"}, {"CF", U"CF"},
    {"M", U"Ⓜ"}, {"L", U"Ⓛ"}, {"P", U"Ⓟ"}, {"T", U"Ⓣ"}, {"F", U"Ⓕ"}, {"U", U"Ⓤ"},
    {"I", U"(I)"}, {"TRANSLATION", U"▷"}, {"BRACKET_CURLED_LEFT", U"{"}, {"BRACKET_CURLED_RIGHT", U"}"}};
  std::vector<std::u32string> lines(1);
  for (size_t i = 0; i < data.size();)
  {
    const size_t open  = data.find('{', i);
    const size_t close = open == std::string::npos ? open : data.find('}', open);
    if (close == std::string::npos)
    {
      lines.back() += decode(data.substr(i));
      break;
    }
    lines.back() += decode(data.substr(i, open - i));
    const std::string name = data.substr(open + 1, close - open - 1);
    if (name == "BR")
      lines.emplace_back();
    else if (const auto sym = kSymbols.find(name); sym != kSymbols.end())
      lines.back() += sym->second;
    else
      lines.back() += decode(data.substr(open, close - open + 1));
    i = close + 1;
  }
  return lines;
}

// A PMIDisplay's plane: 2D points in QIF length units → model coordinates, drawn into its item.
struct Sketch
{
  gp_Pnt       origin;
  gp_Dir       x, y;
  double       unit; // mm per QIF length unit
  FilePmiItem& item;

  gp_Pnt at(const gp_XY& p) const
  {
    return origin.Translated(gp_Vec(x) * (p.X() * unit) + gp_Vec(y) * (p.Y() * unit));
  }

  void line(const gp_XY& a, const gp_XY& b)
  {
    if (a.IsEqual(b, 0))
      return;
    for (const gp_Pnt& p : {at(a), at(b)})
      item.segments.insert(item.segments.end(), {float(p.X()), float(p.Y()), float(p.Z())});
  }

  void polyline(const std::vector<gp_XY>& pts, bool closed)
  {
    for (size_t i = 0; i + 1 < pts.size(); ++i)
      line(pts[i], pts[i + 1]);
    if (closed && pts.size() > 2)
      line(pts.back(), pts.front());
  }

  void triangle(const gp_XY& a, const gp_XY& b, const gp_XY& c)
  {
    for (const gp_Pnt& p : {at(a), at(b), at(c)})
      item.triangles.insert(item.triangles.end(), {float(p.X()), float(p.Y()), float(p.Z())});
  }

  // Points along the arc around center from a to b, the shorter way (QIF arcs are at most a semicircle).
  static std::vector<gp_XY> arc(const gp_XY& center, const gp_XY& a, const gp_XY& b)
  {
    const gp_XY  ra = a - center, rb = b - center;
    const double r = ra.Modulus(), from = std::atan2(ra.Y(), ra.X());
    const double sweep = std::atan2(ra.Crossed(rb), ra.Dot(rb));
    const int    n     = std::max(2, int(std::ceil(std::abs(sweep) / (M_PI / 32))));
    std::vector<gp_XY> out;
    for (int i = 0; i <= n; ++i)
    {
      const double t = from + sweep * i / n;
      out.push_back(center + gp_XY(std::cos(t), std::sin(t)) * r);
    }
    return out;
  }

  void circle(const gp_XY& center, double r, bool filled)
  {
    std::vector<gp_XY> pts;
    for (int i = 0; i < 64; ++i)
      pts.push_back(center + gp_XY(std::cos(i * M_PI / 32), std::sin(i * M_PI / 32)) * r);
    if (!filled)
      polyline(pts, true);
    for (size_t i = 1; filled && i + 1 < pts.size(); ++i)
      triangle(pts[0], pts[i], pts[i + 1]);
  }

  // A leader head (§7.5.7.5.2) at tip, pointing along dir (unit), size long.
  void head(const std::string& form, const gp_XY& tip, const gp_XY& dir, double size)
  {
    if (!(size > 0))
      return;
    const gp_XY n(-dir.Y(), dir.X());
    const bool  filled = form.find("FILLED") != std::string::npos && form.find("UNFILLED") == std::string::npos;
    if (form.rfind("DOT_", 0) == 0 || form == "DIMENSION_ORIGIN")
      circle(tip, size / 4, filled);
    else if (form.rfind("BOX_", 0) == 0)
    {
      const gp_XY d = (dir + n) * (size / 4), e = (dir - n) * (size / 4);
      const gp_XY corners[4] = {tip + d, tip - e, tip - d, tip + e};
      if (filled)
        triangle(corners[0], corners[1], corners[2]), triangle(corners[0], corners[2], corners[3]);
      else
        polyline({corners[0], corners[1], corners[2], corners[3]}, true);
    }
    else if (form == "SYMBOL_SLASH")
      line(tip - (dir + n) * (size / 2), tip + (dir + n) * (size / 2));
    else if (form == "SYMBOL_CROSS")
    {
      line(tip - (dir + n) * (size / 2), tip + (dir + n) * (size / 2));
      line(tip - (dir - n) * (size / 2), tip + (dir - n) * (size / 2));
    }
    else if (form != "NONE") // arrows and triangles; also the integral sign, not drawn as such
    {
      const double halfWidth = size * (form.rfind("TRIANGLE_", 0) == 0 ? std::tan(M_PI / 6) : std::tan(M_PI / 12));
      const gp_XY  base = tip - dir * size, a = base + n * halfWidth, b = base - n * halfWidth;
      if (form == "ARROW_OPEN")
        line(a, tip), line(tip, b);
      else if (filled || form.empty() || form == "SYMBOL_INTEGRAL")
        triangle(tip, a, b);
      else
        polyline({tip, a, b}, true);
    }
  }

  // Leaders (§7.5.7.5.1–7): a line, or an arc around Center, from StartPoint (head HeadForm) to
  // EndPoint; double-headed ones have their second head (HeadForm2) at PointConnection; extended
  // ones continue from EndPoint to PointExtension.
  void leader(const LDOM_Element& e)
  {
    const std::string tag = tagOf(e);
    const gp_XY       start = xy(e, "StartPoint"), end = xy(e, "EndPoint");
    const std::vector<double> heights = numbers(e, "HeadHeight");
    const double      size  = heights.empty() ? 0 : heights[0];
    const bool        circular = tag.find("Circular") != std::string::npos, twoHeads = tag.find("DoubleHead") != std::string::npos;
    const gp_XY       center = circular ? xy(e, "Center") : gp_XY();
    const std::optional<gp_XY> extension = optionalXy(e, "PointExtension"), connection = optionalXy(e, "PointConnection");
    // Unit direction d at p, or along the arc's tangent there, whichever way is nearer d.
    auto along = [&](const gp_XY& p, gp_XY d) {
      if (circular)
      {
        const gp_XY r = p - center, t(-r.Y(), r.X());
        d = t.Dot(d) < 0 ? -t : t;
      }
      return d.Modulus() > 0 ? d / d.Modulus() : gp_XY(1, 0);
    };
    std::vector<gp_XY> path = circular ? arc(center, start, end) : std::vector<gp_XY>{start, end};
    if (extension)
      path.push_back(*extension);
    polyline(path, false);
    // The first head points away from EndPoint. A dimension line whose EndPoint is its StartPoint
    // (text at the start, arrows outside) points it at the connection instead; the second head
    // always points against the first (inside or outside arrows alike).
    const bool  atStart = (start - end).Modulus() <= 1e-6 * std::max(size, 1.0);
    const gp_XY first   = along(start, atStart && connection ? *connection - start : start - end);
    head(text(child(e, "HeadForm")), start, first, size);
    if (twoHeads && connection)
    {
      if (!circular) // the dimension line reaches the connection when it lies beyond EndPoint
        line(end, *connection);
      head(text(child(e, "HeadForm2")), *connection, along(*connection, -first), size);
    }
    if (text(child(e, "Modifier")) == "ALL_AROUND") // a circle at the leader's bend
      circle(end, size / 2, false);
  }

  void witnessLines(const LDOM_Element& e)
  {
    for (const char* s : {"Segment1", "Segment2"})
      if (const LDOM_Element seg = child(e, s); !seg.isNull())
        line(xy(seg, "StartPoint"), xy(seg, "EndPoint"));
    if (const std::optional<gp_XY> center = optionalXy(e, "CircleCenter")) // circular (§7.5.7.5.8.2)
      polyline(arc(*center, xy(e, "BeginPoint"), xy(e, "EndPoint")), false);
  }

  void frame(const LDOM_Element& e)
  {
    const std::string tag = tagOf(e);
    if (tag == "FrameRectangular")
    {
      const gp_XY  p = xy(e, "XY");
      const double w = number(e, "Width"), h = number(e, "Height");
      polyline({p, p + gp_XY(w, 0), p + gp_XY(w, h), p + gp_XY(0, h)}, true);
    }
    else if (tag == "FrameCircular")
    {
      const gp_XY  c = xy(e, "XY");
      const double r = number(e, "Radius");
      circle(c, r, false);
      if (flag(e, "crossed"))
        line(c - gp_XY(r, 0), c + gp_XY(r, 0));
    }
    else if (tag == "FrameIrregularForm") // closed only if its last point is its first
      polyline(points2d(e, "Points"), false);
    else if (tag == "FrameTriangle" || tag == "FramePentagonal" || tag == "FrameHexagonal" || tag == "FrameOctagonal")
    {
      std::vector<gp_XY> pts;
      for (const LDOM_Element& p : elements(e))
        if (const std::vector<double> v = parseNumbers(text(p)); tagOf(p) == "Point" && v.size() >= 2)
          pts.emplace_back(v[0], v[1]);
      polyline(pts, true);
    }
  }

  // Graphics (§7.5.7.5.18): polylines, and areas given as triangles.
  void graphics(const LDOM_Element& e)
  {
    for (const LDOM_Element& p : elements(child(e, "Polylines")))
      polyline(points2d(p, "Points"), false);
    for (const LDOM_Element& area : elements(child(e, "Areas")))
    {
      const LDOM_Element        t     = child(area, "Triangulation");
      const std::vector<gp_XY>  verts = points2d(t, "Vertices");
      // Not TrianglesBinary: integers, not the doubles numbers() decodes.
      const std::vector<double> idx   = parseNumbers(text(child(t, "Triangles")));
      const auto                valid = [&](double k) { return k >= 0 && k < double(verts.size()); };
      for (size_t i = 0; i + 2 < idx.size(); i += 3)
        if (valid(idx[i]) && valid(idx[i + 1]) && valid(idx[i + 2]) && idx[i] != idx[i + 1] && idx[i + 1] != idx[i + 2]
            && idx[i] != idx[i + 2])
          triangle(verts[size_t(idx[i])], verts[size_t(idx[i + 1])], verts[size_t(idx[i + 2])]);
    }
  }

  // Texts: each line's baseline starts at XY; lineHeight is the height of capital letters (as the
  // samples' frames fit them) and lines are 1.5 of it apart.
  void texts(const LDOM_Element& e)
  {
    const double h = std::atof(attr(e, "lineHeight").c_str());
    if (!(h > 0))
      return;
    for (const LDOM_Element& t : elements(e))
    {
      const std::vector<std::u32string> lines = textLines(text(child(t, "Data")));
      const gp_XY                       p     = optionalXy(t, "XY").value_or(gp_XY());
      for (size_t i = 0; i < lines.size(); ++i)
        drawText(lines[i], at(p - gp_XY(0, 1.5 * h * double(i))), x, y, h * unit, item.triangles);
    }
  }
};

// ---------------------------------------------------------------------------
// Reader

double unitFactor(const LDOM_Element& unit) // to SI (metre, radian)
{
  const std::vector<double> f = numbers(child(unit, "UnitConversion"), "Factor");
  return f.empty() ? 1.0 : f[0];
}

std::string stepUnit(double mm)
{
  const std::pair<double, const char*> kNames[] = {
    {1, "MILLIMETRE"}, {10, "CENTIMETRE"}, {1000, "METRE"}, {25.4, "INCH"}, {304.8, "FOOT"}};
  for (const auto& [f, name] : kNames)
    if (std::abs(mm - f) <= 1e-6 * f)
      return name;
  return "MILLIMETRE";
}

struct BodyRef
{
  LDOM_Element element;
  bool         hidden;
};

class Reader
{
public:
  Reader(const LDOM_Element& root, const Handle(TDocStd_Document)& doc)
      : myRoot(root),
        myShapes(XCAFDoc_DocumentTool::ShapeTool(doc->Main())),
        myColors(XCAFDoc_DocumentTool::ColorTool(doc->Main()))
  {
    index(root);
    readUnits();
  }

  std::string read(FilePmi& pmi)
  {
    const LDOM_Element product = child(myRoot, "Product");
    if (const int root = ref(product, "RootAssembly"))
      assembly(root);
    else if (const int part = ref(product, "RootPart"))
      this->part(part);
    else if (const auto parts = elements(child(product, "PartSet")); !parts.empty())
      for (const LDOM_Element& p : parts)
        this->part(std::atoi(attr(p, "id").c_str()));
    else
      loosePart();
    myShapes->UpdateAssemblies();
    if (myFinal.empty())
      throw std::runtime_error(myFailedFaces ? "None of the faces in this QIF file could be built"
                                             : "This QIF file has no model geometry (it holds a measurement plan, results or rules)");
    if (myFailedFaces)
      std::cerr << "QIF: " << myFailedFaces << " faces could not be built and are left out\n";
    readPmi(pmi);
    return stepUnit(myMm);
  }

private:
  void index(const LDOM_Element& e)
  {
    for (const LDOM_Element& c : elements(e))
    {
      if (const std::string id = attr(c, "id"); !id.empty())
        myById[std::atoi(id.c_str())] = c;
      index(c);
    }
  }

  LDOM_Element lookup(int id) const
  {
    const auto it = myById.find(id);
    if (it == myById.end())
      throw std::runtime_error("QIF: no element with id " + std::to_string(id));
    return it->second;
  }

  // -------------------------------------------------------------------------
  // Units: the model's length unit, and those PMI values name

  void readUnits()
  {
    const LDOM_Element units = child(myRoot, "FileUnits");
    for (const LDOM_Element& set : {child(units, "PrimaryUnits"), child(units, "OtherUnits")})
      for (const LDOM_Element& u : elements(set))
      {
        const std::string tag = tagOf(u), name = text(child(u, "UnitName"));
        const bool        angular = tag.find("Angular") != std::string::npos;
        if (tag.find("Linear") == std::string::npos && !angular)
          continue;
        (angular ? myAngular : myLinear)[name] = unitFactor(u);
      }
    const LDOM_Element primary = child(units, "PrimaryUnits");
    const LDOM_Element linear = child(primary, "LinearUnit"), pmiLinear = child(primary, "PMILinearUnit");
    const LDOM_Element pmiAngular = child(primary, "PMIAngularUnit"), angular = child(primary, "AngularUnit");
    // Units the file leaves out are SI: metre and radian (§5.18.3).
    myMm         = (linear.isNull() ? 1.0 : unitFactor(linear)) * 1000;
    myPmiMm      = pmiLinear.isNull() ? myMm : unitFactor(pmiLinear) * 1000;
    if (!(myMm > 0) || !(myPmiMm > 0))
      throw std::runtime_error("QIF: a length unit with a conversion factor that is not positive");
    // Distances in the product are written multiplied by its scale coefficient (§5.10.3).
    const std::vector<double> scale = numbers(child(child(myRoot, "Product"), "Header"), "ScaleCoefficient");
    myModelMm = scale.empty() || scale[0] <= 0 ? myMm : myMm / scale[0];
    myPmiDegrees = (!pmiAngular.isNull() ? unitFactor(pmiAngular) : !angular.isNull() ? unitFactor(angular) : 1.0) * 180 / M_PI;
  }

  // A PMI value in mm, or in degrees.
  double measure(const LDOM_Element& e, bool angular) const
  {
    const std::vector<double> v = parseNumbers(text(e));
    if (v.empty())
      return 0;
    const std::string unit = attr(e, angular ? "angularUnit" : "linearUnit");
    const auto&       table = angular ? myAngular : myLinear;
    const auto        it    = table.find(unit);
    const double      f     = it == table.end() ? (angular ? myPmiDegrees : myPmiMm) : it->second * (angular ? 180 / M_PI : 1000);
    return v[0] * f;
  }

  // -------------------------------------------------------------------------
  // Topology

  TopoDS_Vertex vertex(int id)
  {
    if (const auto it = myVertices.find(id); it != myVertices.end())
      return it->second;
    TopoDS_Vertex v;
    myBuilder.MakeVertex(v, xyz(lookup(ref(lookup(id), "Point")), "XYZ"), Precision::Confusion());
    myTopoIds.Bind(v, id);
    return myVertices[id] = v;
  }

  // Edges follow their curve's own direction, from VertexBeg to VertexEnd.
  TopoDS_Edge edge(int id)
  {
    if (const auto it = myEdges.find(id); it != myEdges.end())
      return it->second;
    const LDOM_Element e = lookup(id);
    const Curve        c = curveOf(coreOf(lookup(ref(e, "Curve"))));
    if (!c.affine)
      myInexactEdges.insert(id);
    TopoDS_Edge        edge;
    myBuilder.MakeEdge(edge, c.curve, Precision::Confusion());
    const gp_Pnt ends[2] = {c.curve->Value(c.first), c.curve->Value(c.last)};
    const int    vids[2] = {ref(e, "VertexBeg"), ref(e, "VertexEnd")};
    for (int i = 0; i < 2; ++i)
    {
      TopoDS_Vertex v;
      if (vids[i])
        v = vertex(vids[i]);
      else
        myBuilder.MakeVertex(v, ends[i], Precision::Confusion());
      const double gap = BRep_Tool::Pnt(v).Distance(ends[i]);
      if (gap > BRep_Tool::Tolerance(v))
        myBuilder.UpdateVertex(v, gap * 1.001);
      myBuilder.Add(edge, v.Oriented(i == 0 ? TopAbs_FORWARD : TopAbs_REVERSED));
    }
    myBuilder.Range(edge, c.first, c.last);
    myBuilder.SameParameter(edge, false); // 2D and 3D curves are parameterised independently
    myTopoIds.Bind(edge, id);
    return myEdges[id] = edge;
  }

  // The co-edge's 2D curve in OCCT (u,v), running and parameterised as its edge. Null when it does
  // not lie on the edge (some writers swap or rescale a surface's parameters): ShapeFix then
  // projects the edge instead.
  static Handle(Geom2d_BSplineCurve) pcurve(const Curve& c, const TopoDS_Edge& edge, const Surface& s)
  {
    const Handle(Geom2d_BSplineCurve) pc = mapCurve(c, s.uv);
    double                            f, l;
    const Handle(Geom_Curve)          c3 = BRep_Tool::Curve(edge, f, l);
    const double                      allowed = 0.01 * GCPnts_AbscissaPoint::Length(GeomAdaptor_Curve(c3, f, l));
    for (const double t : {0.0, 0.5, 1.0})
    {
      const gp_Pnt2d              p = pc->Value(pc->FirstParameter() + t * (pc->LastParameter() - pc->FirstParameter()));
      GeomAPI_ProjectPointOnCurve onEdge(s.surface->Value(p.X(), p.Y()), c3, f, l);
      if (onEdge.NbPoints() == 0 || onEdge.LowerDistance() > allowed)
        return nullptr;
    }
    // Whether it runs as the edge: compare points on both, at the ends, or for closed edges inside.
    const bool closed = c3->Value(f).Distance(c3->Value(l)) <= Precision::Confusion() * 10;
    const double a = closed ? 0.25 : 0, b = closed ? 0.75 : 1;
    auto on2d = [&](double t) {
      const gp_Pnt2d p = pc->Value(pc->FirstParameter() + t * (pc->LastParameter() - pc->FirstParameter()));
      return s.surface->Value(p.X(), p.Y());
    };
    auto on3d = [&](double t) { return c3->Value(f + t * (l - f)); };
    const double same = on2d(a).Distance(on3d(a)) + on2d(b).Distance(on3d(b));
    const double flip = on2d(a).Distance(on3d(b)) + on2d(b).Distance(on3d(a));
    if (flip < same)
      pc->Reverse();
    NCollection_Array1<double> knots = pc->Knots();
    BSplCLib::Reparametrize(f, l, knots);
    pc->SetKnots(knots);
    return pc;
  }

  std::optional<TopoDS_Face> face(int id)
  {
    if (const auto it = myFaces.find(id); it != myFaces.end())
      return it->second;
    std::optional<TopoDS_Face> result;
    try
    {
      result = buildFace(lookup(id));
    }
    catch (const std::exception& e) // OCCT's Standard_Failure included
    {
      std::cerr << "QIF face " << id << ": " << e.what() << '\n';
    }
    if (!result)
      ++myFailedFaces;
    return myFaces[id] = result;
  }

  TopoDS_Face buildFace(const LDOM_Element& e)
  {
    const Surface s = surfaceOf(coreOf(lookup(ref(e, "Surface"))));
    TopoDS_Face   face;
    // Without an outer loop the surface's own bounds are the face's (§7.5.3.5 hasOuter).
    const std::vector<int> loops = ids(e, "LoopIds");
    bool                   outer = !(attr(e, "hasOuter") == "false" || attr(e, "hasOuter") == "0") && !loops.empty();
    if (!outer)
    {
      double u0, u1, v0, v1;
      s.surface->Bounds(u0, u1, v0, v1);
      if (Precision::IsInfinite(u0) || Precision::IsInfinite(u1) || Precision::IsInfinite(v0) || Precision::IsInfinite(v1))
        throw std::runtime_error("face on an unbounded surface without an outer loop");
      face = BRepBuilderAPI_MakeFace(s.surface, u0, u1, v0, v1, Precision::Confusion());
    }
    else
      myBuilder.MakeFace(face, s.surface, Precision::Confusion());

    // 2D curves per edge: where the edge runs forward and reversed (both on a seam).
    std::vector<std::pair<TopoDS_Edge, Handle(Geom2d_Curve)>> forward, reversed;
    for (const int loopId : loops)
    {
      TopoDS_Wire wire;
      myBuilder.MakeWire(wire);
      for (const LDOM_Element& co : elements(child(lookup(loopId), "CoEdges")))
      {
        const LDOM_Element oriented = child(co, "EdgeOriented");
        const int          edgeId   = idOf(child(oriented, "Id"));
        const TopoDS_Edge  edge     = this->edge(edgeId);
        const bool         turned   = flag(oriented, "turned");
        myBuilder.Add(wire, edge.Oriented(turned ? TopAbs_REVERSED : TopAbs_FORWARD));
        // An aggregate's pieces (or a hyperbola) cannot be lined up with the other curve by one
        // linear reparameterisation, and same-parameter fails across their corners: projected instead.
        if (const int c12 = ref(co, "Curve12"); c12 && !myInexactEdges.count(edgeId))
          if (const Curve c = curveOf(coreOf(lookup(c12))); c.affine)
            if (const Handle(Geom2d_BSplineCurve) pc = pcurve(c, edge, s); !pc.IsNull())
              (turned ? reversed : forward).emplace_back(edge, pc);
      }
      myBuilder.Add(face, wire);
    }
    // A 2D curve missing here is made by ShapeFix.
    const double tol = Precision::Confusion();
    for (const auto& fwd : forward)
    {
      const auto twin = std::find_if(reversed.begin(), reversed.end(), [&](const auto& r) { return r.first.IsSame(fwd.first); });
      if (twin != reversed.end())
        myBuilder.UpdateEdge(fwd.first, fwd.second, twin->second, face, tol);
      else
        myBuilder.UpdateEdge(fwd.first, fwd.second, face, tol);
    }
    for (const auto& rev : reversed)
      if (std::none_of(forward.begin(), forward.end(), [&](const auto& f) { return f.first.IsSame(rev.first); }))
        myBuilder.UpdateEdge(rev.first, rev.second, face, tol);

    // The face's normal: the surface's in QIF terms, reversed when turned. A (u,v) map that turns
    // the parameter plane over gives OCCT's surface the opposite normal.
    if (flag(e, "turned") != (s.uv.VectorialPart().Determinant() < 0))
      face.Reverse();
    return face;
  }

  // A body (or, for files without bodies, a shell or face) → solid, shells and loose faces; the QIF
  // face ids it holds go in faceIds.
  TopoDS_Shape body(const LDOM_Element& e, std::vector<int>& faceIds)
  {
    const std::string tag = tagOf(e);
    if (tag == "Face")
    {
      const int id = std::atoi(attr(e, "id").c_str());
      faceIds.push_back(id);
      const auto f = face(id);
      return f ? TopoDS_Shape(*f) : TopoDS_Shape();
    }
    std::set<int>             inShells;
    std::vector<TopoDS_Shell> shells;
    bool                      allClosed = true;
    const std::vector<int>    shellIds  = tag == "Shell" ? std::vector<int>{std::atoi(attr(e, "id").c_str())} : ids(e, "ShellIds");
    for (const int sid : shellIds)
    {
      const LDOM_Element s = lookup(sid);
      TopoDS_Shell       shell;
      myBuilder.MakeShell(shell);
      for (const int fid : ids(s, "FaceIds"))
        if (inShells.insert(fid).second)
        {
          faceIds.push_back(fid);
          if (const auto f = face(fid))
            myBuilder.Add(shell, *f);
        }
      allClosed = allClosed && flag(s, "closed");
      if (shell.NbChildren() > 0)
        shells.push_back(shell);
    }
    TopoDS_Compound compound;
    myBuilder.MakeCompound(compound);
    const std::string form = attr(e, "form");
    if (!shells.empty() && (form == "SOLID" || (form.empty() && tag == "Body" && allClosed)))
    {
      TopoDS_Solid solid;
      myBuilder.MakeSolid(solid);
      for (const TopoDS_Shell& s : shells)
        myBuilder.Add(solid, s);
      myBuilder.Add(compound, solid);
    }
    else
      for (const TopoDS_Shell& s : shells)
        myBuilder.Add(compound, s);
    for (const int fid : ids(e, "FaceIds")) // faces outside its shells
      if (!inShells.count(fid))
      {
        faceIds.push_back(fid);
        if (const auto f = face(fid))
          myBuilder.Add(compound, *f);
      }
    if (compound.NbChildren() == 0)
      return {};
    return compound.NbChildren() == 1 ? TopoDS_Iterator(compound).Value() : TopoDS_Shape(compound);
  }

  // Fixes a built body (same parameter, tolerances, orientation) and scales it to mm; records where
  // its faces, edges and vertices ended up. The QIF ids of its edges and vertices go in topoIds.
  TopoDS_Shape finish(const TopoDS_Shape& built, const std::vector<int>& faceIds, std::vector<int>& topoIds)
  {
    ShapeFix_Shape fix(built);
    fix.Perform();
    TopoDS_Shape                    shape = fix.Shape();
    std::optional<BRepBuilderAPI_Transform> scale;
    if (std::abs(myModelMm - 1) > 1e-12)
    {
      gp_Trsf t;
      t.SetScaleFactor(myModelMm);
      scale.emplace(shape, t, true);
      shape = scale->Shape();
    }
    TopTools_IndexedMapOfShape fixedShapes;
    TopExp::MapShapes(fix.Shape(), fixedShapes);
    const auto record = [&](int id, const TopoDS_Shape& original) {
      // ShapeFix may replace a shape more than once, or drop it.
      for (TopExp_Explorer ex(fix.Context()->ValueLeaf(original), original.ShapeType()); ex.More(); ex.Next())
        if (fixedShapes.Contains(ex.Current()))
          myFinal[id].push_back(scale ? scale->ModifiedShape(ex.Current()) : ex.Current());
    };
    for (const int id : faceIds)
      if (const auto f = myFaces.find(id); f != myFaces.end() && f->second)
        record(id, *f->second);
    TopTools_IndexedMapOfShape builtShapes;
    TopExp::MapShapes(built, builtShapes);
    for (int i = 1; i <= builtShapes.Extent(); ++i)
      if (const int* id = myTopoIds.Seek(builtShapes(i)))
      {
        topoIds.push_back(*id);
        record(*id, builtShapes(i));
      }
    return shape;
  }

  // -------------------------------------------------------------------------
  // Product structure

  TDF_Label makePart(const std::vector<BodyRef>& bodies, const std::string& name)
  {
    TopoDS_Compound compound;
    myBuilder.MakeCompound(compound);
    struct Built
    {
      TopoDS_Shape     shape;
      LDOM_Element     element;
      bool             hidden;
      std::vector<int> faceIds, topoIds; // QIF faces; edges and vertices
    };
    std::vector<Built> built;
    for (const BodyRef& b : bodies)
    {
      std::vector<int>   faceIds, topoIds;
      const TopoDS_Shape raw = body(b.element, faceIds);
      if (raw.IsNull())
        continue;
      const TopoDS_Shape shape = finish(raw, faceIds, topoIds);
      built.push_back({shape, b.element, b.hidden || flag(b.element, "hidden"), faceIds, topoIds});
      myBuilder.Add(compound, built.back().shape);
    }
    if (built.empty())
      return {};
    const TDF_Label part = myShapes->AddShape(compound, false);
    if (!name.empty())
      TDataStd_Name::Set(part, TCollection_ExtendedString(name.c_str(), true));
    for (const Built& b : built)
    {
      const std::optional<Quantity_Color> color = colorOf(b.element);
      if (color || b.hidden)
        if (const TDF_Label sub = myShapes->AddSubShape(part, b.shape); !sub.IsNull())
        {
          if (color)
            myColors->SetColor(sub, *color, XCAFDoc_ColorSurf);
          if (b.hidden)
            myColors->SetVisibility(sub, false);
        }
      for (const int id : b.topoIds)
        if (myFinal.count(id)) // not dropped by ShapeFix
          myPartOf[id] = part;
      for (const int id : b.faceIds)
      {
        if (!myFinal.count(id)) // not built (logged in face)
          continue;
        myPartOf[id]                        = part;
        const std::optional<Quantity_Color> fc = colorOf(lookup(id));
        if (!fc)
          continue;
        for (const TopoDS_Shape& f : myFinal[id])
          if (const TDF_Label sub = myShapes->AddSubShape(part, f); !sub.IsNull())
            myColors->SetColor(sub, *fc, XCAFDoc_ColorSurf);
      }
    }
    return part;
  }

  static std::string nameOf(const LDOM_Element& e)
  {
    for (const char* field : {"Name", "ModelNumber"})
      if (const std::string n = text(child(e, field)); !n.empty())
        return n;
    return attr(e, "label");
  }

  // A part's bodies: listed directly, or in folders (which may be hidden, as auxiliary geometry is).
  TDF_Label part(int id)
  {
    if (const auto it = myParts.find(id); it != myParts.end())
      return it->second;
    const LDOM_Element   p = lookup(id);
    std::vector<BodyRef> bodies;
    for (const int b : ids(p, "BodyIds"))
      bodies.push_back({lookup(b), false});
    for (const LDOM_Element& folder : elements(child(p, "FoldersPart")))
      for (const int b : ids(folder, "BodyIds"))
        bodies.push_back({lookup(b), flag(folder, "hidden")});
    return myParts[id] = makePart(bodies, nameOf(p));
  }

  // No parts: one part of all bodies, else all shells, else all faces.
  void loosePart()
  {
    for (const char* tag : {"Body", "Shell", "Face"})
    {
      std::vector<BodyRef> all;
      for (const auto& [id, e] : myById)
        if (tagOf(e) == tag)
          all.push_back({e, false});
      if (!all.empty())
      {
        makePart(all, "");
        return;
      }
    }
  }

  TopLoc_Location location(int transformId)
  {
    if (!transformId)
      return {};
    const LDOM_Element t = lookup(transformId);
    gp_Trsf            trsf;
    if (const LDOM_Element r = child(t, "Rotation"); !r.isNull())
    {
      const gp_XYZ x = xyz(r, "XDirection"), y = xyz(r, "YDirection"), z = xyz(r, "ZDirection");
      // A rotation: unit axes, right-handed. Anything else would scale or mirror the component.
      if (std::abs(x.Crossed(y).Dot(z) - 1) > 1e-6)
        throw std::runtime_error("QIF: transform " + std::to_string(transformId) + " is not a rotation");
      trsf.SetValues(x.X(), y.X(), z.X(), 0, x.Y(), y.Y(), z.Y(), 0, x.Z(), y.Z(), z.Z(), 0);
    }
    if (!numbers(t, "Origin").empty())
      trsf.SetTranslationPart(xyz(t, "Origin") * myMm); // outside the product: not scaled (§5.10.3)
    return TopLoc_Location(trsf);
  }

  TDF_Label assembly(int id)
  {
    if (const auto it = myAssemblies.find(id); it != myAssemblies.end())
      return it->second;
    const LDOM_Element a    = lookup(id);
    const TDF_Label    assy = myShapes->NewShape();
    myAssemblies[id]        = assy;
    if (const std::string n = nameOf(a); !n.empty())
      TDataStd_Name::Set(assy, TCollection_ExtendedString(n.c_str(), true));
    for (const int cid : ids(a, "ComponentIds"))
    {
      const LDOM_Element c   = lookup(cid);
      const int          pid = ref(c, "Part"), aid = ref(c, "Assembly");
      const TDF_Label    def = pid ? part(pid) : aid ? assembly(aid) : TDF_Label();
      if (def.IsNull())
        continue;
      const TDF_Label comp = myShapes->AddComponent(assy, def, location(ref(c, "Transform")));
      if (const std::string n = nameOf(c); !n.empty())
        TDataStd_Name::Set(comp, TCollection_ExtendedString(n.c_str(), true));
      if (flag(c, "hidden"))
        myColors->SetVisibility(comp, false);
    }
    return assy;
  }

  // -------------------------------------------------------------------------
  // PMI

  // Faces, edges and vertices referenced through feature nominals (or directly), as built.
  void addShapes(const std::vector<int>& refs, FilePmiItem& item, int depth = 0)
  {
    for (const int id : refs)
    {
      const auto it = myById.find(id);
      if (it == myById.end())
        continue;
      const std::string tag = tagOf(it->second);
      if (tag == "Face" || tag == "Edge" || tag == "Vertex")
      {
        if (item.part.IsNull() && myPartOf.count(id))
          item.part = myPartOf[id];
        if (myPartOf.count(id) && myPartOf[id] == item.part)
          for (const TopoDS_Shape& s : myFinal[id])
            item.shapes.push_back(s);
      }
      else if (depth < 2) // a feature nominal: its entities, or the features it is made of
      {
        addShapes(ids(it->second, "EntityInternalIds"), item, depth + 1);
        addShapes(ids(it->second, "FeatureNominalIds"), item, depth + 1);
      }
    }
  }

  // A frame compartment: one datum, or the datums of a compound (common) datum A-B, nested ones
  // flattened, each with its modifiers (IntermediatesPMI.xsd DatumType), named as for STEP.
  std::vector<DatumRef> frameCompartment(const LDOM_Element& datum, const std::map<int, std::string>& labels) const
  {
    std::vector<DatumRef> out;
    addDatums(datum, labels, {}, out);
    return out;
  }

  // The datums of the SimpleDatum or CompoundDatum in e (a DatumWithPrecedence or SequencedDatum),
  // a compound's in its sequence; inherited: the modifiers of the compounds around them.
  void addDatums(const LDOM_Element&               e,
                 const std::map<int, std::string>& labels,
                 const std::vector<std::string>&   inherited,
                 std::vector<DatumRef>&            out) const
  {
    if (const LDOM_Element simple = child(e, "SimpleDatum"); !simple.isNull())
    {
      // A definition without a label keeps its place in the frame too
      const int  id = idOf(child(simple, "DatumDefinitionId"));
      const auto it = labels.find(id);
      const bool ok = it != labels.end() && !it->second.empty();
      out.push_back(datumRef(ok ? it->second : "datum " + std::to_string(id), simple, inherited));
      return;
    }
    // A datum feature without a datum label (DMIS): named by its feature, so the frame keeps its
    // compartments in place. The measured one may have a material modifier.
    for (const char* tag : {"NominalDatumFeature", "MeasuredDatumFeature"})
      if (const LDOM_Element feature = child(e, tag); !feature.isNull())
      {
        const int   id   = idOf(child(feature, "FeatureNominalId"));
        std::string name = myById.count(id) ? token(child(lookup(id), "Name")) : std::string();
        out.push_back(datumRef(name.empty() ? "feature " + std::to_string(id) : name, feature, inherited));
        return;
      }
    const LDOM_Element compound = child(e, "CompoundDatum");
    std::vector<std::string> modifiers = inherited;
    if (const std::string reduced = datumEnum(token(child(compound, "ReducedDatum")));
        !reduced.empty() && std::find(modifiers.begin(), modifiers.end(), reduced) == modifiers.end())
      modifiers.push_back(reduced);
    std::vector<std::pair<int, LDOM_Element>> members;
    for (const LDOM_Element& m : elements(compound))
      if (tagOf(m) == "Datum")
        members.emplace_back(std::atoi(token(child(m, "SequenceNumber")).c_str()), m);
    std::stable_sort(members.begin(), members.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    for (const auto& [sequence, m] : members)
      addDatums(m, labels, modifiers, out);
  }

  // The schema's codes of the datum enumerations (PD, ACS, PT, ...) mapped to the STEP modifier
  // names; others as written
  static std::string datumEnum(const std::string& v)
  {
    static const std::map<std::string, std::string> kNames = {
      {"ACS", "anyCrossSection"}, {"ALS", "anyLongitudinalSection"}, {"SCS", "specificCrossSection"},
      {"PD", "pitchDiameter"}, {"MD", "majorDiameter"}, {"LD", "minorDiameter"},
      {"PT", "point"}, {"SL", "line"}, {"PL", "plane"}};
    const auto it = kNames.find(v);
    return it == kNames.end() ? v : it->second;
  }

  DatumRef datumRef(const std::string& name, const LDOM_Element& simple, const std::vector<std::string>& inherited) const
  {
    DatumRef d{name};
    const std::string material = token(child(simple, "MaterialModifier"));
    if (material == "MAXIMUM" || material == "MAXIMUM_RPR")
      d.modifiers.push_back("maximumMaterial");
    else if (material == "LEAST" || material == "LEAST_RPR")
      d.modifiers.push_back("leastMaterial");
    if (material == "MAXIMUM_RPR" || material == "LEAST_RPR")
      d.modifiers.push_back("reciprocity");
    const auto isTrue = [&](const LDOM_Element& e) {
      const std::string v = token(e);
      return v == "true" || v == "1";
    };
    // [BASIC], or a size: datum feature simulator (ASME) or projected datum (ISO)
    const LDOM_Element simulator = child(simple, "DatumFeatureSimulatorModifier");
    if (!child(simulator, "BasicSize").isNull())
      d.modifiers.push_back("basic");
    for (const auto& [tag, type] : {std::pair{"LinearSize", "distance"}, {"DiametricalSize", "diameter"}})
      if (const LDOM_Element size = child(simulator, tag); !size.isNull())
      {
        d.sizeType = type;
        d.size     = measure(size, false);
      }
    if (const LDOM_Element projected = child(simple, "ProjectedDatum"); !projected.isNull())
      d.projected = measure(projected, false);
    if (isTrue(child(child(simple, "DatumTranslation"), "DatumTranslationAllowed")))
      d.modifiers.push_back("translation");
    for (const char* tag : {"DiameterModifier", "SectionModifier", "ReducedDatum"})
      if (const std::string v = token(child(simple, tag)); !v.empty())
        d.modifiers.push_back(datumEnum(v));
    static const std::pair<const char*, const char*> kFlags[] = {
      {"ContactingFeature", "contactingFeature"}, {"DistanceVariable", "distanceVariable"},
      {"DatumFixed", "datumFixed"}, {"ConstrainOrientation", "orientation"},
      {"ConstrainSubsequent", "constrainSubsequent"}};
    for (const auto& [tag, flag] : kFlags)
      if (isTrue(child(simple, tag)))
        d.modifiers.push_back(flag);
    // ASME U V W X Y Z, ISO Rx Ry Rz Tx Ty Tz
    for (const LDOM_Element& dof : elements(child(simple, "DegreesOfFreedom")))
      if (const std::string v = token(dof); !v.empty())
        d.modifiers.push_back("dof" + v);
    // The compounds' modifiers after the datum's own, once
    for (const std::string& m : inherited)
      if (std::find(d.modifiers.begin(), d.modifiers.end(), m) == d.modifiers.end())
        d.modifiers.push_back(m);
    return d;
  }

  void readPmi(FilePmi& pmi)
  {
    std::map<int, int> itemOf; // QIF id → index into pmi.items
    auto               add = [&](int id, FilePmiItem item) {
      if (item.part.IsNull() && myParts.size() == 1)
        item.part = myParts.begin()->second;
      itemOf[id] = int(pmi.items.size());
      pmi.items.push_back(std::move(item));
    };

    std::map<int, std::string> datumLabels;
    for (const LDOM_Element& d : elements(child(myRoot, "DatumDefinitions")))
    {
      const int   id    = std::atoi(attr(d, "id").c_str());
      FilePmiItem item;
      datumLabels[id] = token(child(d, "DatumLabel"));
      item.kind       = "datum";
      item.type       = "Datum " + datumLabels[id];
      addShapes(ids(d, "FeatureNominalIds"), item);
      add(id, std::move(item));
    }

    const LDOM_Element characteristics = child(myRoot, "Characteristics");
    for (const LDOM_Element& n : elements(child(characteristics, "CharacteristicNominals")))
    {
      static const std::string kSuffix = "CharacteristicNominal";
      const std::string        tag     = tagOf(n);
      if (tag.size() <= kSuffix.size() || tag.compare(tag.size() - kSuffix.size(), kSuffix.size(), kSuffix) != 0)
        continue;
      const std::string  base = tag.substr(0, tag.size() - kSuffix.size());
      const LDOM_Element def  = myById.count(idOf(child(n, "CharacteristicDefinitionId"))) ? lookup(idOf(child(n, "CharacteristicDefinitionId"))) : LDOM_Element();
      FilePmiItem        item;
      static const std::map<std::string, std::string> kTypes = {
        {"SurfaceProfile", "Profile of a surface"}, {"LineProfile", "Profile of a line"}, {"PointProfile", "Profile of a point"}};
      item.type = kTypes.count(base) ? kTypes.at(base) : words(base);
      item.name = text(child(n, "Name"));
      if (const LDOM_Element tol = child(def, "ToleranceValue"); !tol.isNull())
      {
        item.kind  = "tolerance";
        item.value = {measure(tol, false)};
        if (const int frame = idOf(child(def, "DatumReferenceFrameId")); myById.count(frame))
        {
          // In precedence order, not document order; other precedences after these, as listed
          static const std::vector<std::string> kOrder = {"PRIMARY", "SECONDARY", "TERTIARY", "QUATERNARY", "QUINARY", "SENARY"};
          std::vector<std::pair<size_t, std::vector<DatumRef>>> ranked;
          for (const LDOM_Element& d : elements(child(lookup(frame), "Datums")))
            if (std::vector<DatumRef> compartment = frameCompartment(d, datumLabels); !compartment.empty())
              ranked.emplace_back(std::find(kOrder.begin(), kOrder.end(), token(child(child(d, "Precedence"), "PrecedenceEnum")))
                                    - kOrder.begin(),
                                  std::move(compartment));
          std::stable_sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
          for (auto& [rank, compartment] : ranked)
            item.datums.push_back(std::move(compartment));
        }
      }
      else
      {
        item.kind    = "dimension";
        item.angular = base.rfind("Angle", 0) == 0 || base.rfind("Angular", 0) == 0;
        if (const LDOM_Element target = child(n, "TargetValue"); !target.isNull())
          item.value = {measure(target, item.angular)};
        // Limits, or deviations from the nominal; one of the two alone bounds one side only (R5 MAX).
        const LDOM_Element limits  = child(def, "Tolerance");
        const LDOM_Element lo      = child(limits, "MinValue"), hi = child(limits, "MaxValue");
        const std::string  asLimit = text(child(limits, "DefinedAsLimit"));
        const bool         limit   = asLimit == "true" || asLimit == "1";
        if (!lo.isNull() && !hi.isNull())
        {
          const std::vector<double> values = {measure(lo, item.angular), measure(hi, item.angular)};
          if (limit)
            item.range = values, item.value.clear();
          else
            item.plusMinus = values;
        }
        else if (!lo.isNull() || !hi.isNull())
        {
          const double v = measure(hi.isNull() ? lo : hi, item.angular);
          if (limit || !item.value.empty())
          {
            item.value = {limit ? v : item.value[0] + v};
            item.bound = hi.isNull() ? "min" : "max";
          }
        }
      }
      addShapes(ids(n, "FeatureNominalIds"), item);
      add(std::atoi(attr(n, "id").c_str()), std::move(item));
    }

    for (const LDOM_Element& note : elements(child(child(myRoot, "Product"), "NoteSet")))
    {
      FilePmiItem item;
      item.kind = "note";
      item.type = "Note";
      item.name = text(child(note, "Text"));
      if (item.name.empty())
        item.name = attr(note, "label");
      addShapes(ids(note, "EntityInternalIds"), item);
      add(std::atoi(attr(note, "id").c_str()), std::move(item));
    }

    for (const LDOM_Element& target : elements(child(myRoot, "DatumTargetDefinitions")))
    {
      FilePmiItem item;
      item.kind = "datum";
      item.type = "Datum target " + text(child(target, "DatumTargetLabel"));
      addShapes({idOf(child(target, "FeatureNominalId"))}, item);
      add(std::atoi(attr(target, "id").c_str()), std::move(item));
    }

    const std::map<int, gp_Dir> normals = readDisplays(itemOf, pmi);

    // Saved views: the camera's orientation turns the model into the view plane, so the inverse
    // turns the view's -z (the viewing direction: an identity camera looks down, as in the NIST
    // ftc_08 Top view) and +y (up) into the model. Cameras of the same exporter also look along +z
    // (NIST ctc_01, ftc_09, against their STEP views), with nothing in the file to tell; a saved view
    // shows its annotations from the front, so it is turned round when most of them face away.
    for (const LDOM_Element& v : elements(child(child(child(myRoot, "Product"), "ViewSet"), "SavedViewSet")))
    {
      // A view without a usable camera has no direction to show it from: left out.
      const std::vector<int> cams = ids(v, "CameraIds");
      if (cams.empty() || !myById.count(cams[0]))
        continue;
      const std::vector<double> q = numbers(child(lookup(cams[0]), "Orientation"), "Value");
      if (q.size() != 4 || std::sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) < 1e-9)
        continue;
      gp_Quaternion rot(-q[1], -q[2], -q[3], q[0]); // inverse; QIF writes the scalar part first
      rot.Normalize();
      FilePmiView view;
      view.name      = attr(v, "label");
      view.direction = gp_Dir(rot.Multiply(gp_Vec(0, 0, -1)));
      view.up        = gp_Dir(rot.Multiply(gp_Vec(0, 1, 0)));
      int facingAway = 0; // annotations seen from behind, less those seen from the front
      for (const int id : ids(v, "AnnotationVisibleIds"))
        if (const auto it = itemOf.find(id); it != itemOf.end())
        {
          view.pmi.push_back(it->second);
          if (const auto n = normals.find(it->second); n != normals.end())
            facingAway += n->second.Dot(view.direction) > 0 ? 1 : -1;
        }
      if (facingAway > 0)
        view.direction.Reverse();
      pmi.views.push_back(std::move(view));
    }
  }

  // Drawn PMI: each PMIDisplay draws the item it references, in a plane at its Origin whose normal
  // and text direction are its annotation view's (§7.5.7.4); its own Direction overrides the latter.
  // Returns each drawn item's plane normal (the side its text reads from).
  std::map<int, gp_Dir> readDisplays(const std::map<int, int>& itemOf, FilePmi& pmi)
  {
    std::map<int, gp_Dir> normals;
    const LDOM_Element visualization = child(child(myRoot, "Product"), "VisualizationSet");
    for (const LDOM_Element& d : elements(child(visualization, "PMIDisplaySet")))
    {
      const LDOM_Element plane = child(d, "Plane");
      const auto         it    = itemOf.find(ref(d, "Reference"));
      const auto         view  = myById.find(ref(plane, "AnnotationViewId"));
      if (it == itemOf.end() || view == myById.end())
        continue;
      // A bad element is left out, not the rest of the display.
      const auto log = [&](const std::exception& e) {
        std::cerr << "QIF PMI display of " << ref(d, "Reference") << ": " << e.what() << '\n';
      };
      try
      {
        const gp_Dir normal = dir(view->second, "Normal");
        const gp_Dir along  = dir(numbers(plane, "Direction").empty() ? view->second : plane, "Direction");
        const gp_Dir y      = normal.Crossed(along); // fails if along is the normal
        const gp_XYZ origin = xyz(plane, numbers(plane, "Origin").empty() ? "Point" : "Origin");
        Sketch       s{gp_Pnt(origin * myModelMm), y.Crossed(normal), y, myModelMm, pmi.items[size_t(it->second)]};
        normals[it->second] = normal;
        for (const LDOM_Element& e : elements(d))
          try
          {
            const std::string tag = tagOf(e);
            if (tag.rfind("Leader", 0) == 0)
              s.leader(e);
            else if (tag == "WitnessLines")
              s.witnessLines(e);
            else if (tag == "Frames")
              for (const LDOM_Element& f : elements(e))
                s.frame(f);
            else if (tag == "Graphics")
              s.graphics(e);
            else if (tag == "Texts")
              s.texts(e);
          }
          catch (const std::exception& ex) // OCCT's Standard_Failure included
          {
            log(ex);
          }
      }
      catch (const std::exception& e) // the plane
      {
        log(e);
      }
    }
    return normals;
  }

  LDOM_Element                                       myRoot;
  Handle(XCAFDoc_ShapeTool)                          myShapes;
  Handle(XCAFDoc_ColorTool)                          myColors;
  BRep_Builder                                       myBuilder;
  std::unordered_map<int, LDOM_Element>              myById;
  std::map<std::string, double>                      myLinear, myAngular; // unit name → metres / radians
  double                                             myMm = 1, myPmiMm = 1, myPmiDegrees = 1;
  double                                             myModelMm = 1; // product geometry: myMm / ScaleCoefficient (not transforms)
  std::unordered_map<int, TopoDS_Vertex>             myVertices;
  std::unordered_map<int, TopoDS_Edge>               myEdges;
  std::set<int>                                      myInexactEdges; // curve parameter not affine to QIF's
  std::unordered_map<int, std::optional<TopoDS_Face>> myFaces;
  int                                                myFailedFaces = 0;
  NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> myTopoIds; // built edge or vertex → QIF id
  std::map<int, std::vector<TopoDS_Shape>>           myFinal; // QIF face, edge or vertex id → shapes in the model
  std::map<int, TDF_Label>                           myPartOf;
  std::map<int, TDF_Label>                           myParts, myAssemblies;
};

} // namespace

std::string readQif(const std::string& bytes, const Handle(TDocStd_Document)& doc, FilePmi& pmi)
{
  LDOMParser         parser;
  std::istringstream stream(bytes);
  if (parser.parse(stream))
  {
    TCollection_AsciiString data;
    throw std::runtime_error(std::string("Not a readable QIF file: ") + parser.GetError(data).ToCString());
  }
  const LDOM_Element root = parser.getDocument().getDocumentElement();
  if (tagOf(root) != "QIFDocument")
    throw std::runtime_error("Not a QIF file");
  return Reader(root, doc).read(pmi);
}
