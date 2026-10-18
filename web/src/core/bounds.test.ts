import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boxesOf, minBox, sizeOf } from './bounds';
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

// Corners of a box from the origin to [x, y, z].
const corners = (x: number, y: number, z: number) => [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0]);
// A 10 × 2 × 1 diamond (octahedron) around the origin.
const diamond = { positions: new Float32Array([5, 0, 0, -5, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0.5, 0, 0, -0.5]) } as Proto;

function model(nodes: ModelNode[], protos = [box]): Model {
  for (const n of nodes) if (n.parent >= 0) nodes[n.parent].children.push(n.id);
  return { nodes, roots: nodes.filter((n) => n.parent < 0).map((n) => n.id), protos } as Model;
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

describe('boxesOf', () => {
  const turned = new THREE.Matrix4().makeRotationZ(Math.PI / 4);

  it('fits the placed shape, not its placed box', () => {
    const m = model([node(0, -1, -1), node(1, 0, 0, turned)], [diamond]);
    close(boxesOf(m, 1)!.size, [Math.SQRT2 * 5, Math.SQRT2 * 5, 1]);
  });

  it('measures along the own axes when they are turned, and the smallest box', () => {
    const m = model([node(0, -1, -1), node(1, 0, 0, turned)], [{ positions: new Float32Array(corners(10, 2, 1)) } as Proto]);
    const boxes = boxesOf(m, 1)!;
    close(boxes.size, [12 / Math.SQRT2, 12 / Math.SQRT2, 1]);
    close(boxes.own!, [10, 2, 1]);
    close(boxes.min, [10, 2, 1]);
    expect(boxesOf(m, null)!.own).toBeUndefined();
  });

  it('leaves out the own axes when they are the model axes', () => {
    const m = model([node(0, -1, -1), node(1, 0, 0, new THREE.Matrix4().makeTranslation(1, 2, 3))]);
    expect(boxesOf(m, 1)!.own).toBeUndefined();
  });

  it('places roots by their own matrix', () => {
    const m = model([node(0, -1, 0, new THREE.Matrix4().makeScale(2, 2, 2))]);
    close(sizeOf(m, null), [20, 4, 2]);
  });
});

describe('minBox', () => {
  it('finds a box turned about every axis', () => {
    const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, 0.5, 0.7));
    const points = corners(3, 2, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < points.length; i += 3) p.fromArray(points, i).applyMatrix4(r).toArray(points, i);
    close(minBox(points), [3, 2, 1]);
  });

  it('measures flat shapes', () => {
    close(minBox([0, 0, 0, 4, 0, 0, 4, 3, 0, 0, 3, 0, 2, 1, 0]), [4, 3, 0]);
  });
});
