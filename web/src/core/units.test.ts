import { describe, expect, it } from 'vitest';
import { fileUnit, formatLength } from './units';

describe('fileUnit', () => {
  it.each([
    ['MILLIMETRE', 'mm'],
    ['millimetre', 'mm'],
    ['INCH', 'in'],
    ['METRE', 'm'],
    ['CENTIMETRE', 'cm'],
    ['FOOT', 'ft'],
    ['', 'mm'],
  ])('%s → %s', (name, unit) => expect(fileUnit(name)).toBe(unit));
});

describe('formatLength', () => {
  it.each([
    [25.4, 'mm', '25.400 mm'],
    [25.4, 'cm', '2.5400 cm'],
    [1234.5, 'm', '1.234500 m'],
    [25.4, 'in', '1.0000 in'],
    [304.8, 'ft', '1.00000 ft'],
  ] as const)('%d mm in %s', (mm, unit, text) => expect(formatLength(mm, unit)).toBe(text));

  it.each([
    [0, '0"'],
    [25.4 / 16, '1/16"'],
    [25.4 * 4.5, '4 1/2"'],
    [304.8, `1' 0"`],
    [304.8 * 3 + 25.4 * (4 + 9 / 16), `3' 4 9/16"`],
    [304.8 * 2 + 25.4 * (11 + 31 / 32 + 0.001), `3' 0"`], // rounds up across the foot
  ])('%d mm in ft-in → %s', (mm, text) => expect(formatLength(mm, 'ft-in')).toBe(text));
});
