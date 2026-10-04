/// <reference lib="webworker" />
// Runs OCCT (WASM) off the main thread. The file bytes stay in this tab; nothing is sent anywhere.
import type { WorkerRequest, WorkerResponse } from './protocol';

interface OcctModule {
  readStep(
    bytes: Uint8Array,
    options: object,
    onProgress: (stage: string, percent: number) => void,
  ): { json?: string; geometry?: Uint8Array; error?: string };
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let occt: Promise<OcctModule> | undefined;
function loadOcct(): Promise<OcctModule> {
  // Served from public/ (built by wasm/scripts/build-bridge.sh), so it is not bundled.
  const url = `${import.meta.env.BASE_URL}occt/occt-viewer.js`;
  occt ??= import(/* @vite-ignore */ url).then((m) => m.default());
  return occt;
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    const module = await loadOcct();
    const res = module.readStep(new Uint8Array(data.bytes), data.options ?? {}, (stage, percent) =>
      post({ type: 'progress', stage, percent }),
    );
    if (res.error || !res.json || !res.geometry) throw new Error(res.error ?? 'Empty result');
    // The view aliases WASM memory; copy it into a transferable buffer.
    const geometry = res.geometry.slice().buffer;
    post({ type: 'result', model: JSON.parse(res.json), geometry }, [geometry]);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
