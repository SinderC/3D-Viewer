// Model produced by the WASM bridge (see wasm/src/bridge.cpp) and decoded into typed arrays.
import { fileUnit, type UnitId } from './units';

type Range = [offset: number, count: number];

export interface RawModel {
  format: string; // STEP, IGES, JT, glTF, OBJ, STL, VRML, BREP
  schema: string; // STEP only
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
  pmi: (Omit<PmiItem, 'segments' | 'triangles'> & { segments: Range; triangles: Range })[];
  views: SavedView[];
}

export type PmiKind = 'dimension' | 'tolerance' | 'datum' | 'note';

/** STEP GD&T item with its drawn presentation. Lengths in mm, angles in degrees. */
export interface PmiItem {
  kind: PmiKind;
  type: string; // e.g. "Diameter", "Position", "Datum A"
  name: string;
  /** Owning prototype (drawn with each of its instances), or -1 for model coordinates. */
  proto: number;
  /** Presentation lines, 6 floats per segment, in the owner's coordinates. */
  segments: Float32Array;
  /** Filled presentation areas (text glyphs), 9 floats per triangle, in the owner's coordinates. */
  triangles: Float32Array;
  /** Referenced faces of the owning prototype (indices into its faceStarts). */
  faces: number[];
  value?: [number];
  plusMinus?: [lower: number, upper: number];
  range?: [lower: number, upper: number];
  angular?: boolean;
  datums?: string[];
}

/** Saved view: the direction the camera looks, and the PMI it shows. */
export interface SavedView {
  name: string;
  direction: [number, number, number];
  up: [number, number, number];
  pmi: number[];
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
  /** Display label, e.g. "STEP AP242" or "glTF". */
  format: string;
  unit: UnitId; // the file's length unit
  colors: RawModel['colors'];
  nodes: ModelNode[];
  roots: number[];
  protos: Proto[];
  triangles: number;
  pmi: PmiItem[];
  views: SavedView[];
}

/** The saved view a file opens in: its default camera, else an isometric view, else the first. */
export function defaultView(model: Pick<Model, 'views'>): SavedView | undefined {
  const { views } = model;
  return views.find((v) => /default/i.test(v.name)) ?? views.find((v) => /^\W*iso/i.test(v.name)) ?? views[0];
}

/** Triangles of B-rep faces (faceStarts indices) as a flat, non-indexed position list in prototype coordinates. */
export function faceTriangles(proto: Proto, faces: number[]): Float32Array {
  const ranges = faces.map((f) => [proto.faceStarts[f], proto.faceStarts[f + 1] ?? proto.indices.length]);
  const out = new Float32Array(ranges.reduce((n, [a, b]) => n + (b - a) * 3, 0));
  let o = 0;
  for (const [a, b] of ranges)
    for (let k = a; k < b; k++, o += 3) out.set(proto.positions.subarray(proto.indices[k] * 3, proto.indices[k] * 3 + 3), o);
  return out;
}

export function apOf(schema: string): 'AP203' | 'AP214' | 'AP242' | 'unknown' {
  if (/AP242/i.test(schema)) return 'AP242';
  if (/AUTOMOTIVE_DESIGN/i.test(schema)) return 'AP214';
  if (/AP203|CONFIG_CONTROL_DESIGN/i.test(schema)) return 'AP203';
  return 'unknown';
}

function formatLabel({ format, schema }: RawModel): string {
  const ap = format === 'STEP' ? apOf(schema) : 'unknown';
  return ap === 'unknown' ? format : `${format} ${ap}`;
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
    format: formatLabel(raw),
    unit: fileUnit(raw.fileUnit),
    colors: raw.colors,
    nodes,
    roots,
    protos,
    triangles,
    pmi: raw.pmi.map((p) => ({ ...p, segments: f32(p.segments), triangles: f32(p.triangles) })),
    views: raw.views,
  };
}
