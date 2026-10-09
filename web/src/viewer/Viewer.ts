// Imperative Three.js scene for a decoded model. React owns one instance via a ref.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { APPEARANCES, type AppearanceId } from '../core/appearances';
import { EDGE_STRIDE, FACE_STRIDE, faceTriangles, type Model, type Proto } from '../core/model';
import type { UnitId } from '../core/units';
import { Measure, type EdgePick, type FacePick, type MeasureMode, type Pick } from './measure';
import { isShown } from './objects';
import { boxUvs } from './boxUv';
import { applyExplode, explodeOffsets, type ExplodeItem } from './explode';
import { toGlb, toStl } from './export';
import { Finishes, FINISH_UVS } from './finishes';
import { PmiLayer } from './pmi';
import { ContactShadow, Effects } from './realistic';
import { buildSectionCaps, disposeCaps, sectionPlane, sectionPosition } from './section';
import { AxisTriad } from './AxisTriad';
import { ViewCube } from './ViewCube';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type Tool = 'select' | 'measure' | 'sectionFace'; // sectionFace: the next click picks the face to cut along
export type ViewName = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type DisplayStyle = 'shadedEdges' | 'shaded' | 'wireframe' | 'realistic';
export type Axis = 'x' | 'y' | 'z';
export interface Section {
  axis: Axis | 'face' | null;
  position: number; // 0..1 across the model bounds
  flip: boolean;
  normal?: [number, number, number]; // for 'face': the picked face's outward normal
}

export type UpAxis = 'x' | '-x' | 'y' | '-y' | 'z' | '-z';
const UP_AXES: Record<UpAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  '-x': new THREE.Vector3(-1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  '-y': new THREE.Vector3(0, -1, 0),
  z: new THREE.Vector3(0, 0, 1),
  '-z': new THREE.Vector3(0, 0, -1),
};

// The standard views, the ViewCube, the grid, the shadow and the lights are laid out Z-up, in the
// "upright" frame, which is turned so its Z is the chosen up axis (Z by default; the bridge converts
// Y-up mesh formats). Model coordinates are never changed.
const Z_UP = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SUN = new THREE.Vector3(-1, -1.5, 3); // from above, front left; a directional light only needs the direction

// Directions from the target towards the camera, in the upright frame.
const VIEW_DIRS: Record<ViewName, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1, 0.8),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 0, 1),
  bottom: new THREE.Vector3(0, 0, -1),
};
const AXES: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const DEFAULT_COLOR = new THREE.Color(0xb8bcc4);
// What an appearance shows on a part the file gives no colour.
const APPEARANCE_DEFAULT_COLOR = new THREE.Color(0xd2d5da);
const EDGE_COLOR = 0x1e2026;
export type Theme = 'dark' | 'light';
// Canvas colours per UI theme; wireframe edges alone must stand out against the background.
const THEMES: Record<Theme, { background: number; grid: [number, number]; wire: number; pmi: number }> = {
  dark: { background: 0x2a2d34, grid: [0x565b66, 0x3a3e46], wire: 0xc8ccd4, pmi: 0x4fb4ff },
  light: { background: 0xeef0f3, grid: [0xb4b9c2, 0xd4d8de], wire: 0x3a3e46, pmi: 0x1f78d1 },
};
// Light intensities; in the realistic style the environment adds light, so the lamps dim.
// The plain styles light from the camera, so every face towards you is lit; the realistic one lights
// mostly from a fixed overhead sun, so shape reads from shading as in a photo.
const LIGHTS = {
  plain: { key: 2.2, fill: 1.4, sun: 0, environment: 0 },
  realistic: { key: 0.35, fill: 0.1, sun: 3.2, environment: 0.35 },
};
const ANIMATION_MS = 300;
const CLICK_TOLERANCE_PX = 4;
const EDGE_PICK_PX = 6;

export class Viewer {
  onPick: (nodeId: number | null) => void = () => {};
  /** A planar face picked with the sectionFace tool: its outward normal and the section position through it. */
  onSectionFace: (normal: [number, number, number], position: number) => void = () => {};

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private controls: OrbitControls;
  private readonly light = new THREE.DirectionalLight(0xffffff, LIGHTS.plain.key);
  private readonly hemisphere = new THREE.HemisphereLight(0xffffff, 0x50545c, LIGHTS.plain.fill);
  private readonly sun = new THREE.DirectionalLight(0xffffff, LIGHTS.plain.sun);
  // Realistic style only, made on first use.
  private effects: Effects | null = null;
  private readonly background = new THREE.Color();
  private contactShadow: ContactShadow | null = null;
  // Reflections for PBR materials (glTF, appearances); plain CAD colours do without, as before.
  private readonly environment: THREE.Texture;
  private readonly finishes: Finishes;
  private readonly modelRoot = new THREE.Group();
  private readonly upright = new THREE.Quaternion(); // upright frame → world
  private readonly measure: Measure;
  private readonly clipPlane = new THREE.Plane();
  // Shared by all clipped materials; empty when the section is off. Caps are not clipped.
  private readonly clipping: THREE.Plane[] = [];
  private caps = new THREE.Group();
  private capMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly capOutline = new THREE.LineBasicMaterial({ color: 0x1e2026 });
  private readonly resizeObserver: ResizeObserver;
  private readonly cube: ViewCube;
  private readonly triad: AxisTriad;
  private readonly pmi = new PmiLayer();
  private readonly ghosts = new THREE.Group(); // translucent stand-ins for hidden parts
  private ghost = false;
  private grid: THREE.GridHelper | null = null;
  private gridVisible = false;

  private nodeObjects: THREE.Object3D[] = [];
  private meshes: THREE.Mesh[] = [];
  private edgeLines: THREE.LineSegments[] = [];
  private materials: THREE.Material[] = [];
  private appearanceMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
  private defaultMaterial: THREE.Material | null = null; // for parts the file gives no colour
  private explodeItems: ExplodeItem[] = [];
  private bounds = new THREE.Box3();
  private orthoHalfHeight = 1;
  private selected: number | null = null;
  private tool: Tool = 'select';
  private display: DisplayStyle = 'shadedEdges';
  private theme = THEMES.dark;
  private animation = 0;
  private renderQueued = false;
  private pointerDown: { x: number; y: number } | null = null;
  private readonly pointers = new Set<number>();
  private rotateFrom: { x: number; y: number } | null = null;

  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  private readonly ghostMaterial = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly highlight = new THREE.MeshStandardMaterial({
    color: 0xff7d2d,
    emissive: 0x4a240d,
    roughness: 0.5,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.localClippingEnabled = true;
    this.finishes = new Finishes(this.renderer.capabilities.getMaxAnisotropy());
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.edgeMaterial.clippingPlanes = this.clipping;
    this.highlight.clippingPlanes = this.clipping;
    this.ghostMaterial.clippingPlanes = this.clipping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = this.background.set(this.theme.background);
    this.pmi.setColor(this.theme.pmi);
    this.perspective.up.copy(Z_UP);
    this.ortho.up.copy(Z_UP);
    this.scene.add(this.hemisphere);
    this.scene.add(this.sun);
    this.scene.add(this.camera);
    this.camera.add(this.light);
    this.light.position.set(0.5, 1, 1);
    this.scene.add(this.modelRoot);
    this.scene.add(this.caps);
    this.scene.add(this.ghosts);

    this.controls = this.createControls();

    this.measure = new Measure(this.scene, container);
    this.measure.onChange = this.requestRender;
    this.cube = new ViewCube(container, VIEW_DIRS.iso, (dir) => this.standardView(dir, this.visibleBounds(), true));
    this.triad = new AxisTriad(container);
    this.setUpAxis('z');

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => (this.pointerDown = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', this.handleClick);
    canvas.addEventListener('pointermove', this.handleHover);
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener('pointerdown', this.handleRotateStart);
    canvas.addEventListener('pointermove', this.handleRotate);
    canvas.addEventListener('pointerup', this.handleRotateEnd);
    canvas.addEventListener('pointercancel', this.handleRotateEnd);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.clear();
    this.controls.dispose();
    this.measure.dispose();
    this.cube.dispose();
    this.triad.dispose();
    this.pmi.dispose();
    this.capOutline.dispose();
    this.ghostMaterial.dispose();
    this.environment.dispose();
    this.effects?.dispose();
    this.contactShadow?.dispose();
    this.finishes.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------------------
  // Model

  load(model: Model): void {
    this.clear();

    this.materials = model.colors.map(([r, g, b, a], i) => {
      const fromFile = model.materials?.[i];
      return fromFile ? this.adoptMaterial(fromFile) : this.makeMaterial(new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), a);
    });
    const defaultMaterial = (this.defaultMaterial = this.makeMaterial(DEFAULT_COLOR, 1));
    this.materials.push(defaultMaterial);
    const material = (color: number) => (color >= 0 ? this.materials[color] : defaultMaterial);

    const geometries = model.protos.map((p) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
      g.setIndex(new THREE.BufferAttribute(p.indices, 1));
      for (const [set, uvs] of Object.entries(p.uvs ?? {})) g.setAttribute(set, new THREE.BufferAttribute(uvs, 2));
      if (p.vertexColors) g.setAttribute('color', new THREE.BufferAttribute(p.vertexColors.array, p.vertexColors.itemSize));
      p.groups.forEach((grp, i) => g.addGroup(grp.start, grp.count, i));
      // Indirect: keep the index order, which faceStarts refers to.
      g.computeBoundsTree({ indirect: true });
      const e = new THREE.BufferGeometry();
      e.setAttribute('position', new THREE.BufferAttribute(p.edges, 3));
      return { faces: g, edges: e };
    });

    const build = (id: number, parent: THREE.Object3D, inheritedColor: number) => {
      const node = model.nodes[id];
      const obj = new THREE.Group();
      obj.name = node.name;
      if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(obj.position, obj.quaternion, obj.scale);
      parent.add(obj);
      this.nodeObjects[id] = obj;

      const color = node.color >= 0 ? node.color : inheritedColor;
      if (node.proto >= 0) {
        const proto = model.protos[node.proto];
        const mats = proto.groups.map((g) => material(g.color >= 0 ? g.color : color));
        const mesh = new THREE.Mesh(geometries[node.proto].faces, mats.length === 1 ? mats[0] : mats);
        mesh.userData = { nodeId: id, baseMaterial: mesh.material, fileMaterial: mesh.material, proto };
        obj.add(mesh);
        this.meshes.push(mesh);

        const lines = new THREE.LineSegments(geometries[node.proto].edges, this.edgeMaterial);
        lines.raycast = () => {}; // picked explicitly in pickEdge()
        lines.userData = { proto };
        obj.add(lines);
        this.edgeLines.push(lines);
      }
      node.children.forEach((c) => build(c, obj, color));
    };
    model.roots.forEach((r) => build(r, this.modelRoot, -1));

    this.modelRoot.updateMatrixWorld(true);
    this.bounds.setFromObject(this.modelRoot);
    this.explodeItems = explodeOffsets(new Set(this.meshes.map((m) => m.parent!)), this.bounds.getCenter(new THREE.Vector3()));
    this.pmi.build(model, this.nodeObjects, this.modelRoot); // after the bounds: PMI does not count for fitting
    this.addGrid();
    this.setDisplayStyle(this.display);
    this.standardView(VIEW_DIRS.iso, this.bounds, false);
    this.cube.setVisible(true);
    this.triad.setVisible(true);
  }

  // Settings every part material shares: both sides (open shells, section cuts), pushed back so edge
  // lines draw on top without z-fighting, and clipped by the section.
  private surface<T extends THREE.Material>(m: T): T {
    return Object.assign(m, {
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      clippingPlanes: this.clipping,
      visible: this.display !== 'wireframe',
    });
  }

  private makeMaterial(color: THREE.Color, alpha: number): THREE.MeshStandardMaterial {
    return this.surface(
      new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.55, transparent: alpha < 1, opacity: alpha }),
    );
  }

  // A material read from the file (glTF), made reflective.
  private adoptMaterial(source: THREE.Material): THREE.Material {
    const m = this.surface(source.clone());
    if (m instanceof THREE.MeshStandardMaterial && !m.envMap) m.envMap = this.environment;
    return m;
  }

  // An appearance on a part whose file material is `file`: shared by all parts with both alike.
  private appearanceMaterial(id: AppearanceId, file: THREE.Material): THREE.MeshPhysicalMaterial {
    const key = `${id}:${file.uuid}`;
    let m = this.appearanceMaterials.get(key);
    if (!m) {
      const a = APPEARANCES[id];
      const partColor =
        file !== this.defaultMaterial && 'color' in file && file.color instanceof THREE.Color ? file.color : APPEARANCE_DEFAULT_COLOR;
      const maps = a.finish ? this.finishes.get(a.finish) : undefined;
      m = this.surface(
        new THREE.MeshPhysicalMaterial({
          ...maps,
          // Tints a colour texture (carbon, wood) too.
          color: a.color ? new THREE.Color().setRGB(...a.color, THREE.SRGBColorSpace) : partColor,
          metalness: a.metalness,
          roughness: a.roughness,
          clearcoat: a.clearcoat ?? 0,
          clearcoatRoughness: 0.1,
          envMap: this.environment,
          // The scene lights already light diffuse surfaces; the environment is mostly for reflections.
          envMapIntensity: 0.35 + 0.65 * a.metalness,
          transparent: file.transparent,
          opacity: file.opacity,
        }),
      );
      this.appearanceMaterials.set(key, m);
    }
    return m;
  }

  /** Give each part the appearance `appearanceOf` its node, or its file material for undefined. */
  setAppearances(appearanceOf: (nodeId: number) => AppearanceId | undefined): void {
    for (const mesh of this.meshes) {
      const file = mesh.userData.fileMaterial as THREE.Material | THREE.Material[];
      const id = appearanceOf(mesh.userData.nodeId);
      // Finishes are mapped by box UVs, made once per prototype the first time one needs them.
      const { geometry } = mesh;
      if (id && APPEARANCES[id].finish && !geometry.hasAttribute(FINISH_UVS)) {
        const uvs = boxUvs(geometry.getAttribute('position').array, geometry.getAttribute('normal').array);
        geometry.setAttribute(FINISH_UVS, new THREE.BufferAttribute(uvs, 2));
      }
      const base = !id ? file : Array.isArray(file) ? file.map((f) => this.appearanceMaterial(id, f)) : this.appearanceMaterial(id, file);
      if (mesh.material !== this.highlight) mesh.material = base;
      mesh.userData.baseMaterial = base;
    }
    this.updateCaps(); // cut faces take the part colours
    this.requestRender();
  }

  /** Remove the model and release its GPU and JS memory. */
  clear(): void {
    cancelAnimationFrame(this.animation);
    this.clearCaps();
    this.capMaterials.forEach((m) => m.dispose());
    this.capMaterials.clear();
    const geometries = new Set<THREE.BufferGeometry>();
    this.modelRoot.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) geometries.add(o.geometry);
    });
    geometries.forEach((g) => {
      g.disposeBoundsTree?.();
      g.dispose();
    });
    this.materials.forEach((m) => {
      // Textures of file materials (the environment is the viewer's own).
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && v !== this.environment) v.dispose();
      m.dispose();
    });
    this.appearanceMaterials.forEach((m) => m.dispose());
    this.appearanceMaterials.clear();
    this.removeGrid();
    this.ghosts.clear();
    this.modelRoot.clear();
    this.nodeObjects = [];
    this.meshes = [];
    this.edgeLines = [];
    this.materials = [];
    this.defaultMaterial = null;
    this.explodeItems = [];
    this.selected = null;
    this.bounds.makeEmpty();
    this.measure.clear();
    this.pmi.clear();
    this.cube.setVisible(false);
    this.triad.setVisible(false);
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Display state

  setHidden(hidden: ReadonlySet<number>): void {
    this.nodeObjects.forEach((o, id) => (o.visible = !hidden.has(id)));
    this.updateGhosts();
    this.updateCaps();
    this.updateRealistic();
    this.requestRender();
  }

  /** Move parts apart: 0 assembled, 1 fully exploded. The section keeps the assembled bounds. */
  setExplode(amount: number): void {
    applyExplode(this.explodeItems, amount);
    this.modelRoot.updateMatrixWorld(true);
    this.measure.clear(); // measured where the parts were
    this.updateGhosts();
    this.updateCaps();
    this.updateRealistic();
    this.requestRender();
  }

  /** Draw hidden parts as translucent ghosts, for context; they cannot be picked or measured. */
  setGhost(on: boolean): void {
    this.ghost = on;
    this.updateGhosts();
    this.requestRender();
  }

  // Ghosts share the parts' geometry and copy their placement; hidden parts themselves stay invisible.
  private updateGhosts(): void {
    this.ghosts.clear();
    if (!this.ghost) return;
    for (const m of this.meshes) {
      if (isShown(m)) continue;
      const g = new THREE.Mesh(m.geometry, this.ghostMaterial);
      g.matrixAutoUpdate = false;
      g.matrix.copy(m.matrixWorld);
      g.raycast = () => {};
      this.ghosts.add(g);
    }
  }

  setDisplayStyle(style: DisplayStyle): void {
    this.display = style;
    const faces = style !== 'wireframe';
    // Invisible materials are still raycast, so wireframe parts stay pickable.
    for (const m of [...this.materials, ...this.appearanceMaterials.values()]) m.visible = faces;
    this.edgeLines.forEach((l) => (l.visible = style === 'shadedEdges' || style === 'wireframe'));
    this.edgeMaterial.color.set(faces ? EDGE_COLOR : this.theme.wire);
    this.setRealistic(style === 'realistic');
    this.updateCaps();
    this.requestRender();
  }

  // Tone mapping, environment light, ambient occlusion and a contact shadow, for a photographic look.
  private setRealistic(on: boolean): void {
    if (on && !this.effects) {
      this.effects = new Effects(this.renderer, this.scene, this.camera, this.clipping, () => [
        this.ghosts,
        this.caps,
        ...this.pmi.all,
        ...this.measure.objects,
        ...(this.grid ? [this.grid] : []),
        ...(this.contactShadow ? [this.contactShadow.mesh] : []),
      ]);
      this.effects.setBackground(this.theme.background);
      this.contactShadow = new ContactShadow();
      this.scene.add(this.contactShadow.mesh);
      this.resize();
    }
    const lights = on ? LIGHTS.realistic : LIGHTS.plain;
    this.light.intensity = lights.key;
    this.hemisphere.intensity = lights.fill;
    this.sun.intensity = lights.sun;
    this.scene.environment = on ? this.environment : null;
    this.scene.environmentIntensity = lights.environment;
    this.scene.background = on ? null : this.background; // the effects composite it untouched
    this.renderer.toneMapping = on ? THREE.NeutralToneMapping : THREE.NoToneMapping;
    this.contactShadow?.setVisible(on);
    this.updateRealistic();
  }

  // The contact shadow and the occlusion radius follow what is shown, not the camera.
  private updateRealistic(): void {
    if (this.display !== 'realistic' || !this.effects || !this.contactShadow) return;
    const bounds = this.visibleBounds();
    this.contactShadow.update(this.renderer, this.modelRoot, this.toUpright(bounds), this.upright, this.pmi.all);
    this.effects.setOcclusionRadius(0.04 * bounds.getSize(new THREE.Vector3()).length());
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // PMI

  setPmi(visible: boolean, hidden: ReadonlySet<number>): void {
    this.pmi.setVisible(visible, hidden);
    this.requestRender();
  }

  selectPmi(index: number | null): void {
    this.pmi.select(index);
    this.requestRender();
  }

  /** Look along a saved view's direction at the model and the PMI shown. */
  lookAlong(direction: readonly [number, number, number], up: readonly [number, number, number], animate = true): void {
    const box = this.visibleBounds().union(this.pmi.visibleBounds());
    this.frame(new THREE.Vector3(...direction).negate(), box, animate, new THREE.Vector3(...up));
  }

  setTheme(theme: Theme): void {
    this.theme = THEMES[theme];
    this.background.set(this.theme.background);
    this.effects?.setBackground(this.theme.background);
    if (this.display === 'wireframe') this.edgeMaterial.color.set(this.theme.wire);
    this.pmi.setColor(this.theme.pmi);
    // GridHelper bakes its colours into the geometry: rebuild it.
    if (this.grid) {
      this.removeGrid();
      this.addGrid();
    }
    this.requestRender();
  }

  /** Which model axis points up in the standard views, the ViewCube, the grid and the shadow. */
  setUpAxis(axis: UpAxis): void {
    this.upright.setFromUnitVectors(Z_UP, UP_AXES[axis]);
    this.sun.position.copy(SUN).applyQuaternion(this.upright);
    // The sky side, which three.js puts at +Y (the back) by default; kept relative to the upright frame.
    this.hemisphere.position.copy(Y_AXIS).applyQuaternion(this.upright);
    if (this.grid) {
      this.removeGrid();
      this.addGrid();
    }
    this.updateRealistic();
    if (!this.bounds.isEmpty()) this.setView('iso');
    this.requestRender();
  }

  /** A world box in the upright frame; exact, as the frame turns in quarter turns. */
  private toUpright(box: THREE.Box3): THREE.Box3 {
    return box.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.upright.clone().invert()));
  }

  private addGrid(): void {
    this.grid = makeGrid(this.toUpright(this.bounds), this.upright, this.theme.grid);
    this.grid.visible = this.gridVisible;
    this.scene.add(this.grid);
  }

  private removeGrid(): void {
    if (!this.grid) return;
    this.scene.remove(this.grid);
    this.grid.dispose();
    this.grid = null;
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    if (this.grid) this.grid.visible = visible;
    this.requestRender();
  }

  select(nodeId: number | null): void {
    const apply = (id: number | null, on: boolean) => {
      if (id === null) return;
      this.nodeObjects[id]?.traverse((o) => {
        // Part meshes only: PMI meshes hang under the same nodes with their own materials.
        if (o instanceof THREE.Mesh && o.userData.baseMaterial) o.material = on ? this.highlight : o.userData.baseMaterial;
      });
    };
    apply(this.selected, false);
    this.selected = nodeId;
    apply(nodeId, true);
    this.requestRender();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool !== 'measure') this.measure.clear();
    this.setHover(null);
    this.requestRender();
  }

  clearMeasurements(): void {
    this.measure.clear();
    this.requestRender();
  }

  /** Remove the measurement being picked, else the last one. */
  undoMeasurement(): void {
    this.measure.undo();
    this.requestRender();
  }

  setMeasureMode(mode: MeasureMode): void {
    this.measure.setMode(mode);
    this.requestRender();
  }

  setUnit(unit: UnitId): void {
    this.measure.setUnit(unit);
    this.requestRender();
  }

  setSection({ axis, position, flip, normal }: Section): void {
    this.clipping.length = 0;
    const dir = axis === 'face' ? normal && new THREE.Vector3(...normal) : axis && AXES[axis];
    if (dir && !this.bounds.isEmpty()) {
      this.clipPlane.copy(sectionPlane(this.bounds, dir, position, flip));
      this.clipping.push(this.clipPlane);
    }
    this.updateCaps();
    this.requestRender();
  }

  // Solid-looking cut: fill each visible part's cross-section with its own colour.
  private updateCaps(): void {
    this.clearCaps();
    if (!this.clipping.length || this.display === 'wireframe') return;
    this.caps = buildSectionCaps(this.meshes.filter(isShown), this.clipPlane, {
      material: (mesh) => this.capMaterial(mesh),
      outline: this.capOutline,
    });
    this.scene.add(this.caps);
  }

  private clearCaps(): void {
    disposeCaps(this.caps);
    this.scene.remove(this.caps);
    this.caps = new THREE.Group();
  }

  private capMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
    const base = mesh.userData.baseMaterial as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const color = (Array.isArray(base) ? base[0] : base).color;
    const key = color.getHex();
    let m = this.capMaterials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
      this.capMaterials.set(key, m);
    }
    return m;
  }

  // ---------------------------------------------------------------------------
  // Camera

  setView(view: ViewName): void {
    this.standardView(VIEW_DIRS[view], this.visibleBounds(), true);
  }

  // Look from `dir` in the upright frame with its Z up on screen.
  private standardView(dir: THREE.Vector3, box: THREE.Box3, animate: boolean): void {
    this.frame(dir.clone().applyQuaternion(this.upright), box, animate, Z_UP.clone().applyQuaternion(this.upright));
  }

  /** Fit the visible geometry while keeping the current viewing direction. */
  fit(): void {
    this.frame(this.viewDir(), this.visibleBounds(), true);
  }

  /** Fit the selected node, or everything visible when nothing is selected. */
  fitSelection(): void {
    const node = this.selected === null ? undefined : this.nodeObjects[this.selected];
    const box = node ? new THREE.Box3().setFromObject(node) : new THREE.Box3();
    this.frame(this.viewDir(), box.isEmpty() ? this.visibleBounds() : box, true);
  }

  private viewDir(): THREE.Vector3 {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }

  // OrbitControls pan and zoom; rotation is our own (below) because theirs stops at the poles.
  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableRotate = false;
    controls.addEventListener('change', this.requestRender);
    controls.addEventListener('start', () => cancelAnimationFrame(this.animation));
    return controls;
  }

  // Free rotation about the screen axes through the target, so the model tumbles over the poles.
  // Left drag without modifiers (those pan) and with one pointer (two pinch and pan).
  private handleRotateStart = (e: PointerEvent): void => {
    this.pointers.add(e.pointerId);
    const free = e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && this.pointers.size === 1;
    this.rotateFrom = free ? { x: e.clientX, y: e.clientY } : null;
    if (free) cancelAnimationFrame(this.animation);
  };

  private handleRotate = (e: PointerEvent): void => {
    if (!this.rotateFrom || this.pointers.size !== 1) return;
    const k = (2 * Math.PI) / this.container.clientHeight; // a full turn per viewport height, as OrbitControls
    const dx = (e.clientX - this.rotateFrom.x) * k;
    const dy = (e.clientY - this.rotateFrom.y) * k;
    this.rotateFrom = { x: e.clientX, y: e.clientY };
    const q = this.camera.quaternion;
    const turn = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0).applyQuaternion(q), -dx)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0).applyQuaternion(q), -dy));
    const { target } = this.controls;
    this.camera.position.sub(target).applyQuaternion(turn).add(target);
    this.camera.up.applyQuaternion(turn);
    this.controls.update();
  };

  private handleRotateEnd = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.rotateFrom = null;
  };

  // Look at the box from `dir` (target towards camera), optionally turning and zooming there smoothly.
  // `up` is the world direction to show up on screen (the up axis for the standard views); omitted keeps the current one.
  private frame(direction: THREE.Vector3, box: THREE.Box3, animate = false, up?: THREE.Vector3): void {
    cancelAnimationFrame(this.animation);
    const dir = direction.clone().normalize();
    const upDir = up?.clone() ?? this.camera.up.clone();
    // Looking along the up axis: show the upright +Y up from above and -Y from below, as the ViewCube labels.
    if (Math.abs(upDir.clone().normalize().dot(dir)) > 0.9999)
      upDir.copy(Y_AXIS).applyQuaternion(this.upright).multiplyScalar(Math.sign(upDir.dot(dir)));

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-3);
    const distance = r / Math.sin(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    for (const cam of [this.perspective, this.ortho]) {
      cam.near = distance / 100;
      cam.far = distance * 100;
    }
    this.controls.maxDistance = distance * 20;

    const from = {
      orientation: this.camera.quaternion.clone(),
      target: this.controls.target.clone(),
      distance: this.camera.position.distanceTo(this.controls.target),
      halfHeight: this.orthoHalfHeight / this.ortho.zoom,
    };
    const to = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), upDir));
    const t0 = performance.now();
    const step = (now: number) => {
      const t = animate ? Math.min((now - t0) / ANIMATION_MS, 1) : 1;
      const k = t * t * (3 - 2 * t); // ease in-out
      const q = from.orientation.clone().slerp(to, k);
      const d = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const target = from.target.clone().lerp(sphere.center, k);
      const dist = THREE.MathUtils.lerp(from.distance, distance, k);
      for (const cam of [this.perspective, this.ortho]) {
        cam.position.copy(target).addScaledVector(d, dist);
        cam.up.set(0, 1, 0).applyQuaternion(q);
      }
      this.ortho.zoom = 1;
      this.orthoHalfHeight = THREE.MathUtils.lerp(from.halfHeight, r * 1.05, k);
      this.controls.target.copy(target);
      this.resize();
      this.controls.update();
      if (t < 1) this.animation = requestAnimationFrame(step);
    };
    step(t0);
  }

  setOrthographic(on: boolean): void {
    const next = on ? this.ortho : this.perspective;
    if (next === this.camera) return;
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    next.up.copy(this.camera.up);
    if (on) {
      // Match the perspective view's apparent size at the target.
      const d = this.camera.position.distanceTo(this.controls.target);
      this.orthoHalfHeight = d * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      this.ortho.zoom = 1;
    }
    this.camera.remove(this.light);
    this.scene.remove(this.camera);
    this.camera = next;
    this.effects?.setCamera(next);
    this.scene.add(next);
    next.add(this.light);
    this.controls.object = next;
    this.resize();
    this.controls.update();
  }

  private visibleBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const m of this.meshes) if (isShown(m)) box.expandByObject(m);
    return box.isEmpty() ? this.bounds.clone() : box;
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.effects?.setSize(w, h, this.renderer.getPixelRatio());
    const aspect = w / h;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const hh = this.orthoHalfHeight;
    Object.assign(this.ortho, { left: -hh * aspect, right: hh * aspect, top: hh, bottom: -hh });
    this.ortho.updateProjectionMatrix();
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Picking

  private handleClick = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE_PX) return;

    const hit = this.raycast(e.clientX, e.clientY);
    if (this.tool === 'sectionFace') {
      const plane = hit && this.pickFace(hit)?.plane;
      if (plane) this.onSectionFace(plane.normal.toArray(), sectionPosition(this.bounds, plane.normal, hit.point));
    } else if (this.tool === 'measure') {
      const pick = this.pick(this.measure.pickKind, hit, e);
      if (pick) this.measure.add(pick);
    } else {
      this.onPick(hit ? (hit.object.userData.nodeId as number) : null);
    }
    this.requestRender();
  };

  // Highlight the edge or face a click would pick; points get no preview.
  private handleHover = (e: PointerEvent): void => {
    const kind = this.tool === 'sectionFace' ? 'face' : this.tool === 'measure' ? this.measure.pickKind : null;
    if (!kind || kind === 'point' || e.buttons) return this.setHover(null);
    this.setHover(this.pick(kind, this.raycast(e.clientX, e.clientY), e));
  };

  private setHover(pick: Pick | null): void {
    if (this.measure.setHover(pick)) this.requestRender();
  }

  private raycaster(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster;
  }

  private raycast(clientX: number, clientY: number): THREE.Intersection | undefined {
    return this.raycaster(clientX, clientY)
      .intersectObjects(this.meshes.filter(isShown), false)
      .find((h) => this.unclipped(h.point));
  }

  private unclipped(p: THREE.Vector3, tolerance = 0): boolean {
    return !this.clipping.length || this.clipPlane.distanceToPoint(p) >= -tolerance;
  }

  private pick(kind: Pick['kind'], hit: THREE.Intersection | undefined, e: PointerEvent): Pick | null {
    if (kind === 'edge') return this.pickEdge(e, hit);
    if (!hit) return null;
    return kind === 'face' ? this.pickFace(hit) : { kind: 'point', point: this.snap(hit, e) };
  }

  // The B-rep face containing the hit triangle.
  private pickFace(hit: THREE.Intersection): FacePick | null {
    const mesh = hit.object as THREE.Mesh;
    const proto = mesh.userData.proto as Proto;
    if (hit.faceIndex == null || !proto.faceStarts.length) return null;
    const f = lastAtOrBelow(proto.faceStarts, hit.faceIndex * 3);
    const m = mesh.matrixWorld;
    const triangles = faceTriangles(proto, [f]);
    new THREE.BufferAttribute(triangles, 3).applyMatrix4(m);

    let plane: THREE.Plane | null = null;
    const d = proto.faceData.subarray(f * FACE_STRIDE, (f + 1) * FACE_STRIDE);
    if (d[0] === 1) {
      const origin = new THREE.Vector3(d[1], d[2], d[3]).applyMatrix4(m);
      const normal = new THREE.Vector3(d[4], d[5], d[6]).applyMatrix3(new THREE.Matrix3().getNormalMatrix(m)).normalize();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    }
    return { kind: 'face', point: hit.point.clone(), triangles, plane };
  }

  // The visible B-rep edge nearest the cursor, within a few pixels.
  private pickEdge(e: PointerEvent, meshHit: THREE.Intersection | undefined): EdgePick | null {
    const raycaster = this.raycaster(e.clientX, e.clientY);
    // Wireframe shows hidden edges, so faces must not hide them from picking either.
    const occluder = this.display === 'wireframe' ? undefined : meshHit;
    const depth = occluder?.distance ?? this.camera.position.distanceTo(this.controls.target);
    const threshold = EDGE_PICK_PX * this.worldPerPixel(depth);
    raycaster.params.Line = { threshold };

    const hits: THREE.Intersection[] = [];
    for (const lines of this.edgeLines) {
      if (lines.parent && isShown(lines.parent)) THREE.LineSegments.prototype.raycast.call(lines, raycaster, hits);
    }
    let best: THREE.Intersection | undefined;
    let bestRay = Infinity;
    for (const h of hits) {
      // Skip edges hidden behind the surface under the cursor, or cut away by the section.
      if (occluder && h.distance > occluder.distance + 4 * threshold) continue;
      if (!this.unclipped(h.point, threshold)) continue;
      const ray = raycaster.ray.distanceSqToPoint(h.point);
      if (ray < bestRay) {
        bestRay = ray;
        best = h;
      }
    }
    if (!best || best.index == null) return null;

    const lines = best.object as THREE.LineSegments;
    const proto = lines.userData.proto as Proto;
    const i = lastAtOrBelow(proto.edgeStarts, best.index / 2);
    const start = proto.edgeStarts[i] * 6;
    const end = (proto.edgeStarts[i + 1] ?? proto.edges.length / 6) * 6;
    const m = lines.matrixWorld;
    const v = new THREE.Vector3();
    const segments = new Float32Array(end - start);
    for (let k = start; k < end; k += 3) v.fromArray(proto.edges, k).applyMatrix4(m).toArray(segments, k - start);

    const d = proto.edgeData.subarray(i * EDGE_STRIDE, (i + 1) * EDGE_STRIDE);
    return {
      kind: 'edge',
      point: best.point.clone(),
      segments,
      curve: d[0] === 1 ? 'line' : d[0] === 2 ? 'circle' : 'other',
      length: d[1],
      radius: d[2],
      center: new THREE.Vector3(d[3], d[4], d[5]).applyMatrix4(m),
      axis: new THREE.Vector3(d[6], d[7], d[8]).transformDirection(m),
    };
  }

  // World-space size of one screen pixel at the given distance from the camera.
  private worldPerPixel(distance: number): number {
    const h = this.renderer.domElement.clientHeight || 1;
    if (this.camera instanceof THREE.OrthographicCamera) return (this.camera.top - this.camera.bottom) / this.camera.zoom / h;
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
  }

  // Snap to the nearest vertex of the hit triangle when it is close on screen.
  private snap(hit: THREE.Intersection, e: PointerEvent): THREE.Vector3 {
    if (!hit.face) return hit.point;
    const mesh = hit.object as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position');
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best = hit.point;
    let bestPx = 10;
    for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const s = v.clone().project(this.camera);
      const px = Math.hypot(((s.x + 1) / 2) * rect.width + rect.left - e.clientX, ((1 - s.y) / 2) * rect.height + rect.top - e.clientY);
      if (px < bestPx) {
        bestPx = px;
        best = v;
      }
    }
    return best.clone();
  }

  /** The shown parts, as placed now (exploded too), without PMI. */
  exportModel(format: 'stl' | 'glb'): Promise<Blob> {
    const shown = this.meshes.filter(isShown);
    return format === 'stl' ? Promise.resolve(toStl(shown)) : toGlb(shown, this.upright);
  }

  /** The current view as a PNG: the canvas only, without the HTML overlays (ViewCube, axes, labels). */
  screenshot(): Promise<Blob> {
    // The drawing buffer is readable until the browser composites it, so render and capture in one task.
    this.draw();
    return new Promise((resolve, reject) =>
      this.renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not capture the view'))), 'image/png'),
    );
  }

  // ---------------------------------------------------------------------------
  // Rendering (on demand)

  private draw(): void {
    if (this.display === 'realistic' && this.effects) this.effects.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private requestRender = (): void => {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.draw();
      this.cube.update(this.upright.clone().invert().multiply(this.camera.quaternion));
      this.triad.update(this.camera);
      this.measure.updateLabel(this.camera, this.renderer.domElement);
    });
  };
}

// Index of the last element <= value in an ascending array (value >= sorted[0]).
function lastAtOrBelow(sorted: Uint32Array, value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Ground grid just below the model, 10–100 cells across with a round cell size (1, 10, 100… model units).
// `bounds` are in the upright frame, which `upright` turns to world.
function makeGrid(bounds: THREE.Box3, upright: THREE.Quaternion, [centerColor, lineColor]: [number, number]): THREE.GridHelper {
  const size = bounds.getSize(new THREE.Vector3());
  const extent = 2 * Math.max(size.x, size.y, 1e-3);
  const cell = 10 ** Math.floor(Math.log10(extent / 10));
  const divisions = 2 * Math.ceil(extent / cell / 2); // even, so a grid line runs through the centre
  const grid = new THREE.GridHelper(divisions * cell, divisions, centerColor, lineColor);
  grid.rotation.x = Math.PI / 2; // GridHelper lies in XZ; the upright frame is Z-up
  grid.quaternion.premultiply(upright);
  const center = bounds.getCenter(new THREE.Vector3());
  grid.position.set(center.x, center.y, bounds.min.z - extent * 1e-4).applyQuaternion(upright); // below the bottom faces, no z-fighting
  grid.raycast = () => {};
  return grid;
}
