import { describe, expect, it } from 'vitest';
import { isolate } from '../ui/state';
import { apOf, decodeModel, defaultView, type RawModel, type SavedView } from './model';

function rawFixture(): { raw: RawModel; geometry: ArrayBuffer } {
  // One triangle prototype: 3 positions, 3 normals, 3 indices, 1 edge segment.
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const edg = [0, 0, 0, 1, 0, 0];
  const buf = new ArrayBuffer(120 + 7 * 8 + 9 * 8);
  new Float32Array(buf, 0, 9).set(pos);
  new Float32Array(buf, 36, 9).set(nrm);
  new Uint32Array(buf, 72, 3).set([0, 1, 2]);
  new Float32Array(buf, 84, 6).set(edg);
  // 108: faceStarts [0], 112: edgeStarts [0], 120: faceData (7 doubles), 176: edgeData (9 doubles)
  new Float64Array(buf, 120, 7).set([1, 0, 0, 0, 0, 0, 1]);
  new Float64Array(buf, 176, 9).set([1, 1, 0, 0, 0, 0, 0, 0, 0]);
  const raw: RawModel = {
    format: 'STEP',
    schema: 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }',
    fileUnit: 'MILLIMETRE',
    colors: [[1, 0, 0, 1]],
    nodes: [
      { name: 'asm', parent: -1, proto: -1, color: -1 },
      { name: 'a', parent: 0, proto: 0, color: -1 },
      { name: 'b', parent: 0, proto: 0, color: 0 },
    ],
    protos: [
      {
        positions: [0, 9],
        normals: [36, 9],
        indices: [72, 3],
        edges: [84, 6],
        faceStarts: [108, 1],
        edgeStarts: [112, 1],
        faceData: [120, 7],
        edgeData: [176, 9],
        groups: [[0, 3, -1]],
      },
    ],
    pmi: [{ kind: 'dimension', type: 'Distance', name: 'd1', proto: 0, segments: [84, 6], triangles: [0, 9], faces: [0], value: [1] }],
    views: [{ name: 'MBD_A', direction: [0, 0, -1], up: [0, 1, 0], pmi: [0] }],
    products: [],
    counts: {},
  };
  return { raw, geometry: buf };
}

describe('decodeModel', () => {
  it('slices typed arrays from the geometry buffer and builds the tree', () => {
    const { raw, geometry } = rawFixture();
    const m = decodeModel(raw, geometry);
    expect(Array.from(m.protos[0].positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(m.protos[0].indices)).toEqual([0, 1, 2]);
    expect(Array.from(m.protos[0].edges)).toEqual([0, 0, 0, 1, 0, 0]);
    expect(m.protos[0].groups).toEqual([{ start: 0, count: 3, color: -1 }]);
    expect(m.roots).toEqual([0]);
    expect(m.nodes[0].children).toEqual([1, 2]);
    expect(m.triangles).toBe(2); // two instances of one triangle
    expect(m.format).toBe('STEP AP242');
    expect(m.unit).toBe('mm');
    expect(Array.from(m.protos[0].faceData)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(m.protos[0].edgeData)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(m.pmi[0].segments)).toEqual([0, 0, 0, 1, 0, 0]);
    expect(m.pmi[0].faces).toEqual([0]);
    expect(m.views[0].pmi).toEqual([0]);
  });
});

describe('apOf', () => {
  it.each([
    ['AP203_CONFIGURATION_CONTROLLED_3D_DESIGN_OF_MECHANICAL_PARTS_AND_ASSEMBLIES_MIM_LF', 'AP203'],
    ['CONFIG_CONTROL_DESIGN', 'AP203'],
    ['AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }', 'AP214'],
    ['AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF', 'AP242'],
    ['IFC4', 'unknown'],
  ])('%s → %s', (schema, ap) => expect(apOf(schema)).toBe(ap));
});

describe('isolate', () => {
  it('hides everything outside the node, its ancestors and subtree', () => {
    const { raw, geometry } = rawFixture();
    const m = decodeModel(raw, geometry);
    expect([...isolate(m, 1)]).toEqual([2]);
    expect([...isolate(m, 0)]).toEqual([]);
  });
});

describe('defaultView', () => {
  const view = (name: string): SavedView => ({ name, direction: [0, 0, -1], up: [0, 1, 0], pmi: [] });
  it('prefers the default camera, then an isometric view, then the first', () => {
    expect(defaultView({ views: [view('MBD_A'), view('* Document Default Camera')] })?.name).toBe('* Document Default Camera');
    expect(defaultView({ views: [view('Back'), view('Isometric')] })?.name).toBe('Isometric');
    expect(defaultView({ views: [view('MBD_B'), view('MBD_A')] })?.name).toBe('MBD_B');
    expect(defaultView({ views: [] })).toBeUndefined();
  });
});
