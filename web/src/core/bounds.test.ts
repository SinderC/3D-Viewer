import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sizeOf } from './bounds';
import type { Model, ModelNode, Proto } from './model';

// A 10 × 2 × 1 box prototype, placed by node matrices.
const box = { positions: new Float32Array([0, 0, 0, 10, 2, 1]) } as Proto;
const node = (id: number, parent: number, proto: number, matrix?: THREE.Matrix4): ModelNode => ({
  id,
  name: `n${id}`,
  parent,
  proto,
  color: -1,
  children: [],
  matrix: matrix?.toArray(),
});

function model(nodes: ModelNode[]): Model {
  for (const n of nodes) if (n.parent >= 0) nodes[n.parent].children.push(n.id);
  return { nodes, roots: nodes.filter((n) => n.parent < 0).map((n) => n.id), protos: [box] } as Model;
}

const close = (a: number[] | null, b: number[]) => a!.forEach((v, i) => expect(v).toBeCloseTo(b[i]));

describe('sizeOf', () => {
  it('spans translated and rotated instances', () => {
    const m = model([
      node(0, -1, -1),
      node(1, 0, 0, new THREE.Matrix4().makeTranslation(0, 0, 5)),
      node(2, 0, 0, new THREE.Matrix4().makeRotationZ(Math.PI / 2)),
    ]);
    close(sizeOf(m, 1), [10, 2, 1]);
    close(sizeOf(m, 2), [2, 10, 1]); // x in [-2, 0], y in [0, 10]
    close(sizeOf(m, null), [12, 10, 6]);
  });

  it('applies ancestor matrices to a selected subtree', () => {
    const scaled = new THREE.Matrix4().makeScale(2, 2, 2);
    const m = model([node(0, -1, -1, scaled), node(1, 0, 0)]);
    close(sizeOf(m, 1), [20, 4, 2]);
  });

  it('is null without geometry', () => {
    expect(sizeOf(model([node(0, -1, -1)]), null)).toBeNull();
  });
});
