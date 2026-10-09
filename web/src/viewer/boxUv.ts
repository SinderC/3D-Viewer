// Texture coordinates for geometry that has none (CAD): each vertex projected onto the plane facing
// its normal's main axis, in metres, so a texture tiles at a physical size whatever the part's size.

/** UVs in metres from mm positions; seams show where the main axis changes across a curved face. */
export function boxUvs(positions: ArrayLike<number>, normals: ArrayLike<number>): Float32Array {
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    const [x, y, z] = [positions[i] / 1000, positions[i + 1] / 1000, positions[i + 2] / 1000];
    const [ax, ay, az] = [Math.abs(normals[i]), Math.abs(normals[i + 1]), Math.abs(normals[i + 2])];
    if (ax >= ay && ax >= az) uvs.set([y, z], j);
    else if (ay >= az) uvs.set([x, z], j);
    else uvs.set([x, y], j);
  }
  return uvs;
}
