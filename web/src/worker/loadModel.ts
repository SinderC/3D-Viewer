import { decodeModel, type Model } from '../core/model';
import type { LoadOptions, WorkerRequest, WorkerResponse } from './protocol';

export type Progress = (stage: string, percent: number) => void;

// One worker per load: OCCT's heap only grows, so a fresh worker returns memory to the OS.
export function loadModel(
  bytes: ArrayBuffer,
  fileName: string,
  onProgress: Progress,
  options?: LoadOptions,
): Promise<Model> {
  const worker = new Worker(new URL('./modelWorker.ts', import.meta.url), { type: 'module' });
  return new Promise<Model>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') return onProgress(data.stage, data.percent);
      worker.terminate();
      if (data.type === 'result') resolve(decodeModel(data.model, data.geometry));
      else reject(new Error(data.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker failed'));
    };
    const msg: WorkerRequest = { type: 'open', bytes, fileName, options };
    worker.postMessage(msg, [bytes]);
  });
}
