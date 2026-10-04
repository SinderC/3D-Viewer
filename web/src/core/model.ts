// Model produced by the WASM bridge (see wasm/src/bridge.cpp) and decoded into typed arrays.
import { fileUnit, type UnitId } from './units';

type Range = [offset: number, count: number];

export interface RawModel {
  schema: string;
  fileUnit: string;
  colors: [number, number, number, number][];
  nodes: { name: string; parent: number; proto: number; color: number; matrix?: number[] }[];
  protos: {
    positions: Range;
    normals: Range;
    indices: Range;
    edges: Range;
    faceStarts: Range;
    faceData: Range;
    edgeStarts: Range;
    edgeData: Range;
    groups: [start: number, count: number, color: number][];
  }[];
}

export interface Proto {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  /** First index (into `indices`) of each B-rep face, ascending. */
  faceStarts: Uint32Array;
  /** Per face, FACE_STRIDE values: kind (0 other, 1 plane), origin xyz, outward normal xyz. */
  faceData: Float64Array;
  /** First segment (into `edges`, 6 floats each) of each B-rep edge, ascending. */
  edgeStarts: Uint32Array;
  /** Per edge, EDGE_STRIDE values: kind (0 other, 1 line, 2 circle), length, radius, centre xyz, axis xyz. */
  edgeData: Float64Array;
  groups: { start: number; count: number; color: number }[];
}

export const FACE_STRIDE = 7;
export const EDGE_STRIDE = 9;

export interface ModelNode {
  id: number;
  name: string;
  parent: number;
  children: number[];
  proto: number;
  color: number;
  matrix?: number[];
}

export interface Model {
  schema: string;
  ap: 'AP203' | 'AP214' | 'AP242' | 'unknown';
  unit: UnitId; // the file's length unit
  colors: RawModel['colors'];
  nodes: ModelNode[];
  roots: number[];
  protos: Proto[];
  triangles: number;
}

export function apOf(schema: string): Model['ap'] {
  if (/AP242/i.test(schema)) return 'AP242';
  if (/AUTOMOTIVE_DESIGN/i.test(schema)) return 'AP214';
  if (/AP203|CONFIG_CONTROL_DESIGN/i.test(schema)) return 'AP203';
  return 'unknown';
}

export function decodeModel(raw: RawModel, geometry: ArrayBuffer): Model {
  const f32 = ([off, n]: Range) => new Float32Array(geometry, off, n);
  const u32 = ([off, n]: Range) => new Uint32Array(geometry, off, n);
  const f64 = ([off, n]: Range) => new Float64Array(geometry, off, n);

  const protos = raw.protos.map((p) => ({
    positions: f32(p.positions),
    normals: f32(p.normals),
    indices: u32(p.indices),
    edges: f32(p.edges),
    faceStarts: u32(p.faceStarts),
    faceData: f64(p.faceData),
    edgeStarts: u32(p.edgeStarts),
    edgeData: f64(p.edgeData),
    groups: p.groups.map(([start, count, color]) => ({ start, count, color })),
  }));

  const nodes: ModelNode[] = raw.nodes.map((n, id) => ({ ...n, id, children: [] }));
  const roots: number[] = [];
  for (const n of nodes) (n.parent < 0 ? roots : nodes[n.parent].children).push(n.id);

  // Triangles as rendered, i.e. counting every instance.
  const triangles = nodes.reduce((t, n) => (n.proto >= 0 ? t + protos[n.proto].indices.length / 3 : t), 0);

  return {
    schema: raw.schema,
    ap: apOf(raw.schema),
    unit: fileUnit(raw.fileUnit),
    colors: raw.colors,
    nodes,
    roots,
    protos,
    triangles,
  };
}
