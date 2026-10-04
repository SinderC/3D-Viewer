// Model produced by the WASM bridge (see wasm/src/bridge.cpp) and decoded into typed arrays.

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
    groups: [start: number, count: number, color: number][];
  }[];
}

export interface Proto {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  groups: { start: number; count: number; color: number }[];
}

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
  unit: LengthUnit;
  colors: RawModel['colors'];
  nodes: ModelNode[];
  roots: number[];
  protos: Proto[];
  triangles: number;
}

export interface LengthUnit {
  label: string;
  perMm: number; // file units per millimetre (geometry is always in mm)
}

export function apOf(schema: string): Model['ap'] {
  if (/AP242/i.test(schema)) return 'AP242';
  if (/AUTOMOTIVE_DESIGN/i.test(schema)) return 'AP214';
  if (/AP203|CONFIG_CONTROL_DESIGN/i.test(schema)) return 'AP203';
  return 'unknown';
}

// OCCT reports STEP unit names such as "MILLIMETRE", "INCH", "METRE", "CENTIMETRE", "FOOT".
export function lengthUnit(name: string): LengthUnit {
  const n = name.toUpperCase();
  if (n.includes('INCH')) return { label: 'in', perMm: 1 / 25.4 };
  if (n.includes('FOOT')) return { label: 'ft', perMm: 1 / 304.8 };
  if (n.includes('CENTI')) return { label: 'cm', perMm: 0.1 };
  if (n.includes('MILLI') || n === '') return { label: 'mm', perMm: 1 };
  if (n.includes('METRE') || n.includes('METER')) return { label: 'm', perMm: 0.001 };
  return { label: 'mm', perMm: 1 };
}

export function decodeModel(raw: RawModel, geometry: ArrayBuffer): Model {
  const f32 = ([off, n]: Range) => new Float32Array(geometry, off, n);
  const u32 = ([off, n]: Range) => new Uint32Array(geometry, off, n);

  const protos = raw.protos.map((p) => ({
    positions: f32(p.positions),
    normals: f32(p.normals),
    indices: u32(p.indices),
    edges: f32(p.edges),
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
    unit: lengthUnit(raw.fileUnit),
    colors: raw.colors,
    nodes,
    roots,
    protos,
    triangles,
  };
}
