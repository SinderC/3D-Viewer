import { describe, expect, it } from 'vitest';
import { cellDirection, FACES } from './ViewCube';

describe('cellDirection', () => {
  it('maps the 54 cells to the 26 face, edge and corner views', () => {
    const dirs = new Set<string>();
    for (const face of FACES) {
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) dirs.add(cellDirection(face, i, j).toArray().join(','));
    }
    expect(dirs.size).toBe(26);
    expect(dirs.has('0,0,0')).toBe(false);
  });

  it('looks at the face from its centre cell and puts the label up on screen', () => {
    const front = FACES.find((f) => f.label === 'Front')!;
    expect(cellDirection(front, 1, 1).toArray()).toEqual([0, -1, 0]);
    expect(cellDirection(front, 1, 0).toArray()).toEqual([0, -1, 1]); // top edge
    expect(cellDirection(front, 2, 1).toArray()).toEqual([1, -1, 0]); // right edge
  });
});
