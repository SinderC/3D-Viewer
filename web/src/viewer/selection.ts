// B-rep faces, edges and vertices drawn highlighted on their part instances: the picked element, or
// those the selected PMI refers to. Edges and vertices show through the model, so hidden ones are found.
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { faceTriangles, type Model, type Proto } from '../core/model';
import type { ElementKind, ElementRef } from '../core/pmi';
import { LINE_PX } from './objects';

export const SELECTED_COLOR = 0xff7d2d;

/** A selected part, or face: lit orange. Model surfaces sit at polygon offset 1 and edges at 0, so an
 * offset between draws a selected face over its part and under its edges. */
export function selectedSurface(offset: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: SELECTED_COLOR,
    emissive: 0x4a240d,
    roughness: 0.5,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
}

/** Line segments (6 floats each) of B-rep edges, in prototype coordinates. */
export function edgeSegments(proto: Proto, edges: number[]): Float32Array {
  const ranges = edges.map((e) => [proto.edgeStarts[e] * 6, (proto.edgeStarts[e + 1] ?? proto.edges.length / 6) * 6]);
  const out = new Float32Array(ranges.reduce((n, [a, b]) => n + b - a, 0));
  let o = 0;
  for (const [a, b] of ranges) {
    out.set(proto.edges.subarray(a, b), o);
    o += b - a;
  }
  return out;
}

/** Positions of B-rep vertices, in prototype coordinates. */
export function vertexPositions(proto: Proto, vertices: number[]): Float32Array {
  const out = new Float32Array(vertices.length * 3);
  vertices.forEach((v, k) => out.set(proto.vertices.subarray(v * 3, v * 3 + 3), k * 3));
  return out;
}

export class ElementHighlight {
  private readonly faceMaterial: THREE.Material;
  private readonly lineMaterial = new LineMaterial({ color: SELECTED_COLOR, linewidth: LINE_PX + 1, depthTest: false });
  private readonly pointMaterial = new THREE.PointsMaterial({ color: SELECTED_COLOR, size: 9, sizeAttenuation: false, depthTest: false });
  private model?: Model;
  private nodeObjects: THREE.Object3D[] = [];
  private objects: THREE.Object3D[] = [];

  /** Clipped by the section like the model; faint for a preview of what a click would select:
   * translucent faces, half-transparent edges and vertices. */
  constructor(clipping: THREE.Plane[], faint = false) {
    this.faceMaterial = faint
      ? new THREE.MeshBasicMaterial({
          color: SELECTED_COLOR,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      : selectedSurface(0.5);
    for (const m of [this.faceMaterial, this.lineMaterial, this.pointMaterial]) {
      m.clippingPlanes = clipping;
      if (faint && m !== this.faceMaterial) Object.assign(m, { transparent: true, opacity: 0.5 });
    }
  }

  build(model: Model, nodeObjects: THREE.Object3D[]): void {
    this.clear();
    this.model = model;
    this.nodeObjects = nodeObjects;
  }

  /** Draws these elements, replacing the ones drawn before. */
  show(elements: ElementRef[]): void {
    this.clearObjects();
    const model = this.model;
    if (!model) return;
    // Per node and kind, the indices; instances of a part share the geometry built for it.
    const byNode = new Map<number, Record<ElementKind, number[]>>();
    for (const { node, kind, index } of elements) {
      if (!byNode.has(node)) byNode.set(node, { face: [], edge: [], vertex: [] });
      byNode.get(node)![kind].push(index);
    }
    const shared = new Map<string, THREE.Object3D>();
    for (const [node, kinds] of byNode) {
      const owner = this.nodeObjects[node];
      const proto = model.protos[model.nodes[node]?.proto];
      if (!owner || !proto) continue;
      for (const kind of Object.keys(kinds) as ElementKind[]) {
        const indices = kinds[kind];
        if (!indices.length) continue;
        const key = `${model.nodes[node].proto}:${kind}:${indices.join()}`;
        const made = shared.get(key);
        const o = made ? made.clone() : this.make(proto, kind, indices);
        if (!made) shared.set(key, o);
        o.raycast = () => {};
        o.renderOrder = 10;
        owner.add(o);
        this.objects.push(o);
      }
    }
  }

  private make(proto: Proto, kind: ElementKind, indices: number[]): THREE.Object3D {
    if (kind === 'edge') return new LineSegments2(new LineSegmentsGeometry().setPositions(edgeSegments(proto, indices)), this.lineMaterial);
    const positions = kind === 'face' ? faceTriangles(proto, indices) : vertexPositions(proto, indices);
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return kind === 'face' ? new THREE.Mesh(geometry, this.faceMaterial) : new THREE.Points(geometry, this.pointMaterial);
  }

  /** The highlight objects in the scene. */
  get all(): THREE.Object3D[] {
    return this.objects;
  }

  /** The canvas size in CSS pixels, which the line width is relative to. */
  setSize(width: number, height: number): void {
    this.lineMaterial.resolution.set(width, height);
  }

  clear(): void {
    this.clearObjects();
    this.nodeObjects = [];
    this.model = undefined;
  }

  dispose(): void {
    this.clear();
    this.faceMaterial.dispose();
    this.lineMaterial.dispose();
    this.pointMaterial.dispose();
  }

  private clearObjects(): void {
    const geometries = new Set(this.objects.map((o) => (o as THREE.Mesh).geometry)); // clones share theirs
    geometries.forEach((g) => g.dispose());
    this.objects.forEach((o) => o.removeFromParent());
    this.objects = [];
  }
}
