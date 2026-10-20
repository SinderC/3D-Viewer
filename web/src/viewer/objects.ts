import type * as THREE from 'three';

/** Width in CSS pixels of highlighted lines: picked edges, dimension lines and the rotation center. */
export const LINE_PX = 2;
/** Widths in CSS pixels of model edges and PMI lines, plain and selected. */
export const EDGE_PX = 1.2;
export const PMI_PX = 1.2;
export const SELECTED_PMI_PX = 1.5;

/** Visible, and so are all its ancestors. */
export function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Build the geometry's BVH on first use. Indirect, so the index keeps the order `faceStarts` refers to. */
export function ensureBoundsTree(geometry: THREE.BufferGeometry): void {
  if (!geometry.boundsTree) geometry.computeBoundsTree({ indirect: true });
}
