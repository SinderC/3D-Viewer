// Imperative Three.js scene for a decoded STEP model. React owns one instance via a ref.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { Model } from '../core/model';
import { Measure } from './measure';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type Tool = 'select' | 'measure';
export type ViewName = 'iso' | 'front' | 'top' | 'right';
export type Axis = 'x' | 'y' | 'z';
export interface Section {
  axis: Axis | null;
  position: number; // 0..1 across the model bounds
  flip: boolean;
}

// STEP models are Z-up.
const VIEW_DIRS: Record<ViewName, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1, 0.8).normalize(),
  front: new THREE.Vector3(0, -1, 0),
  top: new THREE.Vector3(0, -1e-4, 1).normalize(),
  right: new THREE.Vector3(1, 0, 0),
};
const AXES: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const DEFAULT_COLOR = new THREE.Color(0xb8bcc4);
const CLICK_TOLERANCE_PX = 4;

export class Viewer {
  onPick: (nodeId: number | null) => void = () => {};

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly controls: OrbitControls;
  private readonly light = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly modelRoot = new THREE.Group();
  private readonly measure: Measure;
  private readonly clipPlane = new THREE.Plane();
  private readonly resizeObserver: ResizeObserver;

  private nodeObjects: THREE.Object3D[] = [];
  private meshes: THREE.Mesh[] = [];
  private edgeLines: THREE.LineSegments[] = [];
  private materials: THREE.Material[] = [];
  private bounds = new THREE.Box3();
  private orthoHalfHeight = 1;
  private selected: number | null = null;
  private tool: Tool = 'select';
  private edgesVisible = true;
  private renderQueued = false;
  private pointerDown: { x: number; y: number } | null = null;

  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: 0x1e2026 });
  private readonly highlight = new THREE.MeshStandardMaterial({
    color: 0x5aa9ff,
    emissive: 0x123a66,
    roughness: 0.5,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x2a2d34);
    this.perspective.up.set(0, 0, 1);
    this.ortho.up.set(0, 0, 1);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50545c, 1.4));
    this.scene.add(this.camera);
    this.camera.add(this.light);
    this.light.position.set(0.5, 1, 1);
    this.scene.add(this.modelRoot);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', this.requestRender);

    this.measure = new Measure(this.scene, container);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => (this.pointerDown = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', this.handleClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.clear();
    this.controls.dispose();
    this.measure.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------------------
  // Model

  load(model: Model): void {
    this.clear();

    this.materials = model.colors.map(([r, g, b, a]) => this.makeMaterial(new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), a));
    const defaultMaterial = this.makeMaterial(DEFAULT_COLOR, 1);
    this.materials.push(defaultMaterial);
    const material = (color: number) => (color >= 0 ? this.materials[color] : defaultMaterial);

    const geometries = model.protos.map((p) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
      g.setIndex(new THREE.BufferAttribute(p.indices, 1));
      p.groups.forEach((grp, i) => g.addGroup(grp.start, grp.count, i));
      g.computeBoundsTree();
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
        mesh.userData = { nodeId: id, baseMaterial: mesh.material };
        obj.add(mesh);
        this.meshes.push(mesh);

        const lines = new THREE.LineSegments(geometries[node.proto].edges, this.edgeMaterial);
        lines.visible = this.edgesVisible;
        lines.raycast = () => {};
        obj.add(lines);
        this.edgeLines.push(lines);
      }
      node.children.forEach((c) => build(c, obj, color));
    };
    model.roots.forEach((r) => build(r, this.modelRoot, -1));

    this.modelRoot.updateMatrixWorld(true);
    this.bounds.setFromObject(this.modelRoot);
    this.measure.setUnit(model.unit);
    this.setView('iso');
  }

  private makeMaterial(color: THREE.Color, alpha: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.05,
      roughness: 0.55,
      side: THREE.DoubleSide, // open shells and section cuts
      transparent: alpha < 1,
      opacity: alpha,
      // Push faces back so edge lines draw on top without z-fighting.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  }

  private clear(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    this.modelRoot.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) geometries.add(o.geometry);
    });
    geometries.forEach((g) => {
      g.disposeBoundsTree?.();
      g.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.modelRoot.clear();
    this.nodeObjects = [];
    this.meshes = [];
    this.edgeLines = [];
    this.materials = [];
    this.selected = null;
    this.measure.clear();
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Display state

  setHidden(hidden: ReadonlySet<number>): void {
    this.nodeObjects.forEach((o, id) => (o.visible = !hidden.has(id)));
    this.requestRender();
  }

  setEdgesVisible(visible: boolean): void {
    this.edgesVisible = visible;
    this.edgeLines.forEach((l) => (l.visible = visible));
    this.requestRender();
  }

  select(nodeId: number | null): void {
    const apply = (id: number | null, on: boolean) => {
      if (id === null) return;
      this.nodeObjects[id]?.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = on ? this.highlight : o.userData.baseMaterial;
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
    this.requestRender();
  }

  setSection({ axis, position, flip }: Section): void {
    if (!axis || this.bounds.isEmpty()) {
      this.renderer.clippingPlanes = [];
    } else {
      const n = AXES[axis].clone().multiplyScalar(flip ? 1 : -1);
      const at = this.bounds.min.clone().lerp(this.bounds.max, position);
      this.clipPlane.setFromNormalAndCoplanarPoint(n, at);
      this.renderer.clippingPlanes = [this.clipPlane];
    }
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Camera

  setView(view: ViewName): void {
    const sphere = this.visibleBounds().getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-3);
    const distance = r / Math.sin(THREE.MathUtils.degToRad(this.perspective.fov / 2));

    for (const cam of [this.perspective, this.ortho]) {
      cam.position.copy(sphere.center).addScaledVector(VIEW_DIRS[view], distance);
      cam.near = distance / 100;
      cam.far = distance * 100;
    }
    this.ortho.zoom = 1;
    this.orthoHalfHeight = r * 1.05;
    this.controls.target.copy(sphere.center);
    this.controls.maxDistance = distance * 20;
    this.resize();
    this.controls.update();
  }

  setOrthographic(on: boolean): void {
    const next = on ? this.ortho : this.perspective;
    if (next === this.camera) return;
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    if (on) {
      // Match the perspective view's apparent size at the target.
      const d = this.camera.position.distanceTo(this.controls.target);
      this.orthoHalfHeight = d * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      this.ortho.zoom = 1;
    }
    this.camera.remove(this.light);
    this.scene.remove(this.camera);
    this.camera = next;
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
    if (this.tool === 'measure') {
      if (hit) this.measure.addPoint(this.snap(hit, e));
    } else {
      this.onPick(hit ? (hit.object.userData.nodeId as number) : null);
    }
    this.requestRender();
  };

  private raycast(clientX: number, clientY: number): THREE.Intersection | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const clipped = this.renderer.clippingPlanes.length > 0;
    return raycaster
      .intersectObjects(this.meshes.filter(isShown), false)
      .find((h) => !clipped || this.clipPlane.distanceToPoint(h.point) >= 0);
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

  // ---------------------------------------------------------------------------
  // Rendering (on demand)

  private requestRender = (): void => {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderer.render(this.scene, this.camera);
      this.measure.updateLabel(this.camera, this.renderer.domElement);
    });
  };
}

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
