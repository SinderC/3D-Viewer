# Supported formats

| Format | Extensions | Read by | Geometry | Measure |
|---|---|---|---|---|
| STEP | `.stp` `.step` | OCCT | B-rep, AP242 tessellated | full |
| IGES | `.igs` `.iges` | OCCT | B-rep | full |
| BREP | `.brep` `.brp` | OCCT | B-rep | full |
| JT | `.jt` | TKJT | mesh, optional XT B-rep edges | full on XT edges, otherwise points |
| QIF | `.qif` | OCCT (own reader) | B-rep | full |
| glTF / GLB | `.gltf` `.glb` | three.js | mesh | point to point |
| FBX | `.fbx` | three.js | mesh | point to point |
| 3MF | `.3mf` | three.js | mesh | point to point |
| Collada | `.dae` | three.js | mesh | point to point |
| OBJ | `.obj` | OCCT | mesh | point to point |
| STL | `.stl` | OCCT | mesh | point to point |
| PLY | `.ply` | three.js | mesh | point to point |
| VRML | `.wrl` `.vrml` | OCCT | mesh | point to point |

## STEP

- AP203 (ed1/ed2), AP214, AP242 (ed1–ed3), including AP242 tessellated geometry, CSG and swept solids.
- Assembly structure, colours (including single-occurrence colours), layers, materials, approvals and
  organisations. For each component occurrence, its id, name, reference designator and quantity. Items the file marks invisible are hidden.
- **External references:** an assembly that keeps parts in other files (STEP AP203, AP214 or AP242,
  or JT, IGES, STL, BREP, OBJ, VRML) opens together with them when they are selected at the same time. If any are missing, the viewer names them and offers to add them.
- **AP242 PMI:** dimensions, geometric tolerances, datums and notes as drawn in the file (lines and
  filled text), each with show/hide, its referenced faces and its semantic values (type, nominal,
  tolerances, datums). Assembly PMI on particular component instances is drawn once in the
  assembly, also when the components are in other files (AP242 external element references).
- **Attributes** (user-defined) of parts, and of single component instances, deep ones included.
- **Saved views:** direction, up vector and the PMI they show. OCCT keeps no camera position, so a
  view frames the model and its PMI.

## IGES and BREP

B-rep geometry, so every measurement works.

## JT

- JT 8, 9 and 10 (ISO 14306, including JT 10.5): tessellated geometry, assembly structure, instances
  and material colours. Only the finest LOD is read.
- Parts that embed their exact B-rep as Parasolid XT data get its edges: feature edges and exact edge
  length, radius and diameter. Faces stay the JT mesh.
- **PMI:** JT 10 PMI as drawn in the file (lines, arrowheads and font glyphs), per part and for the
  model, with saved views. JT 8 and 9 give saved views only. No semantic values or referenced faces.
- Not supported: JT B-rep, external part files.

## QIF

- QIF 3 (ISO 23952) model-based definition: the exact B-rep, so every measurement works. Parts and
  assemblies, colours of bodies and faces, and the file's length unit (including the product's scale
  coefficient). Bodies the file hides (auxiliary geometry) are hidden.
- **PMI:** characteristics (dimensions and geometric tolerances) with their nominal, tolerance or
  limits, datums and referenced faces; datums, datum targets and notes. Drawn as the file places them
  (`PMIDisplay`: frames, leaders, witness lines, graphics and text). Text uses one font of our own
  (osifont), not the font the file names, so its width may differ slightly from the exporter's
  frames. Saved views with their direction and the PMI they show.
- Files without model geometry (measurement plans, results, rules) are rejected with a message.
- Not supported: mesh faces, point clouds, polynomial spline curves and surfaces, external QIF
  references; of drawn PMI, areas given as loops, flag and weld symbol frames.

## Mesh formats

Meshes have no feature edges and support point-to-point distance only.

- **glTF, FBX, 3MF, Collada:** read in the file's unit, with materials, textures and vertex colours.
- **PLY:** vertex colours. Read as mm.
- **OBJ, STL, VRML:** no reliable unit, so read as mm.

Not supported:

- `.gltf` files with external buffers or images (embed them, or use `.glb`)
- external `.bin` and `.mtl` files, and Collada textures in other files
- PLY point clouds
- Draco, meshopt and KTX2 compression
