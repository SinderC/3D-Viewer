import * as THREE from 'three';
import { computeBoundsTree } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import { buildSectionCaps } from './section';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

const style = { material: () => new THREE.MeshBasicMaterial(), outline: new THREE.LineBasicMaterial() };

function box(size: number, inward = false): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  if (inward) {
    // Flip winding so the box bounds a cavity.
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  }
  return g;
}

function mesh(geometry: THREE.BufferGeometry, position = new THREE.Vector3()): THREE.Mesh {
  geometry.computeBoundsTree();
  const m = new THREE.Mesh(geometry);
  m.position.copy(position);
  m.updateMatrixWorld(true);
  return m;
}

function capArea(group: THREE.Group): number {
  let area = 0;
  const t = new THREE.Triangle();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const p = o.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      t.setFromAttributeAndIndices(p, i, i + 1, i + 2);
      area += t.getArea();
    }
  });
  return area;
}

const zPlane = (z: number) => new THREE.Plane(new THREE.Vector3(0, 0, -1), z);

describe('buildSectionCaps', () => {
  it('fills the cross-section of a closed box', () => {
    const caps = buildSectionCaps([mesh(box(2))], zPlane(0.3), style);
    expect(capArea(caps)).toBeCloseTo(4);
  });

  it('subtracts an inner cavity as a hole', () => {
    // Outer 4x4 box with a 2x2 cavity: the cut is a 4x4 square with a 2x2 hole.
    const outer = box(4);
    const inner = box(2, true);
    const merged = new THREE.BufferGeometry();
    const pos = [...outer.getAttribute('position').array, ...inner.getAttribute('position').array];
    const n = outer.getAttribute('position').count;
    const idx = [...outer.getIndex()!.array, ...Array.from(inner.getIndex()!.array, (i) => i + n)];
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    merged.setIndex(idx);
    const caps = buildSectionCaps([mesh(merged)], zPlane(0.25), style);
    expect(capArea(caps)).toBeCloseTo(16 - 4);
  });

  it('uses world transforms and ignores meshes the plane misses', () => {
    const moved = mesh(box(2), new THREE.Vector3(0, 0, 10));
    expect(capArea(buildSectionCaps([moved], zPlane(0), style))).toBe(0);
    expect(capArea(buildSectionCaps([moved], zPlane(10.5), style))).toBeCloseTo(4);
  });

  it('skips open surfaces', () => {
    const sheet = new THREE.PlaneGeometry(2, 2).rotateX(Math.PI / 2); // vertical sheet, no inside
    expect(capArea(buildSectionCaps([mesh(sheet)], zPlane(0), style))).toBe(0);
  });
});
