// JT logical scene graph (LSG) → XCAF.
//
// Part nodes (and groups holding only geometry) become XCAF parts: one triangulated face per
// tri-strip shape, baked into part coordinates. Other groups become assemblies. The transform and
// material of a node (and of the instance nodes referencing it) go on the XCAF component that
// places it; materials below a part become face colours. Of each LOD node only the finest LOD is read.
// Parts that embed their exact B-rep (XT data) also get its edges, as free edges next to the faces.
// PMI (late-loaded PMI Manager elements on metadata nodes) is parsed by jt_pmi.cpp.

#include "jt_reader.h"
#include "xt_reader.h"

#include <JtAttribute_GeometricTransform.hxx>
#include <JtAttribute_Material.hxx>
#include <JtData_Model.hxx>
#include <JtElement_MetaData_PMIManager.hxx>
#include <JtElement_ShapeLOD_Vertex.hxx>
#include <JtElement_XTBRep.hxx>
#include <JtNode_Instance.hxx>
#include <JtNode_LOD.hxx>
#include <JtNode_MetaData.hxx>
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
#include <set>
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

// Segment types (ISO 14306 segment type table).
constexpr Jt_I32 kPmiSegment    = 3;
constexpr Jt_I32 kXtBRepSegment = 17;

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
  Converter(const Handle(TDocStd_Document)& doc, const Handle(JtData_Model)& model, double scale)
      : myShapes(XCAFDoc_DocumentTool::ShapeTool(doc->Main())),
        myColors(XCAFDoc_DocumentTool::ColorTool(doc->Main())),
        myModel(model),
        myScale(scale)
  {
  }

  void addRoot(const Handle(JtNode_Base)& root)
  {
    const Attributes a = attributesOf(root);
    TDF_Label        def = define(root);
    if (def.IsNull())
      return;
    std::set<const Standard_Transient*> visited;
    visitPmi(root, gp_Trsf(), false, visited);
    if (myPmi.views.empty())
      myPmi.views = std::move(myPartViews);
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

  JtPmi& pmi() { return myPmi; }

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
      if (auto part = Handle(JtNode_Part)::DownCast(node); !part.IsNull())
        addXtEdges(part, compound);
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

  // Edges of the part's XT B-rep, in part coordinates like the faces. XT data is in metres.
  static void addXtEdges(const Handle(JtNode_Part)& part, TopoDS_Compound& compound)
  {
    const JtData_Object::VectorOfLateLoads& lateLoads = part->LateLoads();
    for (Standard_Size i = 0; i < lateLoads.Count(); ++i)
    {
      const Handle(JtProperty_LateLoaded)& late = lateLoads[i];
      if (late->getSegmentType() != kXtBRepSegment)
        continue;
      try
      {
        if (late->DefferedObject().IsNull())
          late->Load();
        const auto xt = Handle(JtElement_XTBRep)::DownCast(late->DefferedObject());
        if (!xt.IsNull())
        {
          const Jt_String& data = xt->Data();
          for (const TopoDS_Edge& edge : readXtEdges(data.Data(), size_t(data.Count()), 1000.0))
            BRep_Builder().Add(compound, edge);
        }
      }
      catch (const std::exception&)
      {
        // Unreadable XT data: the part keeps its mesh without edges.
      }
      late->Unload(); // the edges hold their own geometry
    }
  }

  // PMI sits on metadata nodes. The top one holds the model's PMI; the ones below it (NX writes one
  // per component file) hold the PMI of the component's own part, next to its sub-components.
  // trsf: node's parent → model.
  void visitPmi(const Handle(JtNode_Base)&           node,
                gp_Trsf                              trsf,
                bool                                 belowTop,
                std::set<const Standard_Transient*>& visited)
  {
    if (node.IsNull())
      return;
    trsf.Multiply(attributesOf(node).trsf);
    if (auto inst = Handle(JtNode_Instance)::DownCast(node); !inst.IsNull())
      return visitPmi(Handle(JtNode_Base)::DownCast(inst->Object()), trsf, belowTop, visited);
    const auto group = Handle(JtNode_Group)::DownCast(node);
    if (group.IsNull() || isLod(node) || !visited.insert(node.get()).second)
      return;

    const auto meta = Handle(JtNode_MetaData)::DownCast(node);
    if (!meta.IsNull() && hasPmi(meta))
    {
      if (node->IsKind(STANDARD_TYPE(JtNode_Part)))
      {
        if (const TDF_Label part = defOf(node); !part.IsNull())
          addPmi(meta, part, gp_Trsf(), false);
      }
      else if (!belowTop)
      {
        addPmi(meta, {}, trsf, true);
        belowTop = true;
      }
      else
      {
        std::vector<std::pair<Handle(JtNode_Base), gp_Trsf>> parts;
        partsBelow(group, gp_Trsf(), parts);
        if (parts.size() == 1)
          if (const TDF_Label part = defOf(parts[0].first); !part.IsNull())
            addPmi(meta, part, parts[0].second.Inverted(), false);
      }
    }
    if (node->IsKind(STANDARD_TYPE(JtNode_Part)))
      return;
    for (Standard_Size i = 0; i < group->Children().Count(); ++i)
      visitPmi(Handle(JtNode_Base)::DownCast(group->Children()[i]), trsf, belowTop, visited);
  }

  // Part nodes below group, with their transforms relative to it (their own included); not those
  // of sub-components (other metadata nodes).
  static void partsBelow(const Handle(JtNode_Group)&                            group,
                         const gp_Trsf&                                         trsf,
                         std::vector<std::pair<Handle(JtNode_Base), gp_Trsf>>& parts)
  {
    for (Standard_Size i = 0; i < group->Children().Count(); ++i)
    {
      auto    node = Handle(JtNode_Base)::DownCast(group->Children()[i]);
      gp_Trsf t    = trsf;
      while (!node.IsNull())
      {
        t.Multiply(attributesOf(node).trsf);
        const auto inst = Handle(JtNode_Instance)::DownCast(node);
        if (inst.IsNull())
          break;
        node = Handle(JtNode_Base)::DownCast(inst->Object());
      }
      if (node.IsNull() || isGeometry(node))
        continue;
      if (node->IsKind(STANDARD_TYPE(JtNode_Part)))
        parts.emplace_back(node, t);
      else if (const auto sub = Handle(JtNode_Group)::DownCast(node);
               !sub.IsNull() && !node->IsKind(STANDARD_TYPE(JtNode_MetaData)))
        partsBelow(sub, t, parts);
    }
  }

  TDF_Label defOf(const Handle(JtNode_Base)& node) const
  {
    const auto it = myDefs.find(node.get());
    return it != myDefs.end() ? it->second : TDF_Label();
  }

  static bool hasPmi(const Handle(JtNode_MetaData)& node)
  {
    for (Standard_Size i = 0; i < node->LateLoads().Count(); ++i)
      if (node->LateLoads()[i]->getSegmentType() == kPmiSegment)
        return true;
    return false;
  }

  // Adds the PMI of node, in its coordinates (taken through trsf, scaled to mm), owned by part (null:
  // the model). Keeps the views of the top node, and of the first part as a fallback.
  void addPmi(const Handle(JtNode_MetaData)& node, const TDF_Label& part, const gp_Trsf& trsf, bool top)
  {
    const JtData_Object::VectorOfLateLoads& lateLoads = node->LateLoads();
    for (Standard_Size i = 0; i < lateLoads.Count(); ++i)
    {
      const Handle(JtProperty_LateLoaded)& late = lateLoads[i];
      if (late->getSegmentType() != kPmiSegment)
        continue;
      try
      {
        if (late->DefferedObject().IsNull())
          late->Load();
        const auto manager = Handle(JtElement_MetaData_PMIManager)::DownCast(late->DefferedObject());
        if (!manager.IsNull())
        {
          const Jt_String& data = manager->Data();
          add(readJtPmi(data.Data(), size_t(data.Count()), myModel->MajorVersion(), !myModel->IsFileLE()), part,
              trsf, top);
        }
      }
      catch (const std::exception&)
      {
        // Unreadable PMI: the part keeps its mesh without it.
      }
      late->Unload();
    }
  }

  void add(JtPmi pmi, const TDF_Label& part, const gp_Trsf& trsf, bool top)
  {
    const int first = int(myPmi.items.size());
    for (JtPmiItem& item : pmi.items)
    {
      for (std::vector<float>* points : {&item.segments, &item.triangles})
        for (size_t k = 0; k + 2 < points->size(); k += 3)
        {
          gp_XYZ p((*points)[k], (*points)[k + 1], (*points)[k + 2]);
          trsf.Transforms(p);
          p *= myScale;
          (*points)[k] = float(p.X()), (*points)[k + 1] = float(p.Y()), (*points)[k + 2] = float(p.Z());
        }
      item.part = part;
      myPmi.items.push_back(std::move(item));
    }
    for (JtPmiView& v : pmi.views)
    {
      for (int& i : v.pmi)
        i += first;
      v.direction.Transform(trsf);
      v.up.Transform(trsf);
    }
    if (top)
      myPmi.views = std::move(pmi.views);
    else if (myPartViews.empty())
      myPartViews = std::move(pmi.views);
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
  Handle(JtData_Model)                       myModel;
  double                                     myScale;
  JtPmi                                      myPmi;
  std::vector<JtPmiView>                     myPartViews;
  size_t                                     myTriangles = 0;
  std::map<const Standard_Transient*, TDF_Label> myDefs;
};

} // namespace

std::string readJt(const char* path, const Handle(TDocStd_Document)& doc, JtPmi& pmi)
{
  Handle(JtData_Model)     model = new JtData_Model(TCollection_ExtendedString(path));
  Handle(JtNode_Partition) root  = model->Init();
  if (root.IsNull())
    throw std::runtime_error("Not a readable JT file");

  const auto [scale, unit] = unitOf(TCollection_AsciiString(model->MeasurementUnits()));
  Converter conv(doc, model, scale);
  conv.addRoot(root);
  XCAFDoc_DocumentTool::ShapeTool(doc->Main())->UpdateAssemblies();
  if (conv.empty())
    throw std::runtime_error("JT file has no tessellated geometry");
  pmi = std::move(conv.pmi());
  return unit;
}
