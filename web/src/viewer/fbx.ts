// FBX read by three.js (OCCT has no FBX reader) and converted like glTF, by sceneToModel.
import * as THREE from 'three';
import type { Model } from '../core/model';
import type { UnitId } from '../core/units';
import { sceneToModel } from './gltf';

// FBX's UnitScaleFactor is centimetres per file unit.
const UNIT_OF_SCALE: Record<number, UnitId> = { 0.1: 'mm', 1: 'cm', 100: 'm', 2.54: 'in', 30.48: 'ft' };

/** Reads a binary or ASCII .fbx with its embedded textures. */
export async function readFbx(bytes: ArrayBuffer, fileName: string): Promise<Model> {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  let scene: THREE.Group;
  try {
    scene = new FBXLoader().parse(bytes, '');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Not a readable FBX file (${reason}). FBX 7.0 or later is required.`);
  }
  // The loader turns Z-up files Y-up; turn the scene Z-up, from file units to mm.
  const cm: number = scene.userData.unitScaleFactor ?? 1;
  const toModel = new THREE.Matrix4().makeRotationX(Math.PI / 2).scale(new THREE.Vector3(10 * cm, 10 * cm, 10 * cm));
  return sceneToModel(scene, fileName, 'FBX', toModel, UNIT_OF_SCALE[cm] ?? 'cm');
}
