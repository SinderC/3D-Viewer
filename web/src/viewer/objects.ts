import type * as THREE from 'three';

/** Visible, and so are all its ancestors. */
export function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
