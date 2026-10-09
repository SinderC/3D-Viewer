// glTF / GLB read by three.js, which keeps what OCCT drops (textures, vertex colours, PBR maps),
// converted into the app's Model: one node per glTF node, one prototype per mesh primitive.
import * as THREE from 'three';
import type { Model, ModelNode, Proto } from '../core/model';

// glTF is in metres and Y-up; models here are in mm and Z-up.
const TO_MODEL = new THREE.Matrix4().makeRotationX(Math.PI / 2).scale(new THREE.Vector3(1000, 1000, 1000));

const EMPTY_F32 = new Float32Array(0);
const EMPTY_U32 = new Uint32Array(0);

// Plain float copy of an attribute, whatever its layout (interleaved, normalised integers…).
function floats(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  return out;
}

function proto(geometry: THREE.BufferGeometry, color: number): Proto {
  if (!geometry.getAttribute('normal')) {
    geometry = geometry.clone();
    geometry.computeVertexNormals();
  }
  const position = geometry.getAttribute('position');
  const indices = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
  const uv = geometry.getAttribute('uv');
  const vertexColor = geometry.getAttribute('color');
  return {
    positions: floats(position),
    normals: floats(geometry.getAttribute('normal')),
    indices,
    edges: EMPTY_F32,
    faceStarts: new Uint32Array([0]), // the whole mesh as one non-planar face, like the other mesh formats
    faceData: new Float64Array(7),
    edgeStarts: EMPTY_U32,
    edgeData: new Float64Array(0),
    groups: [{ start: 0, count: indices.length, color }],
    uvs: uv && floats(uv),
    vertexColors: vertexColor && { array: floats(vertexColor), itemSize: vertexColor.itemSize as 3 | 4 },
  };
}

/** Reads a .glb, or a .gltf with embedded buffers and images. */
export async function readGltf(bytes: ArrayBuffer, fileName: string): Promise<Model> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  let scene: THREE.Group | undefined;
  try {
    scene = (await new GLTFLoader().parseAsync(bytes, '')).scene;
  } catch (e) {
    // External files cannot be fetched; compressed data needs decoders that are not bundled.
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Not a readable glTF file (${reason}). Buffers and images must be embedded, or use .glb; Draco, meshopt and KTX2 compression are not supported.`);
  }

  if (!scene) throw new Error('The glTF file has no scene to show');

  const nodes: ModelNode[] = [];
  const protos: Proto[] = [];
  const colors: Model['colors'] = [];
  const materials: THREE.Material[] = [];
  const colorOf = new Map<THREE.Material, number>();
  const protoOf = new Map<string, number>(); // geometry + material: instances share both

  const colorIndex = (m: THREE.Material) => {
    let i = colorOf.get(m);
    if (i === undefined) {
      const c = 'color' in m && m.color instanceof THREE.Color ? m.color.clone() : new THREE.Color(1, 1, 1);
      const { r, g, b } = c.getRGB(new THREE.Color(), THREE.SRGBColorSpace);
      colorOf.set(m, (i = colors.length));
      colors.push([r, g, b, m.transparent ? m.opacity : 1]);
      materials.push(m);
    }
    return i;
  };

  const add = (name: string, parent: number, matrix?: THREE.Matrix4): ModelNode => {
    const node: ModelNode = { id: nodes.length, name, parent, children: [], proto: -1, color: -1, matrix: matrix?.toArray() };
    nodes.push(node);
    if (parent >= 0) nodes[parent].children.push(node.id);
    return node;
  };

  const visit = (o: THREE.Object3D, parent: number) => {
    o.updateMatrix();
    const node = add(o.name, parent, o.matrix);
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
      const color = colorIndex(o.material);
      const key = `${o.geometry.uuid}:${color}`;
      let p = protoOf.get(key);
      if (p === undefined) protoOf.set(key, (p = protos.push(proto(o.geometry, color)) - 1));
      node.proto = p;
    }
    for (const c of o.children) visit(c, node.id);
  };
  const root = add(fileName, -1, TO_MODEL);
  for (const c of scene.children) visit(c, root.id);

  return {
    schema: '',
    format: 'glTF',
    unit: 'm',
    colors,
    materials,
    nodes,
    roots: [root.id],
    protos,
    triangles: nodes.reduce((t, n) => (n.proto >= 0 ? t + protos[n.proto].indices.length / 3 : t), 0),
    pmi: [],
    views: [],
    products: [],
    counts: {},
  };
}
