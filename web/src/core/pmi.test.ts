import { describe, expect, it } from 'vitest';
import type { PmiItem } from './model';
import { pmiInfo, pmiLabel } from './pmi';

const item = (p: Partial<PmiItem>): PmiItem => ({
  kind: 'dimension',
  type: 'Diameter',
  name: '',
  proto: 0,
  segments: new Float32Array(),
  triangles: new Float32Array(),
  faces: [],
  ...p,
});

describe('pmiLabel', () => {
  it('formats a dimension with a symmetric tolerance in the display unit', () => {
    expect(pmiLabel(item({ value: [25.4], plusMinus: [0.254, 0.254] }), 'in')).toBe('Diameter 1.0000 in ± 0.0100 in');
  });

  it('formats unequal deviations and angles', () => {
    expect(pmiLabel(item({ type: 'Angle', angular: true, value: [90], plusMinus: [0.5, 1] }), 'mm')).toBe('Angle 90° +1° / −0.5°');
  });

  it('adds datum references to tolerances', () => {
    expect(pmiLabel(item({ kind: 'tolerance', type: 'Position', value: [0.1], datums: ['A', 'B'] }), 'mm')).toBe(
      'Position 0.100 mm | A | B',
    );
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
});
