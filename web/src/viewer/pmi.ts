// PMI presentations (lines, and filled areas such as text), drawn with every instance of the part
// that owns them, and the faces the selected item refers to.
import * as THREE from 'three';
import { faceTriangles, type Model } from '../core/model';
import { isShown } from './objects';

const SELECTED_COLOR = 0xff7d2d;

export class PmiLayer {
  private readonly line = new THREE.LineBasicMaterial();
  private readonly selectedLine = new THREE.LineBasicMaterial({ color: SELECTED_COLOR });
  private readonly fill = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private readonly selectedFill = new THREE.MeshBasicMaterial({ color: SELECTED_COLOR, side: THREE.DoubleSide });
  private readonly faceMaterial = new THREE.MeshBasicMaterial({
    color: SELECTED_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  private model?: Model;
  private owners: THREE.Object3D[][] = []; // per prototype: the node objects that instance it
  private objects: (THREE.LineSegments | THREE.Mesh)[][] = []; // per PMI item: lines and fill per instance
  private faces: THREE.Mesh[] = [];
  private selected: number | null = null;

  /** Adds the PMI of `model` under its owners' node objects (or `root` for model coordinates). */
  build(model: Model, nodeObjects: THREE.Object3D[], root: THREE.Object3D): void {
    this.clear();
    this.model = model;
    this.owners = model.protos.map(() => []);
    model.nodes.forEach((n) => n.proto >= 0 && nodeObjects[n.id] && this.owners[n.proto].push(nodeObjects[n.id]));
    this.objects = model.pmi.map((item) => {
      const owners = item.proto >= 0 ? this.owners[item.proto] : [root];
      const make = <T extends THREE.LineSegments | THREE.Mesh>(positions: Float32Array, create: (g: THREE.BufferGeometry) => T) => {
        if (!positions.length) return [];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return owners.map((owner) => {
          const o = create(geometry);
          o.raycast = () => {}; // not pickable; bounds stay the model's
          owner.add(o);
          return o;
        });
      };
      return [
        ...make(item.segments, (g) => new THREE.LineSegments(g, this.line)),
        ...make(item.triangles, (g) => new THREE.Mesh(g, this.fill)),
      ];
    });
  }

  private paint(index: number, selected: boolean): void {
    for (const o of this.objects[index] ?? [])
      o.material = o instanceof THREE.Mesh ? (selected ? this.selectedFill : this.fill) : selected ? this.selectedLine : this.line;
  }

  setVisible(visible: boolean, hidden: ReadonlySet<number>): void {
    this.objects.forEach((objects, i) => objects.forEach((o) => (o.visible = visible && !hidden.has(i))));
  }

  /** Highlights an item's lines and overlays the faces it refers to. */
  select(index: number | null): void {
    if (this.selected !== null) this.paint(this.selected, false);
    this.clearFaces();
    this.selected = index;
    const item = index === null ? undefined : this.model?.pmi[index];
    if (!item || !this.model) return;
    this.paint(index!, true);
    if (item.proto < 0 || !item.faces.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(faceTriangles(this.model.protos[item.proto], item.faces), 3));
    for (const owner of this.owners[item.proto]) {
      const mesh = new THREE.Mesh(geometry, this.faceMaterial);
      mesh.raycast = () => {};
      owner.add(mesh);
      this.faces.push(mesh);
    }
  }

  /** Every PMI object in the scene: presentations and face overlays. */
  get all(): THREE.Object3D[] {
    return [...this.objects.flat(), ...this.faces];
  }

  /** Bounds of the shown PMI, in world coordinates. */
  visibleBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const objects of this.objects) for (const o of objects) if (isShown(o)) box.expandByObject(o);
    return box;
  }

  setColor(color: number): void {
    this.line.color.set(color);
    this.fill.color.set(color);
  }

  clear(): void {
    this.clearFaces();
    for (const objects of this.objects)
      for (const o of objects) {
        o.geometry.dispose(); // shared by an item's instances; disposing twice is harmless
        o.removeFromParent();
      }
    this.objects = [];
    this.owners = [];
    this.selected = null;
    this.model = undefined;
  }

  dispose(): void {
    this.clear();
    for (const m of [this.line, this.selectedLine, this.fill, this.selectedFill]) m.dispose();
    this.faceMaterial.dispose();
  }

  private clearFaces(): void {
    this.faces[0]?.geometry.dispose();
    this.faces.forEach((m) => m.removeFromParent());
    this.faces = [];
  }
}
