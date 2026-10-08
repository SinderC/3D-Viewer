import { describe, expect, it } from 'vitest';
import type { Product } from './model';
import { countInfo, failures, formatMeasure, validationInfo } from './product';

const product = (p: Partial<Product>): Product => ({ props: [], attributes: [], ...p });

describe('formatMeasure', () => {
  it('converts areas and volumes with the square and cube of the length unit', () => {
    expect(formatMeasure(645.16, 'in', 2)).toBe('1 in²');
    expect(formatMeasure(16387.064, 'in', 3)).toBe('1 in³');
    expect(formatMeasure(14642797.5, 'mm', 3)).toBe('14,642,800 mm³');
  });
});

describe('validationInfo', () => {
  it('lists volume, surface area and centroid', () => {
    const p = product({ volume: [1000], area: [600], centroid: [0, 0, 0] });
    expect(validationInfo(p, 'mm').map(([label]) => label)).toEqual(['Volume', 'Surface area', 'Centroid']);
    expect(validationInfo(product({}), 'mm')).toEqual([]);
  });

  it('passes validation properties within 0.1 % and fails others', () => {
    const rows = validationInfo(product({ volume: [1000, 1000.5], area: [600, 601] }), 'mm');
    expect(rows[0].slice(0, 2)).toEqual(['Volume', '✓ 1,000 mm³']);
    expect(rows[0][2]).toBe('File 1,000 mm³, computed 1,000.5 mm³ (+0.0500 %)');
    expect(rows[1].slice(0, 2)).toEqual(['Surface area', '✗ 600 mm²']);
  });

  it('checks the centroid against the cube root of the volume', () => {
    const near = validationInfo(product({ volume: [1e6], centroid: [10, 20, 30, 10, 20, 30.09] }), 'mm');
    const far = validationInfo(product({ volume: [1e6], centroid: [10, 20, 30, 10, 20, 30.2] }), 'mm');
    expect(near[1][1]).toBe('✓ 10, 20, 30 mm');
    expect(far[1][1]).toBe('✗ 10, 20, 30 mm');
  });

  it('shows values without a verdict when the geometry has no exact surfaces', () => {
    const [row] = validationInfo(product({ volume: [1000] }), 'mm');
    expect(row[1]).toBe('1,000 mm³');
  });
});

describe('failures', () => {
  it('counts failed checks, or is undefined when nothing was checked', () => {
    expect(failures([['Volume', '✓ 1 mm³'], ['Area', '✗ 2 mm²'], ['Name', 'P-1']])).toBe(1);
    expect(failures([['Volume', '✓ 1 mm³']])).toBe(0);
    expect(failures([['Volume', '1 mm³']])).toBeUndefined();
  });
});

describe('countInfo', () => {
  it('marks whether the loaded count matches the stated one', () => {
    expect(countInfo(21, 21)).toEqual(['✓ 21', 'The file states 21']);
    expect(countInfo(20, 21)[0]).toBe('✗ 20');
  });
});
