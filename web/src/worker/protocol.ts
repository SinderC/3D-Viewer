import type { RawModel } from '../core/model';

export interface LoadOptions {
  linearDeflection?: number;
  angularDeflection?: number;
}

export type WorkerRequest = { type: 'open'; bytes: ArrayBuffer; options?: LoadOptions };

export type WorkerResponse =
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'result'; model: RawModel; geometry: ArrayBuffer }
  | { type: 'error'; message: string };
