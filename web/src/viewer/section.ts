// Section caps: intersect each mesh with the clipping plane, chain the cut segments into closed
// loops, and triangulate them (outer loops with holes) into flat cap faces plus an outline.
// Requires closed meshes; open chains (sheet bodies) are skipped.
import * as THREE from 'three';
import { INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';

export interface CapStyle {
  material: (mesh: THREE.Mesh) => THREE.Material;
  outline: THREE.LineBasicMaterial;
}

// Range of n·p over the box's corners: where a plane with normal `n` can cut it.
function projectedRange(box: THREE.Box3, n: THREE.Vector3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const d = n.x * (i & 1 ? box.max.x : box.min.x) + n.y * (i & 2 ? box.max.y : box.min.y) + n.z * (i & 4 ? box.max.z : box.min.z);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/**
 * Cut across `box` perpendicular to the unit vector `dir`, at `position` (0..1) along it. Keeps the side
 * towards -dir (the material behind a face whose outward normal is `dir`), or towards +dir when flipped.
 */
export function sectionPlane(box: THREE.Box3, dir: THREE.Vector3, position: number, flip: boolean): THREE.Plane {
  const [lo, hi] = projectedRange(box, dir);
  const at = dir.clone().multiplyScalar(THREE.MathUtils.lerp(lo, hi, position));
  return new THREE.Plane().setFromNormalAndCoplanarPoint(dir.clone().multiplyScalar(flip ? 1 : -1), at);
}

/** The sectionPlane position (0..1) of the plane through `point`. */
export function sectionPosition(box: THREE.Box3, dir: THREE.Vector3, point: THREE.Vector3): number {
  const [lo, hi] = projectedRange(box, dir);
  return hi > lo ? THREE.MathUtils.clamp((dir.dot(point) - lo) / (hi - lo), 0, 1) : 0.5;
}

/** Builds caps for all meshes, in world space. Meshes must have a bounds tree. */
export function buildSectionCaps(meshes: THREE.Mesh[], plane: THREE.Plane, style: CapStyle): THREE.Group {
  const group = new THREE.Group();
  const outline: number[] = [];
  const inverse = new THREE.Matrix4();

  for (const mesh of meshes) {
    // Cut in the mesh's local frame so shared geometry is not transformed per vertex.
    const local = plane.clone().applyMatrix4(inverse.copy(mesh.matrixWorld).invert());
    const loops = closedLoops(cutSegments(mesh.geometry, local));
    if (!loops.length) continue;

    const geometry = triangulate(loops, local.normal);
    if (!geometry) continue;
    geometry.applyMatrix4(mesh.matrixWorld);
    group.add(new THREE.Mesh(geometry, style.material(mesh)));

    const p = new THREE.Vector3();
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) {
        p.copy(loop[i]).applyMatrix4(mesh.matrixWorld).toArray(outline, outline.length);
        p.copy(loop[(i + 1) % loop.length]).applyMatrix4(mesh.matrixWorld).toArray(outline, outline.length);
      }
    }
  }

  if (outline.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    group.add(new THREE.LineSegments(g, style.outline));
  }
  return group;
}

export function disposeCaps(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
  });
}

// ---------------------------------------------------------------------------

type Segment = [THREE.Vector3, THREE.Vector3];

function cutSegments(geometry: THREE.BufferGeometry, plane: THREE.Plane): Segment[] {
  const segments: Segment[] = [];
  const verts: THREE.Vector3[] = [];
  const dist: number[] = [];

  geometry.boundsTree!.shapecast({
    intersectsBounds: (box) => (plane.intersectsBox(box) ? INTERSECTED : NOT_INTERSECTED),
    intersectsTriangle: (tri) => {
      verts[0] = tri.a;
      verts[1] = tri.b;
      verts[2] = tri.c;
      for (let i = 0; i < 3; i++) dist[i] = plane.distanceToPoint(verts[i]);
      // A vertex exactly on the plane counts as "above"; neighbours then agree on the classification.
      const above = dist.map((d) => d >= 0);
      if (above[0] === above[1] && above[1] === above[2]) return false;

      const points: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        if (above[i] !== above[j]) points.push(edgePoint(verts[i], dist[i], verts[j], dist[j]));
      }
      if (!points[0].equals(points[1])) segments.push([points[0], points[1]]);
      return false;
    },
  });
  return segments;
}

// Intersection of an edge with the plane. Endpoints are ordered canonically so that the same edge
// seen from two adjacent triangles yields bit-identical points, which makes chaining exact.
function edgePoint(p: THREE.Vector3, dp: number, q: THREE.Vector3, dq: number): THREE.Vector3 {
  if (q.x < p.x || (q.x === p.x && (q.y < p.y || (q.y === p.y && q.z < p.z)))) {
    [p, q] = [q, p];
    [dp, dq] = [dq, dp];
  }
  return p.clone().lerp(q, dp / (dp - dq));
}

const keyOf = (v: THREE.Vector3) => `${v.x},${v.y},${v.z}`;

function closedLoops(segments: Segment[]): THREE.Vector3[][] {
  const atPoint = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const k of [keyOf(a), keyOf(b)]) {
      const list = atPoint.get(k);
      if (list) list.push(i);
      else atPoint.set(k, [i]);
    }
  });

  const used = new Uint8Array(segments.length);
  const loops: THREE.Vector3[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const startKey = keyOf(segments[start][0]);
    const loop = [segments[start][0]];
    let current = segments[start][1];
    let closed = false;

    for (;;) {
      const key = keyOf(current);
      if (key === startKey) {
        closed = true;
        break;
      }
      loop.push(current);
      const next = atPoint.get(key)?.find((s) => !used[s]);
      if (next === undefined) break; // open chain: sheet body or broken mesh
      used[next] = 1;
      const [a, b] = segments[next];
      current = keyOf(a) === key ? b : a;
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function triangulate(loops: THREE.Vector3[][], normal: THREE.Vector3): THREE.BufferGeometry | null {
  // 2D frame in the plane.
  const u = new THREE.Vector3().copy(Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  u.cross(normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);

  const flat = loops.map((loop) => loop.map((p) => new THREE.Vector2(p.dot(u), p.dot(v))));
  const area = flat.map((pts) => Math.abs(THREE.ShapeUtils.area(pts)));

  // Nesting: a loop's parent is the smallest larger loop containing it; even depth = outer boundary.
  const order = flat.map((_, i) => i).sort((a, b) => area[b] - area[a]);
  const parent = new Array<number>(flat.length).fill(-1);
  const depth = new Array<number>(flat.length).fill(0);
  order.forEach((i, rank) => {
    for (let r = rank - 1; r >= 0; r--) {
      const j = order[r];
      if (contains(flat[j], flat[i][0])) {
        parent[i] = j;
        depth[i] = depth[j] + 1;
        break;
      }
    }
  });

  const positions: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (depth[i] % 2 || area[i] === 0) continue;
    const holes = flat.map((_, h) => h).filter((h) => parent[h] === i);
    const contour3 = [loops[i], ...holes.map((h) => loops[h])].flat();
    const faces = THREE.ShapeUtils.triangulateShape(flat[i], holes.map((h) => flat[h]));
    for (const f of faces) for (const k of f) contour3[k].toArray(positions, positions.length);
  }
  if (!positions.length) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // The cap faces the removed side of the plane, i.e. towards the viewer.
  const n = normal.clone().negate();
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) n.toArray(normals, i);
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

function contains(polygon: THREE.Vector2[], p: THREE.Vector2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
