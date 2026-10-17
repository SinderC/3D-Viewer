import { describe, expect, it } from 'vitest';
import { sizeOf } from '../core/bounds';
import { readPly } from './ply';

// A 1 × 2 × 3 box as ASCII PLY, optionally with red vertex colours, or without faces.
const CORNERS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1].map((v, i) => (v * ((i % 3) + 1)) / 2);
const QUADS = [0, 3, 2, 1, 4, 5, 6, 7, 0, 1, 5, 4, 1, 2, 6, 5, 2, 3, 7, 6, 3, 0, 4, 7];
const boxPly = ({ colors = false, faces = true } = {}) => {
  const vertices = Array.from({ length: 8 }, (_, i) => [...CORNERS.slice(i * 3, i * 3 + 3), ...(colors ? [255, 0, 0] : [])].join(' '));
  const quads = Array.from({ length: 6 }, (_, i) => `4 ${QUADS.slice(i * 4, i * 4 + 4).join(' ')}`);
  return new TextEncoder().encode(
    [
      'ply',
      'format ascii 1.0',
      'element vertex 8',
      'property float x',
      'property float y',
      'property float z',
      ...(colors ? ['property uchar red', 'property uchar green', 'property uchar blue'] : []),
      ...(faces ? ['element face 6', 'property list uchar int vertex_indices'] : []),
      'end_header',
      ...vertices,
      ...(faces ? quads : []),
      '',
    ].join('\n'),
  ).buffer;
};

describe('readPly', () => {
  it('reads the mesh in mm', async () => {
    const model = await readPly(boxPly(), 'Box.ply');
    expect(model.format).toBe('PLY');
    expect(model.unit).toBe('mm');
    expect(model.triangles).toBe(12);
    sizeOf(model, null)!.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3][i]));
  });

  it('keeps vertex colours', async () => {
    const model = await readPly(boxPly({ colors: true }), 'Box.ply');
    const { vertexColors } = model.protos[0];
    expect(vertexColors?.itemSize).toBe(3);
    expect(Array.from(vertexColors!.array.slice(0, 3)).map((v) => +v.toFixed(3))).toEqual([1, 0, 0]);
  });

  it('explains files it cannot show', async () => {
    await expect(readPly(boxPly({ faces: false }), 'Cloud.ply')).rejects.toThrow(/point clouds are not supported/);
    await expect(readPly(new ArrayBuffer(8), 'broken.ply')).rejects.toThrow(/PLY/);
  });
});
