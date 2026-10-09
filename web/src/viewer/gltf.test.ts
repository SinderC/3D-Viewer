import * as THREE from 'three';
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

// A 1 m cube as a .gltf with an embedded buffer, linear 0.8 red, optionally with vertex colours.
function cubeGltf(vertexColors = false): ArrayBuffer {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const index = new Uint16Array(box.getIndex()!.array); // 72 bytes, so the floats after it stay aligned
  const position = box.getAttribute('position').array as Float32Array;
  const normal = box.getAttribute('normal').array as Float32Array;
  const arrays = [index, position, normal, ...(vertexColors ? [new Float32Array(position.length).fill(0.5)] : [])];
  const bytes = new Uint8Array(arrays.reduce((n, a) => n + a.byteLength, 0));
  let offset = 0;
  const bufferViews = arrays.map((a) => {
    bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offset);
    const view = { buffer: 0, byteOffset: offset, byteLength: a.byteLength };
    offset += a.byteLength;
    return view;
  });
  const vec3 = (bufferView: number) => ({ bufferView, componentType: 5126, count: position.length / 3, type: 'VEC3' });
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 1, NORMAL: 2, ...(vertexColors ? { COLOR_0: 3 } : {}) },
            indices: 0,
            material: 0,
          },
        ],
      },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0, 0, 1] } }],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5123, count: index.length, type: 'SCALAR' },
      { ...vec3(1), min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      vec3(2),
      ...(vertexColors ? [vec3(3)] : []),
    ],
  };
  return new TextEncoder().encode(JSON.stringify(gltf)).buffer;
}

describe('readGltf', () => {
  it('keeps the material and converts metres, Y-up to mm, Z-up', async () => {
    const model = await readGltf(cubeGltf(), 'Box.gltf');
    expect(model.format).toBe('glTF');
    expect(model.nodes[0].name).toBe('Box.gltf');
    expect(model.colors.map((c) => c.map((v) => +v.toFixed(3)))).toEqual([[0.906, 0, 0, 1]]); // linear 0.8 red, as sRGB
    expect(model.materials).toHaveLength(1);
    expect(model.triangles).toBe(12);
    sizeOf(model, null)!.forEach((v) => expect(v).toBeCloseTo(1000)); // the 1 m cube
  });

  it('keeps vertex colours', async () => {
    const model = await readGltf(cubeGltf(true), 'BoxVertexColors.gltf');
    const proto = model.protos[0];
    expect(proto.vertexColors?.itemSize).toBeGreaterThanOrEqual(3);
    expect(proto.vertexColors!.array.length / proto.vertexColors!.itemSize).toBe(proto.positions.length / 3);
  });

  it('explains files it cannot read', async () => {
    await expect(readGltf(new TextEncoder().encode('{"asset":{"version":"2.0"}}').buffer, 'empty.gltf')).rejects.toThrow(/no scene/);
    await expect(readGltf(new ArrayBuffer(8), 'broken.glb')).rejects.toThrow(/Not a readable glTF file/);
  });
});
