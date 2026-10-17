import type { RawModel } from '../core/model';

export interface LoadOptions {
  linearDeflection?: number;
  angularDeflection?: number;
  maxDeflection?: number;
}

export type Quality = 'coarse' | 'normal' | 'fine';

// Mesh density presets. Normal uses the bridge defaults. Fine caps the deflection at 0.2 mm so large parts
// resolve small features (a fan blade's 1 mm edge round); a finer angle alone does not.
export const QUALITY: Record<Quality, { label: string; options: LoadOptions }> = {
  coarse: { label: 'Coarse', options: { linearDeflection: 0.003, angularDeflection: 0.8 } },
  normal: { label: 'Normal', options: {} },
  fine: { label: 'Fine', options: { maxDeflection: 0.2 } },
};

/** A file opened together with the one read, for the files a STEP assembly references. */
export interface OtherFile {
  name: string;
  bytes: ArrayBuffer;
}

export type WorkerRequest = { type: 'open'; bytes: ArrayBuffer; fileName: string; options?: LoadOptions; others?: OtherFile[] };

export type WorkerResponse =
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'result'; model: RawModel; geometry: ArrayBuffer }
  | { type: 'error'; message: string };
