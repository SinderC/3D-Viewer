// JT logical scene graph (LSG) → XCAF.
//
// Part nodes (and groups holding only geometry) become XCAF parts: one triangulated face per
// tri-strip shape, baked into part coordinates. Other groups become assemblies. The transform and
// material of a node (and of the instance nodes referencing it) go on the XCAF component that
// places it; materials below a part become face colours. Of each LOD node only the finest LOD is read.

#include "jt_reader.h"

#include <JtAttribute_GeometricTransform.hxx>
#include <JtAttribute_Material.hxx>
#include <JtData_Model.hxx>
#include <JtElement_ShapeLOD_Vertex.hxx>
#include <JtNode_Instance.hxx>
#include <JtNode_LOD.hxx>
#include <JtNode_Part.hxx>
#include <JtNode_Partition.hxx>
#include <JtNode_Shape_Vertex.hxx>
#include <JtProperty_LateLoaded.hxx>

#include <BRep_Builder.hxx>
#include <Poly_Triangulation.hxx>
#include <Quantity_ColorRGBA.hxx>
#include <Standard_Failure.hxx>
#include <TDataStd_Name.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include <map>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace
{

// JT_PROP_MEASUREMENT_UNITS value → (mm per unit, STEP-style unit name for display).
std::pair<double, std::string> unitOf(TCollection_AsciiString name)
{
  name.LowerCase();
  static const std::map<std::string, std::pair<double, std::string>> kUnits = {
    {"millimeters", {1.0, "MILLIMETRE"}},
    {"centimeters", {10.0, "CENTIMETRE"}},
    {"decimeters", {100.0, "MILLIMETRE"}},
    {"meters", {1000.0, "METRE"}},
    {"kilometers", {1e6, "METRE"}},
    {"micrometers", {1e-3, "MILLIMETRE"}},
    {"inches", {25.4, "INCH"}},
    {"mils", {0.0254, "INCH"}},
    {"feet", {304.8, "FOOT"}},
    {"yards", {914.4, "FOOT"}},
    {"miles", {1609344.0, "FOOT"}},
  };
  const auto it = kUnits.find(name.ToCString());
  return it != kUnits.end() ? it->second : std::pair<double, std::string>{1.0, "MILLIMETRE"};
}

// Transform and material of one node, from its attributes.
struct Attributes
{
  gp_Trsf                           trsf;
  std::optional<Quantity_ColorRGBA> color;
};

Attributes attributesOf(const Handle(JtNode_Base)& node)
{
  Attributes a;
  const JtData_Object::VectorOfObjects& attrs = node->Attributes();
  for (Standard_Size i = 0; i < attrs.Count(); ++i)
  {
    if (auto t = Handle(JtAttribute_GeometricTransform)::DownCast(attrs[i]); !t.IsNull())
    {
      try
      {
        gp_Trsf trsf;
        t->GetTrsf(trsf);
        a.trsf = trsf;
      }
      catch (const Standard_Failure&)
      {
        // Non-uniform scale or shear: not representable as a gp_Trsf. Left as identity.
      }
    }
    else if (auto m = Handle(JtAttribute_Material)::DownCast(attrs[i]); !m.IsNull())
    {
      const Jt_F32* c = m->DiffuseColor();
      a.color = Quantity_ColorRGBA(Quantity_Color(c[0], c[1], c[2], Quantity_TOC_sRGB), c[3]);
    }
  }
  return a;
}

bool isLod(const Handle(JtData_Object)& o) { return o->IsKind(STANDARD_TYPE(JtNode_LOD)); }
bool isShape(const Handle(JtData_Object)& o) { return o->IsKind(STANDARD_TYPE(JtNode_Shape_Base)); }

// Shapes and LOD nodes are geometry; so are instances of them.
bool isGeometry(const Handle(JtData_Object)& o)
{
  if (auto inst = Handle(JtNode_Instance)::DownCast(o); !inst.IsNull())
    return !inst->Object().IsNull() && isGeometry(inst->Object());
  return isShape(o) || isLod(o);
}

class Converter
{
public:
  Converter(const Handle(TDocStd_Document)& doc, double scale)
      : myShapes(XCAFDoc_DocumentTool::ShapeTool(doc->Main())),
        myColors(XCAFDoc_DocumentTool::ColorTool(doc->Main())),
        myScale(scale)
  {
  }

  void addRoot(const Handle(JtNode_Base)& root)
  {
    const Attributes a = attributesOf(root);
    TDF_Label        def = define(root);
    if (def.IsNull())
      return;
    if (a.trsf.Form() != gp_Identity)
    {
      // Root transform: wrap so it becomes a component location.
      TDF_Label assy = myShapes->NewShape();
      setName(assy, root->Name());
      place(assy, def, a.trsf, a.color, {});
      return;
    }
    if (a.color)
      myColors->SetColor(def, *a.color, XCAFDoc_ColorSurf);
  }

  bool empty() const { return myTriangles == 0; }

private:
  // XCAF label for a node's definition; built once per node so instanced parts are shared.
  // Returns a null label if the subtree has no geometry.
  TDF_Label define(const Handle(JtNode_Base)& node)
  {
    if (auto it = myDefs.find(node.get()); it != myDefs.end())
      return it->second;

    TDF_Label   label;
    const auto  group = Handle(JtNode_Group)::DownCast(node);
    bool        allGeometry = true;
    if (!group.IsNull())
      for (Standard_Size i = 0; i < group->Children().Count(); ++i)
        allGeometry = allGeometry && isGeometry(group->Children()[i]);

    if (group.IsNull() || node->IsKind(STANDARD_TYPE(JtNode_Part)) || isLod(node) || allGeometry)
      label = definePart(node, false);
    else
      label = defineAssembly(group);

    myDefs[node.get()] = label;
    return label;
  }

  TDF_Label defineAssembly(const Handle(JtNode_Group)& group)
  {
    TDF_Label assy = myShapes->NewShape();
    setName(assy, group->Name());
    bool any = addComponents(assy, group);
    // Loose geometry next to sub-assemblies: one part named after the group.
    if (TDF_Label loose = definePart(group, true); !loose.IsNull())
    {
      myShapes->AddComponent(assy, loose, TopLoc_Location());
      any = true;
    }
    return any ? assy : TDF_Label();
  }

  // Adds group's non-geometry children to assy. Unnamed groups without attributes (JT writers wrap
  // assemblies in anonymous metadata nodes) are inlined so they don't show up in the tree.
  bool addComponents(const TDF_Label& assy, const Handle(JtNode_Group)& group)
  {
    bool any = false;
    for (Standard_Size i = 0; i < group->Children().Count(); ++i)
    {
      const auto child = Handle(JtNode_Base)::DownCast(group->Children()[i]);
      if (child.IsNull() || isGeometry(child))
        continue;
      const auto sub = Handle(JtNode_Group)::DownCast(child);
      if (!sub.IsNull() && !child->IsKind(STANDARD_TYPE(JtNode_Part)) && child->Name().IsEmpty()
          && child->Attributes().Count() == 0 && !hasGeometryChild(sub))
        any |= addComponents(assy, sub);
      else
        any |= addComponent(assy, child);
    }
    return any;
  }

  static bool hasGeometryChild(const Handle(JtNode_Group)& group)
  {
    for (Standard_Size i = 0; i < group->Children().Count(); ++i)
      if (isGeometry(group->Children()[i]))
        return true;
    return false;
  }

  // Places child (following instance nodes) as a component of assy.
  bool addComponent(const TDF_Label& assy, Handle(JtNode_Base) child)
  {
    gp_Trsf                           trsf;
    std::optional<Quantity_ColorRGBA> color;
    TCollection_ExtendedString        name;
    for (;;)
    {
      const Attributes a = attributesOf(child);
      trsf.Multiply(a.trsf);
      if (a.color)
        color = a.color; // the node nearest the geometry wins
      if (name.IsEmpty())
        name = child->Name();
      auto inst = Handle(JtNode_Instance)::DownCast(child);
      if (inst.IsNull())
        break;
      child = Handle(JtNode_Base)::DownCast(inst->Object());
      if (child.IsNull())
        return false;
    }
    const TDF_Label def = define(child);
    if (def.IsNull())
      return false;
    place(assy, def, trsf, color, name);
    return true;
  }

  void place(const TDF_Label&                         assy,
             const TDF_Label&                         def,
             gp_Trsf                                  trsf,
             const std::optional<Quantity_ColorRGBA>& color,
             const TCollection_ExtendedString&        name)
  {
    trsf.SetTranslationPart(trsf.TranslationPart() * myScale); // geometry is scaled to mm
    const TDF_Label comp = myShapes->AddComponent(assy, def, TopLoc_Location(trsf));
    if (!name.IsEmpty())
      TDataStd_Name::Set(comp, name);
    if (color)
      myColors->SetColor(comp, *color, XCAFDoc_ColorSurf);
  }

  // A part from the node's geometry. With looseOnly, only the group's direct geometry children.
  TDF_Label definePart(const Handle(JtNode_Base)& node, bool looseOnly)
  {
    TopoDS_Compound compound;
    BRep_Builder().MakeCompound(compound);
    std::vector<std::pair<TopoDS_Face, Quantity_ColorRGBA>> faceColors;

    if (looseOnly)
    {
      const auto group = Handle(JtNode_Group)::DownCast(node);
      for (Standard_Size i = 0; i < group->Children().Count(); ++i)
        if (isGeometry(group->Children()[i]))
          collect(Handle(JtNode_Base)::DownCast(group->Children()[i]), gp_Trsf(), {}, compound, faceColors);
    }
    else
    {
      collect(node, gp_Trsf(), {}, compound, faceColors, /*own attributes on the component*/ true);
    }

    if (compound.NbChildren() == 0)
      return {};
    const TDF_Label part = myShapes->AddShape(compound, false);
    setName(part, node->Name());
    for (const auto& [face, color] : faceColors)
    {
      const TDF_Label sub = myShapes->AddSubShape(part, face);
      if (!sub.IsNull())
        myColors->SetColor(sub, color, XCAFDoc_ColorSurf);
    }
    return part;
  }

  // Adds the faces of node's subtree to compound, with transforms baked in.
  void collect(const Handle(JtNode_Base)&                                node,
               gp_Trsf                                                   trsf,
               std::optional<Quantity_ColorRGBA>                         color,
               TopoDS_Compound&                                          compound,
               std::vector<std::pair<TopoDS_Face, Quantity_ColorRGBA>>& faceColors,
               bool                                                      skipOwnAttributes = false)
  {
    if (node.IsNull())
      return;
    if (!skipOwnAttributes)
    {
      const Attributes a = attributesOf(node);
      trsf.Multiply(a.trsf);
      if (a.color)
        color = a.color;
    }

    if (auto inst = Handle(JtNode_Instance)::DownCast(node); !inst.IsNull())
      return collect(Handle(JtNode_Base)::DownCast(inst->Object()), trsf, color, compound, faceColors);

    if (auto shape = Handle(JtNode_Shape_Vertex)::DownCast(node); !shape.IsNull())
    {
      const TopoDS_Face face = triangulate(shape, trsf);
      if (face.IsNull())
        return;
      BRep_Builder().Add(compound, face);
      if (color)
        faceColors.emplace_back(face, *color);
      return;
    }

    const auto group = Handle(JtNode_Group)::DownCast(node);
    if (group.IsNull())
      return;
    // LOD children are alternatives, finest first.
    const Standard_Size n = isLod(node) ? std::min<Standard_Size>(1, group->Children().Count())
                                        : group->Children().Count();
    for (Standard_Size i = 0; i < n; ++i)
      collect(Handle(JtNode_Base)::DownCast(group->Children()[i]), trsf, color, compound, faceColors);
  }

  TopoDS_Face triangulate(const Handle(JtNode_Shape_Vertex)& shape, const gp_Trsf& trsf)
  {
    const JtData_Object::VectorOfLateLoads& lateLoads = shape->LateLoads();
    for (Standard_Size i = 0; i < lateLoads.Count(); ++i)
    {
      const Handle(JtProperty_LateLoaded)& late = lateLoads[i];
      try
      {
        if (late->DefferedObject().IsNull())
          late->Load();
      }
      catch (const Standard_Failure&)
      {
        continue; // undecodable mesh: skip this shape, keep the rest of the model
      }
      const auto lod = Handle(JtElement_ShapeLOD_Vertex)::DownCast(late->DefferedObject());
      if (lod.IsNull())
        continue;
      TopoDS_Face face = toFace(*lod, trsf);
      late->Unload(); // free the decoded arrays; the triangulation holds its own copy
      if (!face.IsNull())
        return face;
    }
    return {};
  }

  TopoDS_Face toFace(const JtElement_ShapeLOD_Vertex& lod, const gp_Trsf& trsf)
  {
    const auto& idx = lod.Indices(); // triangle list
    const auto& pos = lod.Vertices();
    const auto& nrm = lod.Normals();
    const int   nbV = int(pos.Count());

    std::vector<Poly_Triangle> tris;
    tris.reserve(idx.Count() / 3);
    const int32_t* t = idx.Data();
    for (int i = 0; i + 2 < int(idx.Count()); i += 3)
      if (t[i] >= 0 && t[i + 1] >= 0 && t[i + 2] >= 0 && t[i] < nbV && t[i + 1] < nbV && t[i + 2] < nbV)
        tris.emplace_back(t[i] + 1, t[i + 1] + 1, t[i + 2] + 1);
    if (tris.empty())
      return {};

    const bool                 hasNormals = int(nrm.Count()) == nbV;
    Handle(Poly_Triangulation) tri        = new Poly_Triangulation(nbV, int(tris.size()), false);
    if (hasNormals)
      tri->AddNormals();
    const float* p = pos.Data();
    const float* n = hasNormals ? nrm.Data() : nullptr;
    for (int i = 0; i < nbV; ++i)
    {
      gp_Pnt pt(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
      pt.Transform(trsf);
      tri->SetNode(i + 1, gp_Pnt(pt.XYZ() * myScale));
      if (n)
      {
        gp_Vec v(n[3 * i], n[3 * i + 1], n[3 * i + 2]);
        v.Transform(trsf);
        tri->SetNormal(i + 1, v.SquareMagnitude() > 1e-24 ? gp_Dir(v) : gp_Dir(0, 0, 1));
      }
    }
    for (int i = 0; i < int(tris.size()); ++i)
      tri->SetTriangle(i + 1, tris[i]);
    myTriangles += tris.size();

    TopoDS_Face face;
    BRep_Builder().MakeFace(face, tri);
    return face;
  }

  static void setName(const TDF_Label& l, const TCollection_ExtendedString& name)
  {
    if (!name.IsEmpty())
      TDataStd_Name::Set(l, name);
  }

  Handle(XCAFDoc_ShapeTool)                  myShapes;
  Handle(XCAFDoc_ColorTool)                  myColors;
  double                                     myScale;
  size_t                                     myTriangles = 0;
  std::map<const Standard_Transient*, TDF_Label> myDefs;
};

} // namespace

std::string readJt(const char* path, const Handle(TDocStd_Document)& doc)
{
  Handle(JtData_Model)     model = new JtData_Model(TCollection_ExtendedString(path));
  Handle(JtNode_Partition) root  = model->Init();
  if (root.IsNull())
    throw std::runtime_error("Not a readable JT file");

  const auto [scale, unit] = unitOf(TCollection_AsciiString(model->MeasurementUnits()));
  Converter conv(doc, scale);
  conv.addRoot(root);
  XCAFDoc_DocumentTool::ShapeTool(doc->Main())->UpdateAssemblies();
  if (conv.empty())
    throw std::runtime_error("JT file has no tessellated geometry");
  return unit;
}
