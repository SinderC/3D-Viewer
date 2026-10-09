import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyExplode, explodeOffsets } from './explode';

const part = (x: number) => {
  const node = new THREE.Group();
  node.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  node.position.set(x, 0, 0);
  return node;
};
const centre = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());

describe('explode', () => {
  it('doubles each outermost part centre’s distance from the model centre, through rotated parents', () => {
    const root = new THREE.Group();
    const a = part(-5);
    const sub = new THREE.Group();
    sub.rotation.z = Math.PI / 2;
    sub.scale.setScalar(2);
    const b = part(2.5); // world (0, 5, 0)
    const nested = part(0); // inside b: moves with it, not on its own
    b.add(nested);
    sub.add(b);
    root.add(a, sub);
    root.updateMatrixWorld(true);

    const items = explodeOffsets(new Set([a, b, nested]), new THREE.Vector3());
    expect(items.map((i) => i.node)).toEqual([a, b]);

    applyExplode(items, 1);
    root.updateMatrixWorld(true);
    expect(centre(a).toArray()).toEqual([-10, 0, 0]);
    centre(b).toArray().forEach((v, i) => expect(v).toBeCloseTo([0, 10, 0][i]));

    applyExplode(items, 0);
    expect(b.position.toArray()).toEqual([2.5, 0, 0]);
  });
});
