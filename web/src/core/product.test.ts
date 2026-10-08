import { describe, expect, it } from 'vitest';
import type { Product } from './model';
import { countInfo, formatMeasure, productInfo } from './product';

const product = (p: Partial<Product>): Product => ({ props: [], attributes: [], ...p });

describe('formatMeasure', () => {
  it('converts areas and volumes with the square and cube of the length unit', () => {
    expect(formatMeasure(645.16, 'in', 2)).toBe('1 in²');
    expect(formatMeasure(16387.064, 'in', 3)).toBe('1 in³');
    expect(formatMeasure(14642797.5, 'mm', 3)).toBe('14,642,800 mm³');
  });
});

describe('productInfo', () => {
  it('lists product data, then validation properties, then user-defined attributes', () => {
    const p = product({ props: [['Part number', 'P-1'], ['Security', 'confidential']], attributes: [['CAGE Code', '64JW1']], volume: [1000] });
    expect(productInfo(p, 'mm').map(([label]) => label)).toEqual(['Part number', 'Security', 'Volume', 'CAGE Code']);
  });

  it('passes validation properties within 0.1 % and fails others', () => {
    const rows = productInfo(product({ volume: [1000, 1000.5], area: [600, 601] }), 'mm');
    expect(rows[0].slice(0, 2)).toEqual(['Volume', '✓ 1,000 mm³']);
    expect(rows[0][2]).toBe('File 1,000 mm³, computed 1,000.5 mm³ (+0.0500 %)');
    expect(rows[1].slice(0, 2)).toEqual(['Surface area', '✗ 600 mm²']);
  });

  it('checks the centroid against the cube root of the volume', () => {
    const near = productInfo(product({ volume: [1e6], centroid: [10, 20, 30, 10, 20, 30.09] }), 'mm');
    const far = productInfo(product({ volume: [1e6], centroid: [10, 20, 30, 10, 20, 30.2] }), 'mm');
    expect(near[1][1]).toBe('✓ 10, 20, 30 mm');
    expect(far[1][1]).toBe('✗ 10, 20, 30 mm');
  });

  it('shows values without a verdict when the geometry has no exact surfaces', () => {
    const [row] = productInfo(product({ volume: [1000] }), 'mm');
    expect(row[1]).toBe('1,000 mm³');
  });
});

describe('countInfo', () => {
  it('marks whether the loaded count matches the stated one', () => {
    expect(countInfo(21, 21)).toEqual(['✓ 21', 'The file states 21']);
    expect(countInfo(20, 21)[0]).toBe('✗ 20');
  });
});
