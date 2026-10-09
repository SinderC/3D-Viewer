// Axis-aligned extents from the decoded model alone, without a scene.
import * as THREE from 'three';
import type { Model, Proto } from './model';

const protoBoxes = new WeakMap<Proto, THREE.Box3>();

function protoBox(proto: Proto): THREE.Box3 {
  let box = protoBoxes.get(proto);
  if (!box) protoBoxes.set(proto, (box = new THREE.Box3().setFromArray(proto.positions)));
  return box;
}

// Product of the node's own matrix and those of its ancestors.
function worldMatrix(model: Model, id: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  for (let p = id; p >= 0; p = model.nodes[p].parent) {
    const { matrix } = model.nodes[p];
    if (matrix) m.premultiply(new THREE.Matrix4().fromArray(matrix));
  }
  return m;
}

/** World-space box of a node's subtree, or of the whole model when `id` is null; null without geometry. */
export function boundsOf(model: Model, id: number | null): THREE.Box3 | null {
  const box = new THREE.Box3();
  const visit = (n: number, m: THREE.Matrix4) => {
    const node = model.nodes[n];
    if (node.proto >= 0) box.union(protoBox(model.protos[node.proto]).clone().applyMatrix4(m));
    for (const c of node.children) {
      const { matrix } = model.nodes[c];
      visit(c, matrix ? m.clone().multiply(new THREE.Matrix4().fromArray(matrix)) : m);
    }
  };
  if (id === null) model.roots.forEach((r) => visit(r, worldMatrix(model, r)));
  else visit(id, worldMatrix(model, id));
  return box.isEmpty() ? null : box;
}

/** Size along X, Y and Z in mm (see boundsOf). */
export function sizeOf(model: Model, id: number | null): [number, number, number] | null {
  const box = boundsOf(model, id);
  return box && (box.getSize(new THREE.Vector3()).toArray() as [number, number, number]);
}
