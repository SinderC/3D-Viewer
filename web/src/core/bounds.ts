// Box extents from the decoded model alone, without a scene. Boxes are measured on the vertices of
// each prototype's convex hull (the only points any box touches), placed by the instance matrices.
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { Model, Proto } from './model';

type Size = [number, number, number];

/** A node subtree's boxes in mm: along model X/Y/Z, along its own axes, and the smallest in any orientation. */
export interface Boxes {
  size: Size;
  /** Along the node's own axes, before its placement; absent for the whole model, or when it equals `size`. */
  own?: Size;
  /** Sides of the smallest box in any orientation, longest first. */
  min: Size;
}

function hullOf(points: ArrayLike<number>): ConvexHull | null {
  if (points.length < 12) return null;
  const vectors: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i += 3) vectors.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
  const hull = new ConvexHull().setFromPoints(vectors);
  return hull.faces.length ? hull : null;
}

function hullVertices(hull: ConvexHull): THREE.Vector3[] {
  const seen = new Set<THREE.Vector3>();
  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      seen.add(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
  }
  return [...seen];
}

const protoHulls = new WeakMap<Proto, Float32Array>();

function protoHull(proto: Proto): Float32Array {
  let points = protoHulls.get(proto);
  if (!points) {
    const hull = hullOf(proto.positions);
    points = hull ? Float32Array.from(hullVertices(hull).flatMap((p) => p.toArray())) : proto.positions;
    protoHulls.set(proto, points);
  }
  return points;
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

// Hull points of every instance under each start node, placed by its frame and the matrices below it.
function subtreePoints(model: Model, starts: [id: number, frame: THREE.Matrix4][]): number[] {
  const out: number[] = [];
  const p = new THREE.Vector3();
  const visit = (n: number, m: THREE.Matrix4) => {
    const node = model.nodes[n];
    if (node.proto >= 0) {
      const points = protoHull(model.protos[node.proto]);
      for (let i = 0; i < points.length; i += 3) out.push(...p.fromArray(points, i).applyMatrix4(m).toArray());
    }
    for (const c of node.children) {
      const { matrix } = model.nodes[c];
      visit(c, matrix ? m.clone().multiply(new THREE.Matrix4().fromArray(matrix)) : m);
    }
  };
  for (const [id, frame] of starts) visit(id, frame);
  return out;
}

function extent(points: number[]): Size {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i++) {
    min[i % 3] = Math.min(min[i % 3], points[i]);
    max[i % 3] = Math.max(max[i % 3], points[i]);
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

// 2D convex hull (monotone chain), counter-clockwise.
function hull2d(points: [number, number][]): [number, number][] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (pts: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of pts) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...chain(sorted), ...chain(sorted.reverse())];
}

// Smallest rectangle around 2D points: one of its sides lies on an edge of their hull.
function minRect(points: [number, number][]): [number, number] {
  const hull = hull2d(points);
  let best: [number, number] = [Infinity, Infinity];
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = y * ux - x * uy;
      [u0, u1, v0, v1] = [Math.min(u0, u), Math.max(u1, u), Math.min(v0, v), Math.max(v1, v)];
    }
    if ((u1 - u0) * (v1 - v0) < best[0] * best[1] || !isFinite(best[0])) best = [u1 - u0, v1 - v0];
  }
  return isFinite(best[0]) ? best : [0, 0];
}

// Directions tried as one axis of the smallest box: the normals of the largest hull faces.
const MAX_DIRECTIONS = 200;

/**
 * Sides of the smallest box around points in any orientation, longest first: for each direction
 * tried, the box with a side across it and the smallest rectangle around the points seen along
 * it. Exact when a side of the smallest box lies on a hull face, as for prismatic parts; close
 * to it otherwise.
 */
export function minBox(points: number[]): Size {
  const hull = hullOf(points);
  const vertices = hull ? hullVertices(hull) : [];
  if (!hull) for (let i = 0; i < points.length; i += 3) vertices.push(new THREE.Vector3().fromArray(points, i));
  const directions: THREE.Vector3[] = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const seen = new Set(['1,0,0', '0,1,0', '0,0,1']);
  for (const face of hull ? hull.faces.slice().sort((a, b) => b.area - a.area) : []) {
    if (directions.length >= MAX_DIRECTIONS) break;
    const n = face.normal.clone();
    if (!(n.lengthSq() > 0.5)) continue;
    if (n.x < 0 || (n.x === 0 && (n.y < 0 || (n.y === 0 && n.z < 0)))) n.negate();
    const key = n.toArray().map((c) => Math.round(c * 1e5) / 1e5 || 0).join();
    if (!seen.has(key)) seen.add(key), directions.push(n);
  }
  let best: Size = [Infinity, Infinity, Infinity];
  const volume = (s: Size) => s[0] * s[1] * s[2];
  const area = (s: Size) => s[0] * s[1] + s[1] * s[2] + s[2] * s[0];
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const n of directions) {
    u.set(1, 0, 0).cross(n);
    if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(n);
    u.normalize();
    v.crossVectors(n, u);
    let [h0, h1] = [Infinity, -Infinity];
    const flat = vertices.map((p): [number, number] => {
      const h = p.dot(n);
      [h0, h1] = [Math.min(h0, h), Math.max(h1, h)];
      return [p.dot(u), p.dot(v)];
    });
    const box: Size = [...minRect(flat), h1 - h0];
    if (!isFinite(best[0]) || volume(box) < volume(best) - 1e-9 * volume(best) || (volume(box) <= volume(best) && area(box) < area(best)))
      best = box;
  }
  return best.sort((a, b) => b - a);
}

const cache = new WeakMap<Model, Map<number | null, Boxes | null>>();

/** Boxes of a node's subtree, or of the whole model when `id` is null; null without geometry. */
export function boxesOf(model: Model, id: number | null): Boxes | null {
  let byNode = cache.get(model);
  if (!byNode) cache.set(model, (byNode = new Map()));
  if (byNode.has(id)) return byNode.get(id)!;
  const world = subtreePoints(model, (id === null ? model.roots : [id]).map((n) => [n, worldMatrix(model, n)]));
  let boxes: Boxes | null = null;
  if (world.length) {
    const size = extent(world);
    const own = id === null ? undefined : extent(subtreePoints(model, [[id, new THREE.Matrix4()]]));
    const same = own?.every((s, i) => Math.abs(s - size[i]) <= 1e-6 * Math.max(...size));
    boxes = { size, ...(own && !same && { own }), min: minBox(world) };
  }
  byNode.set(id, boxes);
  return boxes;
}

/** Size along model X, Y and Z in mm (see boxesOf). */
export function sizeOf(model: Model, id: number | null): Size | null {
  return boxesOf(model, id)?.size ?? null;
}
