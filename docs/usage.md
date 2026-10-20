# Using the viewer

Open a file with **File › Open**, Cmd/Ctrl+O, or by dropping it on the window. Installed as a PWA
(Chromium), the app can be the operating system's handler for the supported extensions.

## Model tree

- Parts are listed with the assembly structure and colours from the file, with name search.
- Show, hide or isolate parts. Hidden parts can be shown as translucent ghosts.
- **Properties** shows the bounding-box size of the model and of the selected part.
- The tree sits in the **Navigator** on the left, with tabs for PMI and saved views when the file has them.
- **View › Navigator over view** draws the Navigator over the 3D view at a fixed width. Only
  the rows and the search bar have a backing; drag, click or scroll elsewhere in the Navigator to work the
  view. The wheel over a row scrolls the tree. Off by default; not in narrow windows.

## View

- Fit all, zoom to selection, six standard views and iso, ViewCube.
- Perspective or orthographic camera. The **Up axis** setting picks the model axis that points up;
  standard views, ViewCube, grid, shadow and GLB export follow it.
- Display styles: shaded, shaded with edges, wireframe, realistic (overhead light, ambient occlusion,
  contact shadow, tone mapping) and studio (warm sun with shadows, cool sky fill, graded colour).
  Edge styles need B-rep geometry or JT with XT data.
- Ground grid. Save the view as a PNG.

## Tools

- **Section:** a plane along X, Y or Z, or along a picked planar face, with solid caps.
- **Explode:** a slider moves the parts away from the model centre.
- **Measure:** edge length, radius and diameter; distance between points, with vertex snapping; point
  to planar face; distance and angle between planar faces; point coordinates. Units are mm, cm, m,
  in, ft or ft-in (1/16"). Measurements stay on screen until removed.
- **Selection:** on parts with exact (B-rep) geometry, a click picks the vertex, edge or face under
  the cursor, shown faintly before you click, and selects its part in the model tree. On a face, a
  vertex or edge must be within 2 pixels to take the click; off the model, within 6. Mesh parts (STL, OBJ, glTF, JT without exact geometry) are picked whole. A click on empty
  space, or Esc, clears the selection. Hidden edges and vertices of a selection show through the model.
- **PMI:** see [formats](formats.md) for what each format provides. Select an item, in the list or by
  clicking it in the view, to see its values and the faces, edges and vertices it refers to; the
  parts holding them are marked in the model tree. Picking a face, edge or vertex marks the PMI that
  refers to it, in the view and in the PMI list. Select a saved view to apply it.
- **Appearance:** for the selected part or the whole model, pick a colour or a finish: polished,
  brushed, sand-blasted or cast metal, anodised, brass, copper, glossy, matte or textured plastic,
  rubber, carbon fibre or wood, with environment reflections. Finishes keep the part's colour (light
  grey when it has none), except brass and copper. Textures are generated in the browser and
  box-mapped at a physical scale, so seams can show on curved faces.
- **Export:** the shown parts as STL (mm) or binary glTF (GLB). GLB keeps appearances.

## Mouse

| Input | Action |
|---|---|
| Click | Select a face, edge, vertex or PMI item; a part of a mesh model |
| Drag | Rotate |
| Right-drag or Shift+drag | Pan |
| Scroll | Zoom |
| Right-click (Mac: two-finger tap) | Rotate about this point |

## Keyboard

Press **?** in the app for the full list.

| Key | Action |
|---|---|
| Cmd/Ctrl+O | Open a file |
| Esc | Stop measuring, clear the selection |
| F / Shift+F | Fit all / zoom to selection |
| 1–7 | Iso, front, back, left, right, top, bottom |
| O | Orthographic |
| D | Next display style |
| G | Ground grid |
| P | PMI |
| H / Shift+H | Hide the selection / show all |
| I | Show only the selection |
| X | Ghost hidden parts |
| M | Measure |
| Backspace | Remove the last measurement |

## Settings

- **Mesh quality:** coarse, normal or fine (fine caps the deflection at 0.2 mm). Applies to B-rep formats.
- **Theme**, **PMI colour** and **toolbar size**.
