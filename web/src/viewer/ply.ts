// PLY read by three.js (OCCT has no PLY reader) and converted like glTF, by sceneToModel.
import * as THREE from 'three';
import type { Model } from '../core/model';
import { sceneToModel } from './gltf';
import { DEFAULT_COLOR } from './Viewer';

/** Reads an ASCII or binary .ply mesh with its vertex colours; PLY has no units, so mm and Z-up like STL. */
export async function readPly(bytes: ArrayBuffer, fileName: string): Promise<Model> {
  const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
  let geometry: THREE.BufferGeometry;
  try {
    geometry = new PLYLoader().parse(bytes);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Not a readable PLY file (${reason}).`);
  }
  if (!geometry.index) throw new Error('The PLY file has no faces: point clouds are not supported.');
  const colored = geometry.hasAttribute('color');
  const material = new THREE.MeshStandardMaterial({ color: colored ? 0xffffff : DEFAULT_COLOR, vertexColors: colored });
  const scene = new THREE.Group().add(new THREE.Mesh(geometry, material));
  return sceneToModel(scene, fileName, 'PLY', new THREE.Matrix4(), 'mm');
}
