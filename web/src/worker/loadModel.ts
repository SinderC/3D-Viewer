import { readerOf } from '../core/formats';
import { decodeModel, type Model } from '../core/model';
import { readGltf } from '../viewer/gltf';
import type { LoadOptions, WorkerRequest, WorkerResponse } from './protocol';

export type Progress = (stage: string, percent: number) => void;

// glTF is read by three.js on this thread; everything else by the WASM bridge in a worker.
// One worker per load: OCCT's heap only grows, so a fresh worker returns memory to the OS.
// Aborting terminates the worker and rejects with the signal's reason.
export function loadModel(
  bytes: ArrayBuffer,
  fileName: string,
  onProgress: Progress,
  options?: LoadOptions,
  signal?: AbortSignal,
): Promise<Model> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (readerOf(fileName) === 'three') {
    onProgress('read', -1);
    return readGltf(bytes, fileName).then((model) => (signal?.aborted ? Promise.reject(signal.reason) : model));
  }
  const worker = new Worker(new URL('./modelWorker.ts', import.meta.url), { type: 'module' });
  return new Promise<Model>((resolve, reject) => {
    const abort = () => {
      worker.terminate();
      reject(signal!.reason);
    };
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') return onProgress(data.stage, data.percent);
      finish();
      if (data.type === 'result') resolve(decodeModel(data.model, data.geometry));
      else reject(new Error(data.message));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'Worker failed'));
    };
    const msg: WorkerRequest = { type: 'open', bytes, fileName, options };
    worker.postMessage(msg, [bytes]);
  });
}
