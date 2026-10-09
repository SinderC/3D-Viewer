import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sizeOf } from '../core/bounds';
import { readGltf } from './gltf';

// three's FileLoader, used for the data-URI buffers, reports progress with this browser class.
globalThis.ProgressEvent ??= class extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
} as unknown as typeof ProgressEvent;

const sample = (name: string) => {
  const b = readFileSync(new URL(`../../../samples/formats/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

describe('readGltf', () => {
  it('keeps the material and converts metres, Y-up to mm, Z-up', async () => {
    const model = await readGltf(sample('Box.gltf'), 'Box.gltf');
    expect(model.format).toBe('glTF');
    expect(model.nodes[0].name).toBe('Box.gltf');
    expect(model.colors.map((c) => c.map((v) => +v.toFixed(3)))).toEqual([[0.906, 0, 0, 1]]); // linear 0.8 red, as sRGB
    expect(model.materials).toHaveLength(1);
    expect(model.triangles).toBe(12);
    sizeOf(model, null)!.forEach((v) => expect(v).toBeCloseTo(1000)); // the 1 m cube
  });

  it('keeps vertex colours', async () => {
    const model = await readGltf(sample('BoxVertexColors.gltf'), 'BoxVertexColors.gltf');
    const proto = model.protos[0];
    expect(proto.vertexColors?.itemSize).toBeGreaterThanOrEqual(3);
    expect(proto.vertexColors!.array.length / proto.vertexColors!.itemSize).toBe(proto.positions.length / 3);
  });

  it('explains files it cannot read', async () => {
    await expect(readGltf(new TextEncoder().encode('{"asset":{"version":"2.0"}}').buffer, 'empty.gltf')).rejects.toThrow(/no scene/);
    await expect(readGltf(new ArrayBuffer(8), 'broken.glb')).rejects.toThrow(/Not a readable glTF file/);
  });
});
