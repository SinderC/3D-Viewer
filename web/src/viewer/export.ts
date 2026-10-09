// The shown parts as files other tools read: STL (binary, mm) or GLB (binary glTF, metres, Y-up).
import * as THREE from 'three';

/** Binary STL of the meshes in world coordinates (mm), with normals from the triangle winding. */
export function toStl(meshes: THREE.Mesh[]): Blob {
  const triangles = (g: THREE.BufferGeometry) => (g.index ?? g.getAttribute('position')).count / 3;
  const count = meshes.reduce((n, m) => n + triangles(m.geometry), 0);
  const view = new DataView(new ArrayBuffer(84 + 50 * count)); // 80-byte header, count, 50 bytes per triangle
  view.setUint32(80, count, true);

  const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let o = 84;
  const write = (v: THREE.Vector3) => {
    view.setFloat32(o, v.x, true);
    view.setFloat32(o + 4, v.y, true);
    view.setFloat32(o + 8, v.z, true);
    o += 12;
  };
  for (const mesh of meshes) {
    const { index } = mesh.geometry;
    const pos = mesh.geometry.getAttribute('position');
    const vertex = (i: number) => (index ? index.getX(i) : i);
    const mirrored = mesh.matrixWorld.determinant() < 0; // flips the winding
    for (let t = 0; t < triangles(mesh.geometry) * 3; t += 3) {
      a.fromBufferAttribute(pos, vertex(t)).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, vertex(mirrored ? t + 2 : t + 1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, vertex(mirrored ? t + 1 : t + 2)).applyMatrix4(mesh.matrixWorld);
      write(n.subVectors(b, a).cross(c.clone().sub(a)).normalize());
      write(a);
      write(b);
      write(c);
      o += 2; // attribute byte count, 0
    }
  }
  return new Blob([view.buffer], { type: 'model/stl' });
}

/** GLB of the meshes with their colours and placement; instances share geometry. `upright` turns Z to the model's up axis. */
export async function toGlb(meshes: THREE.Mesh[], upright: THREE.Quaternion): Promise<Blob> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const root = new THREE.Group();
  root.scale.setScalar(0.001); // glTF is in metres
  // and Y-up: the model's up axis to Z, then Z to Y.
  root.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2).multiply(upright.clone().invert());
  for (const mesh of meshes) {
    const copy = new THREE.Mesh(mesh.geometry, mesh.userData.baseMaterial ?? mesh.material);
    copy.name = mesh.parent?.name ?? '';
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(mesh.matrixWorld);
    root.add(copy);
  }
  const glb = (await new GLTFExporter().parseAsync(root, { binary: true })) as ArrayBuffer;
  return new Blob([glb], { type: 'model/gltf-binary' });
}
