import { readerOf } from '../core/formats';
import { decodeModel, type Model } from '../core/model';
import { readCollada } from '../viewer/collada';
import { readFbx } from '../viewer/fbx';
import { readGltf } from '../viewer/gltf';
import { readPly } from '../viewer/ply';
import { read3mf } from '../viewer/threeMf';
import type { LoadOptions, OtherFile, WorkerRequest, WorkerResponse } from './protocol';

const THREE_READERS: Record<string, (bytes: ArrayBuffer, fileName: string) => Promise<Model>> = {
  fbx: readFbx,
  '3mf': read3mf,
  ply: readPly,
  dae: readCollada,
};

export type Progress = (stage: string, percent: number) => void;

// glTF, FBX, 3MF, PLY and Collada are read by three.js on this thread; everything else by the WASM bridge in a worker.
// One worker per load: OCCT's heap only grows, so a fresh worker returns memory to the OS.
// Aborting terminates the worker and rejects with the signal's reason. others: files opened with
// this one, for the parts a STEP assembly keeps in other files.
export function loadModel(
  bytes: ArrayBuffer,
  fileName: string,
  onProgress: Progress,
  options?: LoadOptions,
  signal?: AbortSignal,
  others: OtherFile[] = [],
): Promise<Model> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (readerOf(fileName) === 'three') {
    onProgress('read', -1);
    const read = THREE_READERS[fileName.toLowerCase().split('.').pop()!] ?? readGltf;
    return read(bytes, fileName).then((model) => (signal?.aborted ? Promise.reject(signal.reason) : model));
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
    const msg: WorkerRequest = { type: 'open', bytes, fileName, options, others };
    worker.postMessage(msg, [bytes, ...others.map((f) => f.bytes)]);
  });
}
