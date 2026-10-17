// 3MF read by three.js (OCCT has no 3MF reader) and converted like glTF, by sceneToModel.
import * as THREE from 'three';
import type { Model } from '../core/model';
import type { UnitId } from '../core/units';
import { sceneToModel } from './gltf';

// 3MF is Z-up; its unit is one of these, mm when the file names none.
const UNITS: Record<string, [mm: number, unit: UnitId]> = {
  micron: [0.001, 'mm'],
  millimeter: [1, 'mm'],
  centimeter: [10, 'cm'],
  meter: [1000, 'm'],
  inch: [25.4, 'in'],
  foot: [304.8, 'ft'],
};

/** Reads a .3mf with its colours and textures. */
export async function read3mf(bytes: ArrayBuffer, fileName: string): Promise<Model> {
  const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
  const { unzipSync, strFromU8 } = await import('three/examples/jsm/libs/fflate.module.js');
  let scene: THREE.Group;
  let unit: string | undefined;
  try {
    scene = new ThreeMFLoader().parse(bytes);
    // The loader reads the unit but does not apply it.
    const parts = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name.toLowerCase().endsWith('.model') });
    unit = Object.values(parts).map((p) => /<model[^>]*\sunit="([^"]*)"/.exec(strFromU8(p))?.[1]).find(Boolean);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Not a readable 3MF file (${reason}).`);
  }
  const [mm, id] = UNITS[unit ?? 'millimeter'] ?? UNITS.millimeter;
  return sceneToModel(scene, fileName, '3MF', new THREE.Matrix4().makeScale(mm, mm, mm), id);
}
