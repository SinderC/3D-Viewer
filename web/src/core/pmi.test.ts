import { describe, expect, it } from 'vitest';
import type { Model, ModelNode, PmiItem, ToleranceModifier } from './model';
import { pmiElements, pmiInfo, pmiLabel, refersTo } from './pmi';

const item = (p: Partial<PmiItem>): PmiItem => ({
  kind: 'dimension',
  type: 'Diameter',
  name: '',
  proto: 0,
  segments: new Float32Array(),
  triangles: new Float32Array(),
  faces: [],
  edges: [],
  vertices: [],
  ...p,
});

describe('pmiLabel', () => {
  it('formats a dimension with a symmetric tolerance in the display unit', () => {
    expect(pmiLabel(item({ value: [25.4], plusMinus: [0.254, 0.254] }), 'in')).toBe('Diameter 1.0000 in ± 0.0100 in');
  });

  it('formats unequal deviations and angles', () => {
    expect(pmiLabel(item({ type: 'Angle', angular: true, value: [90], plusMinus: [0.5, 1] }), 'mm')).toBe('Angle 90° +1° / −0.5°');
    expect(pmiLabel(item({ type: 'Radius', value: [5], bound: 'max' }), 'mm')).toBe('Radius 5.000 mm max');
  });

  it('adds datum references to tolerances', () => {
    expect(pmiLabel(item({ kind: 'tolerance', type: 'Position', value: [0.1], datums: ['A', 'B'] }), 'mm')).toBe(
      'Position 0.100 mm | A | B',
    );
  });

  it('adds the length or area a tolerance applies per', () => {
    const flatness = item({ kind: 'tolerance', type: 'Flatness', value: [0.05], perUnit: [25], unitArea: 'circular' });
    expect(pmiLabel(flatness, 'mm')).toBe('Flatness 0.050 mm / Ø25.000 mm');
    expect(pmiInfo(flatness, 'mm')).toContainEqual(['Per unit', 'Ø25.000 mm area']);
    const straightness = item({ kind: 'tolerance', type: 'Straightness', value: [0.2], perUnit: [15] });
    expect(pmiInfo(straightness, 'mm')).toContainEqual(['Per unit', '15.000 mm length']);
    const area = item({ kind: 'tolerance', type: 'Flatness', value: [0.1], perUnit: [10, 20], unitArea: 'rectangular' });
    expect(pmiLabel(area, 'mm')).toBe('Flatness 0.100 mm / 10.000 mm × 20.000 mm');
  });

  it('adds the zone form, modifiers, projected zone and maximum to tolerances', () => {
    const position = item({
      kind: 'tolerance',
      type: 'Position',
      value: [0.1],
      zone: 'diameter',
      modifiers: ['maximumMaterial', 'freeState'],
      projected: [12],
      maxValue: [0.2],
      datums: ['A'],
    });
    expect(pmiLabel(position, 'mm')).toBe('Position Ø0.100 mm Ⓜ 0.200 mm max Ⓕ Ⓟ 12.000 mm | A');
    expect(pmiInfo(position, 'mm')).toEqual(
      expect.arrayContaining([
        ['Tolerance', 'Ø0.100 mm'],
        ['Modifiers', 'maximum material, free state'],
        ['Projected zone', '12.000 mm'],
        ['Maximum', '0.200 mm'],
      ]),
    );
    const sphere = item({ kind: 'tolerance', type: 'Position', value: [0.5], zone: 'spherical', modifiers: ['leastMaterial'] });
    expect(pmiLabel(sphere, 'mm')).toBe('Position SØ0.500 mm Ⓛ');
    const straightness = item({ kind: 'tolerance', type: 'Straightness', value: [0.05], perUnit: [25], modifiers: ['maximumMaterial'] });
    expect(pmiLabel(straightness, 'mm')).toBe('Straightness 0.050 mm / 25.000 mm Ⓜ');
    const unknown = item({ kind: 'tolerance', type: 'Position', value: [0.1], modifiers: ['unitedFeature' as ToleranceModifier] });
    expect(pmiLabel(unknown, 'mm')).toBe('Position 0.100 mm unitedFeature');
    const runout = item({ kind: 'tolerance', type: 'Circular runout', value: [0.1], runout: [45] });
    expect(pmiInfo(runout, 'mm')).toContainEqual(['Zone angle', '45°']);
  });

  it('uses the name for notes and the type for datums', () => {
    expect(pmiLabel(item({ kind: 'note', type: 'Note', name: 'Note 1' }), 'mm')).toBe('Note 1');
    expect(pmiLabel(item({ kind: 'datum', type: 'Datum A' }), 'mm')).toBe('Datum A');
  });

  it('uses the name, else the type, for items without a value', () => {
    expect(pmiLabel(item({ type: 'Dimension', name: 'Linear Dimension (40)' }), 'mm')).toBe('Linear Dimension (40)');
    expect(pmiLabel(item({ kind: 'tolerance', type: 'Feature Control Frame' }), 'mm')).toBe('Feature Control Frame');
  });
});

describe('pmiInfo', () => {
  it('lists only the fields an item has', () => {
    expect(pmiInfo(item({ range: [9.9, 10.1], faces: [3, 4] }), 'mm')).toEqual([
      ['Kind', 'Dimension'],
      ['Type', 'Diameter'],
      ['Limits', '9.900 mm – 10.100 mm'],
      ['Faces', '2'],
    ]);
  });

  it('counts the faces of assembly PMI on one instance of its assembly', () => {
    // 2 faces under the first instance; the second instance of the assembly resolved only one
    const p = item({ nodes: [0, 7], nodeFaces: [[0, 2, 5], [0, 4, 5], [7, 9, 5]] });
    expect(pmiInfo(p, 'mm')).toContainEqual(['Faces', '2']);
  });

  it('counts edges and vertices', () => {
    expect(pmiInfo(item({ edges: [1, 2, 3], vertices: [0] }), 'mm')).toEqual(
      expect.arrayContaining([
        ['Edges', '3'],
        ['Vertices', '1'],
      ]),
    );
  });
});

describe('cross-highlighting', () => {
  // An assembly (node 0) with two instances (1, 2) of part 0 and one (3) of part 1.
  const node = (id: number, proto: number): ModelNode => ({ id, name: '', parent: id ? 0 : -1, children: [], proto, color: -1 });
  const model = { nodes: [node(0, -1), node(1, 0), node(2, 0), node(3, 1)] } as Model;

  it('puts part PMI on every instance of its part', () => {
    const p = item({ faces: [4], edges: [7], vertices: [2] });
    expect(pmiElements(model, p)).toEqual([
      { node: 1, kind: 'face', index: 4 },
      { node: 2, kind: 'face', index: 4 },
      { node: 1, kind: 'edge', index: 7 },
      { node: 2, kind: 'edge', index: 7 },
      { node: 1, kind: 'vertex', index: 2 },
      { node: 2, kind: 'vertex', index: 2 },
    ]);
    expect(refersTo(model, p, { node: 2, kind: 'edge', index: 7 })).toBe(true);
    expect(refersTo(model, p, { node: 2, kind: 'face', index: 7 })).toBe(false); // edge 7, not face 7
    expect(refersTo(model, p, { node: 3, kind: 'face', index: 4 })).toBe(false); // another part
  });

  it('puts assembly PMI only on the instances it names', () => {
    const p = item({ proto: -1, nodes: [0], nodeFaces: [[0, 2, 5]], nodeEdges: [[0, 3, 1]] });
    expect(pmiElements(model, p)).toEqual([
      { node: 2, kind: 'face', index: 5 },
      { node: 3, kind: 'edge', index: 1 },
    ]);
    expect(refersTo(model, p, { node: 2, kind: 'face', index: 5 })).toBe(true);
    expect(refersTo(model, p, { node: 1, kind: 'face', index: 5 })).toBe(false); // the other instance
  });

  it('refers to nothing for model-coordinate PMI', () => {
    const p = item({ proto: -1, faces: [0] });
    expect(pmiElements(model, p)).toEqual([]);
    expect(refersTo(model, p, { node: 1, kind: 'face', index: 0 })).toBe(false);
  });
});
