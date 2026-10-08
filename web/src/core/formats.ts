// File types the WASM bridge reads (see readDoc in wasm/src/bridge.cpp).
export const FORMATS = [
  { name: 'STEP', extensions: ['.stp', '.step'], mime: 'model/step' },
  { name: 'JT', extensions: ['.jt'], mime: 'model/jt' },
  { name: 'STL', extensions: ['.stl'], mime: 'model/stl' },
  { name: 'IGES', extensions: ['.igs', '.iges'], mime: 'model/iges' },
  { name: 'glTF', extensions: ['.gltf'], mime: 'model/gltf+json' },
  { name: 'GLB', extensions: ['.glb'], mime: 'model/gltf-binary' },
  { name: 'OBJ', extensions: ['.obj'], mime: 'model/obj' },
  { name: 'VRML', extensions: ['.wrl', '.vrml'], mime: 'model/vrml' },
  { name: 'BREP', extensions: ['.brep', '.brp'], mime: 'application/octet-stream' },
];

export const EXTENSIONS = FORMATS.flatMap((f) => f.extensions);

export function isSupported(fileName: string): boolean {
  const name = fileName.toLowerCase();
  return EXTENSIONS.some((ext) => name.endsWith(ext));
}
