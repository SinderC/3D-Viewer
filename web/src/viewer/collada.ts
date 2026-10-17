// Collada read by three.js (OCCT has no Collada reader) and converted like glTF, by sceneToModel.
import * as THREE from 'three';
import type { Model } from '../core/model';
import type { UnitId } from '../core/units';
import { sceneToModel } from './gltf';

// The loader scales the scene to metres and turns Z-up files Y-up, like glTF.
const TO_MODEL = new THREE.Matrix4().makeRotationX(Math.PI / 2).scale(new THREE.Vector3(1000, 1000, 1000));
const UNIT_OF_METRES: Record<number, UnitId> = { 0.001: 'mm', 0.01: 'cm', 1: 'm', 0.0254: 'in', 0.3048: 'ft' };
// Textures are separate files that cannot be fetched: white leaves the material colour as it is.
const WHITE_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

/** Reads a .dae; textures in other files are left out, embedded (data URI) ones kept. */
export async function readCollada(bytes: ArrayBuffer, fileName: string): Promise<Model> {
  const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
  const manager = new THREE.LoadingManager().setURLModifier((url) => (url.startsWith('data:') ? url : WHITE_PIXEL));
  let scene: THREE.Object3D | undefined;
  try {
    scene = new ColladaLoader(manager).parse(new TextDecoder().decode(bytes), '')?.scene;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Not a readable Collada file (${reason}).`);
  }
  if (!scene) throw new Error('Not a readable Collada file.');
  return sceneToModel(scene, fileName, 'Collada', TO_MODEL, UNIT_OF_METRES[scene.scale.x] ?? 'm');
}
