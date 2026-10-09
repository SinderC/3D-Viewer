// Exploded view: each part instance moves away from the model centre, along the line through its own centre.
import * as THREE from 'three';

export interface ExplodeItem {
  node: THREE.Object3D;
  base: THREE.Vector3; // position when not exploded
  offset: THREE.Vector3; // in the parent's frame, for full explosion
}

/**
 * Offsets for the outermost of `owners` (part nodes; a part nested in another moves with it).
 * Expects up-to-date world matrices. At full explosion a part's centre is twice as far from `center`.
 */
export function explodeOffsets(owners: ReadonlySet<THREE.Object3D>, center: THREE.Vector3): ExplodeItem[] {
  const outermost = [...owners].filter((o) => {
    for (let p = o.parent; p; p = p.parent) if (owners.has(p)) return false;
    return true;
  });
  return outermost.map((node) => {
    const away = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()).sub(center);
    // A direction: the parent's rotation and scale, without its translation.
    const toParent = new THREE.Matrix3().setFromMatrix4(node.parent!.matrixWorld.clone().invert());
    return { node, base: node.position.clone(), offset: away.applyMatrix3(toParent) };
  });
}

/** Moves the parts to `amount` (0 assembled, 1 fully exploded); world matrices need updating after. */
export function applyExplode(items: ExplodeItem[], amount: number): void {
  for (const { node, base, offset } of items) node.position.copy(base).addScaledVector(offset, amount);
}
