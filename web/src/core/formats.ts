// Supported file types and what reads them: the WASM bridge (readDoc in wasm/src/bridge.cpp) or
// three.js in the browser (viewer/gltf.ts), which keeps glTF textures and vertex colours.
export const FORMATS = [
  { name: 'STEP', extensions: ['.stp', '.step'], mime: 'model/step' },
  { name: 'JT', extensions: ['.jt'], mime: 'model/jt' },
  { name: 'STL', extensions: ['.stl'], mime: 'model/stl' },
  { name: 'IGES', extensions: ['.igs', '.iges'], mime: 'model/iges' },
  { name: 'glTF', extensions: ['.gltf'], mime: 'model/gltf+json', reader: 'three' },
  { name: 'GLB', extensions: ['.glb'], mime: 'model/gltf-binary', reader: 'three' },
  { name: 'OBJ', extensions: ['.obj'], mime: 'model/obj' },
  { name: 'VRML', extensions: ['.wrl', '.vrml'], mime: 'model/vrml' },
  { name: 'BREP', extensions: ['.brep', '.brp'], mime: 'application/octet-stream' },
];

const formatOf = (fileName: string) => {
  const name = fileName.toLowerCase();
  return FORMATS.find((f) => f.extensions.some((ext) => name.endsWith(ext)));
};

/** Who reads the file: the WASM bridge, or three.js. */
export const readerOf = (fileName: string): 'occt' | 'three' => (formatOf(fileName)?.reader === 'three' ? 'three' : 'occt');

export const EXTENSIONS = FORMATS.flatMap((f) => f.extensions);

export function isSupported(fileName: string): boolean {
  return formatOf(fileName) !== undefined;
}
