import { describe, expect, it } from 'vitest';
import { boxUvs } from './boxUv';

describe('boxUvs', () => {
  it('projects along the main axis of each normal, in metres', () => {
    const positions = [100, 200, 300, 100, 200, 300, 100, 200, 300];
    const normals = [0.9, 0.3, 0.1, -0.2, -0.95, 0.1, 0.1, 0.2, 0.97];
    expect(Array.from(boxUvs(positions, normals), (v) => +v.toFixed(6))).toEqual([0.2, 0.3, 0.1, 0.3, 0.1, 0.2]);
  });
});
