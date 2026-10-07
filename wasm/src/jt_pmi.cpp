// JT PMI Manager data. JT 10 managers follow ISO 14306-4 §9.3; JT 8 and 9 managers follow
// ISO 14306-3 (TKJT's layout), of which only the model views are used: their annotations are not
// drawn.
//
// NX-written JT 10.5 data deviates from ISO 14306-4 in three places:
// - a PMI property atom's hidden flag is a U8, not a U32;
// - text polyline data always ends with its vertex vector, even when it has no indices;
// - the compressed CAD tag data length counts its own length field.
//
// Generic PMI entities hold their lines and filled areas (arrowheads) as 3D coordinates. Their
// text is one record per character: the string is a one-character code into a font's character
// set, whose polygon data is the glyph (2D triangle strips), placed at the text box origin in the
// entity's 2D reference frame.

#include "jt_pmi.h"

#include <gp_Ax1.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <map>
#include <stdexcept>

namespace
{

// Generic PMI entity types (ISO 14306-4 Table 55).
enum : uint16_t
{
  kGdt                 = 0x0080,
  kFeatureControlFrame = 0x0081,
  kDimension           = 0x0082,
  kDatumFeatureSymbol  = 0x0084,
  kDatumTarget         = 0x0088,
  kDatumPoint          = 0x0120,
  kCompositeFcf        = 0x0308,
  kCalloutDimension    = 0x030D,
  kChamferDimension    = 0x030F,
};

// Association entity types and reason codes (ISO 14306-4 Tables 51 and 52).
constexpr int kModelViewEntity  = 17;
constexpr int kGenericEntity    = 18;
constexpr int kReasonIncluded   = 10; // entity "included in" a PMI symbol; NX uses it for model views
constexpr int kReasonShowInView = 98;

std::string utf8(const std::u16string& s)
{
  std::string out;
  for (size_t i = 0; i < s.size(); ++i)
  {
    uint32_t c = s[i];
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.size())
      c = 0x10000 + ((c - 0xD800) << 10) + (s[++i] - 0xDC00);
    if (c < 0x80)
      out += char(c);
    else if (c < 0x800)
      out += {char(0xC0 | c >> 6), char(0x80 | (c & 0x3F))};
    else if (c < 0x10000)
      out += {char(0xE0 | c >> 12), char(0x80 | (c >> 6 & 0x3F)), char(0x80 | (c & 0x3F))};
    else
      out += {char(0xF0 | c >> 18), char(0x80 | (c >> 12 & 0x3F)), char(0x80 | (c >> 6 & 0x3F)), char(0x80 | (c & 0x3F))};
  }
  return out;
}

class Reader
{
public:
  Reader(const uint8_t* data, size_t size, bool bigEndian) : myData(data), mySize(size), mySwap(bigEndian) {}

  template <typename T>
  T get()
  {
    need(sizeof(T));
    uint8_t b[sizeof(T)];
    std::memcpy(b, myData + myPos, sizeof(T));
    if (mySwap)
      std::reverse(b, b + sizeof(T));
    myPos += sizeof(T);
    T v;
    std::memcpy(&v, b, sizeof(T));
    return v;
  }
  uint8_t  u8() { return get<uint8_t>(); }
  int16_t  i16() { return get<int16_t>(); }
  uint16_t u16() { return get<uint16_t>(); }
  int32_t  i32() { return get<int32_t>(); }
  uint32_t u32() { return get<uint32_t>(); }
  float    f32() { return get<float>(); }

  // An element count; every element takes at least one byte.
  int32_t count()
  {
    const int32_t n = i32();
    if (n < 0 || size_t(n) > mySize - myPos)
      throw std::runtime_error("JT PMI: bad count");
    return n;
  }

  template <typename T>
  std::vector<T> vec(int32_t n)
  {
    std::vector<T> v(static_cast<size_t>(n));
    for (T& x : v)
      x = get<T>();
    return v;
  }
  template <typename T>
  std::vector<T> vec()
  {
    return vec<T>(count());
  }

  void skip(size_t n)
  {
    need(n);
    myPos += n;
  }

  std::u16string mbString() // UTF-16
  {
    std::u16string s;
    for (int32_t n = count(); n > 0; --n)
      s += char16_t(u16());
    return s;
  }

  std::string string8() // JT 8 and 9 string table entries
  {
    const size_t n = size_t(count());
    std::string  s(reinterpret_cast<const char*>(myData + myPos), n);
    myPos += n;
    return s;
  }

private:
  void need(size_t n) const
  {
    if (n > mySize - myPos)
      throw std::runtime_error("JT PMI: unexpected end of data");
  }

  const uint8_t* myData;
  size_t         mySize;
  size_t         myPos = 0;
  bool           mySwap;
};

// ---------------------------------------------------------------------------
// Model views (both layouts)

struct RawView
{
  gp_XYZ  eye; // direction the camera looks
  float   angle = 0;
  int32_t nameId = -1;
};

RawView readView(Reader& r)
{
  const auto f = r.vec<float>(15); // eye direction, angle, eye position, target, view angles, diameter, empty
  r.i32();                         // empty
  r.i32();                         // active flag
  r.i32();                         // view ID
  return {gp_XYZ(f[0], f[1], f[2]), f[3], r.i32()};
}

// Up: +Y projected onto the view plane (eye × X when looking along Y), turned by -angle about the
// eye direction. Checked on NX's standard views (Top: +Y up; Front, Right, Back, Left: +Z up).
gp_Dir upOf(const gp_Dir& eye, double angleDeg)
{
  gp_Vec up = gp_Vec(0, 1, 0) - gp_Vec(eye) * eye.Y();
  if (up.Magnitude() < 1e-6)
    up = gp_Vec(eye) ^ gp_Vec(1, 0, 0);
  up.Rotate(gp_Ax1(gp::Origin(), eye), -angleDeg * M_PI / 180.0);
  return gp_Dir(up);
}

// View names are quoted and may end in NULs: "Top"\0.
std::string viewName(std::string s)
{
  while (!s.empty() && s.back() == '\0')
    s.pop_back();
  if (s.size() >= 2 && s.front() == '"' && s.back() == '"')
    s = s.substr(1, s.size() - 2);
  return s;
}

// Views with a direction; returns, per raw view, its index in out.views (or -1).
std::vector<int> addViews(const std::vector<RawView>& raw, const std::vector<std::string>& strings, JtPmi& out)
{
  std::vector<int> index;
  for (const RawView& v : raw)
  {
    if (v.eye.Modulus() < 1e-6)
    {
      index.push_back(-1);
      continue;
    }
    JtPmiView view;
    view.name      = viewName(v.nameId >= 0 && size_t(v.nameId) < strings.size() ? strings[size_t(v.nameId)] : "");
    view.direction = gp_Dir(v.eye);
    view.up        = upOf(view.direction, v.angle);
    index.push_back(int(out.views.size()));
    out.views.push_back(std::move(view));
  }
  return index;
}

// ---------------------------------------------------------------------------
// JT 10

struct Polygons // one PMI Polygon Data element (ISO 14306-4 Fig. 122)
{
  int                  dim = 0; // 0: empty element
  std::vector<int32_t> primIndices, vertIndices;
  std::vector<float>   vertices;
};

struct Text
{
  std::u16string       chars;
  float                x = 0, y = 0; // text box origin
  std::vector<int16_t> lineIndices;
  std::vector<float>   lineVertices; // 2D
};

struct Frame
{
  gp_XYZ origin, x, y;
  gp_XYZ at(double u, double v) const { return origin + x * u + y * v; }
};

struct Entity
{
  bool                               hasFrame = false;
  Frame                              frame;
  std::vector<Text>                  texts;
  std::vector<int32_t>               lineIndices;
  std::vector<float>                 lineVertices; // 3D
  std::map<std::string, std::string> props;
  std::string                        typeName;
  uint16_t                           type = 0;
};

struct Font
{
  std::vector<uint16_t> chars;
  std::vector<Polygons> glyphs; // one per character
};

std::map<std::string, std::string> readProperties(Reader& r)
{
  std::map<std::string, std::string> props;
  for (int32_t n = r.count(); n > 0; --n)
  {
    std::string key = utf8(r.mbString());
    r.u8(); // hidden flag
    std::string value = utf8(r.mbString());
    r.u8();
    props.emplace(std::move(key), std::move(value));
  }
  return props;
}

std::vector<Polygons> readPolygonData(Reader& r)
{
  r.u8(); // version
  const int32_t n        = r.count();
  const auto    numVerts = r.vec<int32_t>();
  const auto    bindings = r.vec<int32_t>(); // colour, normal, texture per non-empty element
  const auto    dims     = r.vec<int32_t>();
  if (numVerts.size() != size_t(n))
    throw std::runtime_error("JT PMI: bad polygon data");
  std::vector<Polygons> out(static_cast<size_t>(n));
  size_t                e = 0; // index among the non-empty elements
  for (size_t i = 0; i < out.size(); ++i)
  {
    if (!numVerts[i])
      continue;
    if (bindings.size() < 3 * (e + 1) || dims.size() <= e || dims[e] < 2)
      throw std::runtime_error("JT PMI: bad polygon data");
    Polygons& p = out[i];
    p.dim       = dims[e];
    r.vec<int32_t>(); // primitive types: only triangle strips seen
    p.primIndices = r.vec<int32_t>();
    p.vertIndices = r.vec<int32_t>();
    p.vertices    = r.vec<float>();
    for (int b : {1, 0, 2}) // normals, colours, texture coordinates
      if (bindings[3 * e + size_t(b)])
        r.vec<float>();
    ++e;
  }
  return out;
}

Entity readGenericEntity(Reader& r, const std::vector<std::u16string>& strings)
{
  auto   str = [&](int32_t id) { return id >= 0 && size_t(id) < strings.size() ? strings[size_t(id)] : u""; };
  Entity e;
  r.i32(); // user label
  e.hasFrame = r.u8() != 0;
  if (e.hasFrame)
  {
    const auto   f = r.vec<float>(9);
    const gp_XYZ o(f[0], f[1], f[2]);
    e.frame = {o, gp_XYZ(f[3], f[4], f[5]) - o, gp_XYZ(f[6], f[7], f[8]) - o};
  }
  r.f32(); // text height
  r.u8();  // valid flag
  for (int32_t n = r.count(); n > 0; --n)
  {
    Text t;
    t.chars = str(r.i32());
    r.skip(4 + 4 + 4); // font, empty, empty
    const auto box = r.vec<float>(6);
    t.x            = box[0];
    t.y            = box[1];
    t.lineIndices  = r.vec<int16_t>();
    t.lineVertices = r.vec<float>();
    e.texts.push_back(std::move(t));
  }
  e.lineIndices = r.vec<int32_t>();
  r.vec<int16_t>(); // polyline types
  r.vec<int16_t>(); // polyline widths
  e.lineVertices = r.vec<float>();
  e.props        = readProperties(r);
  e.typeName     = utf8(str(r.i32()));
  r.i32(); // parent type name
  e.type = r.u16();
  r.u16(); // parent type
  r.u16(); // user flags
  return e;
}

// Triangle strips → triangles, each vertex mapped by place(u, v, w).
template <typename F>
void addStrips(const Polygons& p, F place, std::vector<float>& out)
{
  auto vertex = [&](int32_t k) {
    const size_t i = size_t(p.vertIndices[size_t(k)]) * size_t(p.dim);
    if (i + size_t(p.dim) > p.vertices.size())
      throw std::runtime_error("JT PMI: bad polygon vertex");
    const gp_XYZ v = place(p.vertices[i], p.vertices[i + 1], p.dim > 2 ? p.vertices[i + 2] : 0.0f);
    out.insert(out.end(), {float(v.X()), float(v.Y()), float(v.Z())});
  };
  for (size_t s = 0; s + 1 < p.primIndices.size(); ++s)
  {
    const int32_t first = p.primIndices[s], last = std::min<int32_t>(p.primIndices[s + 1], int32_t(p.vertIndices.size()));
    for (int32_t k = std::max(first, 0); k + 2 < last; ++k)
    {
      const int32_t a = p.vertIndices[size_t(k)], b = p.vertIndices[size_t(k + 1)], c = p.vertIndices[size_t(k + 2)];
      if (a == b || b == c || a == c)
        continue; // degenerate joins
      const bool even = (k - first) % 2 == 0;
      vertex(even ? k : k + 1);
      vertex(even ? k + 1 : k);
      vertex(k + 2);
    }
  }
}

// Polyline k runs over vertices indices[k] .. indices[k + 1]; each becomes line segments.
template <typename Index, typename F>
void addPolylines(const std::vector<Index>& indices, const std::vector<float>& vertices, size_t dim, F place,
                  std::vector<float>& out)
{
  const size_t count = vertices.size() / dim;
  for (size_t k = 0; k + 1 < indices.size(); ++k)
  {
    const size_t first = size_t(std::max<Index>(indices[k], 0)), last = std::min(size_t(std::max<Index>(indices[k + 1], 0)), count);
    for (size_t i = first + 1; i < last; ++i)
      for (size_t j : {i - 1, i})
      {
        const float* v = &vertices[j * dim];
        const gp_XYZ p = place(v[0], v[1], dim > 2 ? v[2] : 0.0f);
        out.insert(out.end(), {float(p.X()), float(p.Y()), float(p.Z())});
      }
  }
}

std::string kindOf(uint16_t type)
{
  switch (type)
  {
    case kGdt:
    case kFeatureControlFrame:
    case kCompositeFcf: return "tolerance";
    case kDimension:
    case kCalloutDimension:
    case kChamferDimension: return "dimension";
    case kDatumFeatureSymbol:
    case kDatumTarget:
    case kDatumPoint: return "datum";
    default: return "note";
  }
}

// "FeatureControlFrame" → "Feature Control Frame".
std::string spaced(const std::string& s)
{
  std::string out;
  for (size_t i = 0; i < s.size(); ++i)
  {
    if (i && std::isupper(static_cast<unsigned char>(s[i])) && std::islower(static_cast<unsigned char>(s[i - 1])))
      out += ' ';
    out += s[i];
  }
  return out;
}

JtPmi readJt10(Reader& r)
{
  r.u8();  // version
  r.i16(); // empty

  const int32_t designGroups = r.count();
  for (int32_t g = 0; g < designGroups; ++g)
  {
    r.i32(); // name
    for (int32_t n = r.count(); n > 0; --n)
      r.skip(r.i32() == 2 ? 8 + 8 : 4 + 8); // value (F64 or I32), label, description
  }

  struct Association
  {
    int32_t source, sourceOwner, reason, destination, destinationOwner;
  };
  std::vector<Association> associations(size_t(r.count()));
  for (Association& a : associations)
    a = {r.i32(), r.i32(), r.i32(), r.i32(), r.i32()};
  r.skip(8 * size_t(r.count())); // user attributes

  std::vector<std::u16string> strings(size_t(r.count()));
  for (std::u16string& s : strings)
    s = r.mbString();

  std::vector<RawView> views(size_t(r.count()));
  for (RawView& v : views)
  {
    v = readView(r);
    readProperties(r);
  }

  std::vector<Entity> entities(size_t(r.count()));
  for (Entity& e : entities)
    e = readGenericEntity(r, strings);
  const std::vector<Polygons> entityPolygons = readPolygonData(r); // one element per entity

  std::vector<int32_t> cadTags; // CAD tag of each model view, design group and entity, in that order
  if (r.u32() == 1)
  {
    cadTags = r.vec<int32_t>();
    r.u8(); // compressed CAD tags: version, length (counting itself), data
    const int32_t length = r.i32();
    if (length < 4)
      throw std::runtime_error("JT PMI: bad CAD tag data");
    r.skip(size_t(length) - 4);
  }

  std::vector<Font> fonts(r.u32());
  for (Font& f : fonts)
  {
    r.mbString(); // name
    f.chars  = r.vec<uint16_t>();
    f.glyphs = readPolygonData(r);
  }
  // The rest (properties, sort orders, V102 additions) is not needed.

  auto glyph = [&](char16_t c) -> const Polygons* {
    for (const Font& f : fonts)
      if (auto it = std::find(f.chars.begin(), f.chars.end(), c); it != f.chars.end())
      {
        const size_t i = size_t(it - f.chars.begin());
        return i < f.glyphs.size() && f.glyphs[i].dim ? &f.glyphs[i] : nullptr;
      }
    return nullptr;
  };

  JtPmi            out;
  std::vector<int> itemOf(entities.size(), -1);
  const auto       model = [](float x, float y, float z) { return gp_XYZ(x, y, z); };
  for (size_t i = 0; i < entities.size(); ++i)
  {
    const Entity& e = entities[i];
    JtPmiItem     item;
    addPolylines(e.lineIndices, e.lineVertices, 3, model, item.segments);
    if (i < entityPolygons.size() && entityPolygons[i].dim == 3)
      addStrips(entityPolygons[i], model, item.triangles);
    if (e.hasFrame)
      for (const Text& t : e.texts)
      {
        addPolylines(t.lineIndices, t.lineVertices, 2, [&](float u, float v, float) { return e.frame.at(u, v); },
                     item.segments);
        for (char16_t c : t.chars)
          if (const Polygons* g = glyph(c))
            addStrips(*g, [&](float u, float v, float) { return e.frame.at(t.x + u, t.y + v); }, item.triangles);
      }
    if (item.segments.empty() && item.triangles.empty())
      continue; // model view styles, sections, part transforms, reference geometry

    item.kind = kindOf(e.type);
    item.type = e.typeName.empty() ? "PMI" : spaced(e.typeName);
    if (item.kind == "datum")
      if (auto it = e.props.find("label"); it != e.props.end() && !it->second.empty())
        item.type = "Datum " + it->second;
    const auto desc = e.props.find("Description");
    item.name       = desc != e.props.end() ? desc->second : std::string();
    itemOf[i]       = int(out.items.size());
    out.items.push_back(std::move(item));
  }

  std::vector<std::string> names;
  for (const std::u16string& s : strings)
    names.push_back(utf8(s));
  const std::vector<int> viewOf = addViews(views, names, out);

  // A view's PMI: associations from a generic entity to the view. Identifiers are indices into the
  // entity lists or, with the indirect bit, CAD tags (looked up in the CAD tag list).
  auto resolve = [&](int32_t data, int type, size_t firstTag, size_t count) -> int {
    const uint32_t d  = uint32_t(data);
    const int32_t  id = int32_t(d & 0xFFFFFF);
    if (int(d >> 24 & 0x7F) != type)
      return -1;
    if (!(d >> 31))
      return size_t(id) < count ? int(id) : -1;
    for (size_t k = 0; k < count && firstTag + k < cadTags.size(); ++k)
      if (cadTags[firstTag + k] == id)
        return int(k);
    return -1;
  };
  for (const Association& a : associations)
  {
    if ((a.reason != kReasonIncluded && a.reason != kReasonShowInView) || a.sourceOwner != -1
        || a.destinationOwner != -1)
      continue;
    const int entity = resolve(a.source, kGenericEntity, views.size() + size_t(designGroups), entities.size());
    const int view   = resolve(a.destination, kModelViewEntity, 0, views.size());
    if (entity < 0 || view < 0 || itemOf[size_t(entity)] < 0 || viewOf[size_t(view)] < 0)
      continue;
    std::vector<int>& pmi = out.views[size_t(viewOf[size_t(view)])].pmi;
    if (std::find(pmi.begin(), pmi.end(), itemOf[size_t(entity)]) == pmi.end())
      pmi.push_back(itemOf[size_t(entity)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// JT 8 and 9: the classic entity lists are read through to reach the model views.

class ClassicReader
{
public:
  ClassicReader(Reader& r, int version) : r(r), v(version) {}

  JtPmi read()
  {
    list(&ClassicReader::entity2D);    // dimensions
    list(&ClassicReader::note);        // notes
    list(&ClassicReader::entity2D);    // datum feature symbols
    list(&ClassicReader::entity2D);    // datum targets
    list(&ClassicReader::entity2D);    // feature control frames
    list(&ClassicReader::entity2D);    // line welds
    list(&ClassicReader::pointEntity); // spot welds
    list(&ClassicReader::entity2D);    // surface finishes
    list(&ClassicReader::pointEntity); // measurement points
    list(&ClassicReader::entity2D);    // locators
    list(&ClassicReader::entity3D);    // reference geometry
    list(&ClassicReader::designGroup);
    list(&ClassicReader::coordSystem);
    r.skip(20 * size_t(r.count())); // associations
    r.skip(8 * size_t(r.count()));  // user attributes
    std::vector<std::string> strings(size_t(r.count()));
    for (std::string& s : strings)
      s = r.string8();
    JtPmi out;
    if (v > 5)
    {
      std::vector<RawView> views(size_t(r.count()));
      for (RawView& view : views)
        view = readView(r);
      addViews(views, strings, out);
    }
    return out;
  }

private:
  void list(void (ClassicReader::*read)())
  {
    for (int32_t n = r.count(); n > 0; --n)
      (this->*read)();
  }

  void base()
  {
    r.i32(); // user label
    if (r.u8())
      r.skip(9 * 4); // 2D reference frame
    r.f32();         // text height
    if (v > 4)
      r.u8(); // valid flag
  }

  void entity2D()
  {
    base();
    for (int32_t n = r.count(); n > 0; --n)
    {
      r.skip(4 * 4 + 6 * 4); // string ID, font, empty, empty, text box
      if (r.vec<int16_t>().size())
        r.vec<float>();
    }
    r.vec<int16_t>(); // polyline indices
    if (v > 4)
      r.vec<int16_t>(); // polyline types
    r.vec<float>();
  }

  void note()
  {
    entity2D();
    if (v > 5)
      r.u32(); // URL flag
  }

  void entity3D()
  {
    base();
    r.i32(); // string ID
    r.i16(); // polyline dimensionality
    r.vec<int16_t>();
    r.vec<float>();
  }

  void pointEntity() // spot weld, measurement point
  {
    entity3D();
    if (v >= 4)
      r.skip(4 * 3 * 4); // point and three directions
  }

  void designGroup()
  {
    r.i32(); // name
    if (v < 3)
      return;
    for (int32_t n = r.count(); n > 0; --n)
    {
      const int32_t type = r.i32();
      if (type < 1 || type > 3)
        throw std::runtime_error("JT PMI: bad design group attribute");
      r.skip(type == 2 ? 8 + 8 : 4 + 8); // value, label, description
    }
  }

  void coordSystem() { r.skip(4 + 9 * 4); }

  Reader& r;
  int     v;
};

} // namespace

JtPmi readJtPmi(const uint8_t* data, size_t size, int jtMajorVersion, bool bigEndian)
{
  Reader r(data, size, bigEndian);
  if (jtMajorVersion >= 10)
    return readJt10(r);
  if (jtMajorVersion > 8)
    r.i16(); // version of the element
  const int version = r.i16();
  r.i16(); // reserved
  return ClassicReader(r, version).read();
}
