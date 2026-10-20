// PMI presentations (lines, and filled areas such as text), drawn with every instance of the part
// (or, for assembly PMI, the assembly) that owns them. What PMI refers to is drawn by ElementHighlight.
import * as THREE from 'three';
import type { Model } from '../core/model';
import { isShown } from './objects';
import { SELECTED_COLOR } from './selection';

export class PmiLayer {
  private readonly line = new THREE.LineBasicMaterial();
  private readonly selectedLine = new THREE.LineBasicMaterial({ color: SELECTED_COLOR });
  private readonly fill = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private readonly selectedFill = new THREE.MeshBasicMaterial({ color: SELECTED_COLOR, side: THREE.DoubleSide });
  private owners: THREE.Object3D[][] = []; // per prototype: the node objects that instance it
  private objects: (THREE.LineSegments | THREE.Mesh)[][] = []; // per PMI item: lines and fill per instance
  private selected: number[] = [];

  /** Adds the PMI of `model` under its owners' node objects (or `root` for model coordinates). */
  build(model: Model, nodeObjects: THREE.Object3D[], root: THREE.Object3D): void {
    this.clear();
    this.owners = model.protos.map(() => []);
    model.nodes.forEach((n) => n.proto >= 0 && nodeObjects[n.id] && this.owners[n.proto].push(nodeObjects[n.id]));
    this.objects = model.pmi.map((item, index) => {
      const owners = item.nodes
        ? item.nodes.map((n) => nodeObjects[n]).filter(Boolean)
        : item.proto >= 0
          ? this.owners[item.proto]
          : [root];
      const make = <T extends THREE.LineSegments | THREE.Mesh>(positions: Float32Array, create: (g: THREE.BufferGeometry) => T) => {
        if (!positions.length) return [];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return owners.map((owner) => {
          const o = create(geometry);
          o.raycast = () => {}; // picked explicitly in pick()
          o.userData.pmi = index;
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

  /** Highlights these items' lines and text. */
  select(indices: number[]): void {
    for (const i of this.selected) this.paint(i, false);
    this.selected = indices;
    for (const i of indices) this.paint(i, true);
  }

  /** The shown item nearest along the ray, and how far; lines within the raycaster's line threshold. */
  pick(raycaster: THREE.Raycaster): { index: number; distance: number } | null {
    const hits: THREE.Intersection[] = [];
    for (const objects of this.objects)
      for (const o of objects) {
        if (!isShown(o)) continue;
        if (o instanceof THREE.Mesh) THREE.Mesh.prototype.raycast.call(o, raycaster, hits);
        else THREE.LineSegments.prototype.raycast.call(o, raycaster, hits);
      }
    const nearest = hits.reduce<THREE.Intersection | undefined>((a, h) => (!a || h.distance < a.distance ? h : a), undefined);
    return nearest ? { index: nearest.object.userData.pmi as number, distance: nearest.distance } : null;
  }

  /** Every PMI object in the scene. */
  get all(): THREE.Object3D[] {
    return this.objects.flat();
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
    for (const objects of this.objects)
      for (const o of objects) {
        o.geometry.dispose(); // shared by an item's instances; disposing twice is harmless
        o.removeFromParent();
      }
    this.objects = [];
    this.owners = [];
    this.selected = [];
  }

  dispose(): void {
    this.clear();
    for (const m of [this.line, this.selectedLine, this.fill, this.selectedFill]) m.dispose();
  }
}
