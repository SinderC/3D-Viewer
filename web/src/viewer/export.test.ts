import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toStl } from './export';

async function read(blob: Blob) {
  const view = new DataView(await blob.arrayBuffer());
  const count = view.getUint32(80, true);
  const triangle = (t: number) => Array.from({ length: 12 }, (_, i) => view.getFloat32(84 + 50 * t + 4 * i, true));
  return { bytes: view.byteLength, count, triangle };
}

const placed = (matrix: THREE.Matrix4) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.updateMatrixWorld(true);
  return mesh;
};

describe('toStl', () => {
  it('writes every triangle in world coordinates with outward normals', async () => {
    const stl = await read(toStl([placed(new THREE.Matrix4()), placed(new THREE.Matrix4().makeTranslation(10, 0, 0))]));
    expect(stl.count).toBe(24);
    expect(stl.bytes).toBe(84 + 50 * 24);
    for (let t = 0; t < stl.count; t++) {
      const [nx, ny, nz, ...vertices] = stl.triangle(t);
      const centre = t < 12 ? 0 : 10;
      // Outward: the normal points away from the box centre.
      expect((vertices[0] - centre) * nx + vertices[1] * ny + vertices[2] * nz).toBeGreaterThan(0);
    }
  });

  it('keeps normals outward for mirrored instances', async () => {
    const stl = await read(toStl([placed(new THREE.Matrix4().makeScale(-1, 1, 1))]));
    for (let t = 0; t < stl.count; t++) {
      const [nx, ny, nz, x, y, z] = stl.triangle(t);
      expect(x * nx + y * ny + z * nz).toBeGreaterThan(0);
    }
  });
});
