import type { RawModel } from '../core/model';

export interface LoadOptions {
  linearDeflection?: number;
  angularDeflection?: number;
}

export type Quality = 'coarse' | 'normal' | 'fine';

// Mesh density presets. Normal uses the bridge defaults.
export const QUALITY: Record<Quality, { label: string; options: LoadOptions }> = {
  coarse: { label: 'Coarse', options: { linearDeflection: 0.003, angularDeflection: 0.8 } },
  normal: { label: 'Normal', options: {} },
  fine: { label: 'Fine', options: { linearDeflection: 0.001, angularDeflection: 0.35 } },
};

export type WorkerRequest = { type: 'open'; bytes: ArrayBuffer; fileName: string; options?: LoadOptions };

export type WorkerResponse =
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'result'; model: RawModel; geometry: ArrayBuffer }
  | { type: 'error'; message: string };
