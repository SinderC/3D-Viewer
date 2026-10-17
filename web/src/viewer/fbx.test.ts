import { describe, expect, it } from 'vitest';
import { sizeOf } from '../core/bounds';
import { readFbx } from './fbx';

// A 1 × 2 × 3 box as ASCII FBX 7.4 in metres (UnitScaleFactor 100 cm), Z-up, red on five faces and blue on one.
const CORNERS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1].map((v, i) => (v * ((i % 3) + 1)) / 2);
const QUADS = [0, 3, 2, 1, 4, 5, 6, 7, 0, 1, 5, 4, 1, 2, 6, 5, 2, 3, 7, 6, 3, 0, 4, 7];
const cubeFbx = (unitScaleFactor = 100) =>
  new TextEncoder().encode(`; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",2
		P: "UpAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",${unitScaleFactor}
	}
}
Objects:  {
	Geometry: 1000, "Geometry::Cube", "Mesh" {
		Vertices: *${CORNERS.length} {
			a: ${CORNERS.join(',')}
		}
		PolygonVertexIndex: *${QUADS.length} {
			a: ${QUADS.map((v, i) => (i % 4 === 3 ? -v - 1 : v)).join(',')}
		}
		GeometryVersion: 124
		LayerElementMaterial: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "ByPolygon"
			ReferenceInformationType: "IndexToDirect"
			Materials: *6 {
				a: 0,0,0,0,0,1
			}
		}
		Layer: 0 {
			Version: 100
			LayerElement:  {
				Type: "LayerElementMaterial"
				TypedIndex: 0
			}
		}
	}
	Model: 2000, "Model::Cube", "Mesh" {
		Version: 232
		Properties70:  {
		}
	}
	Material: 3000, "Material::Red", "" {
		ShadingModel: "phong"
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",1,0,0
		}
	}
	Material: 3001, "Material::Blue", "" {
		ShadingModel: "phong"
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",0,0,1
		}
	}
}
Connections:  {
	C: "OO",2000,0
	C: "OO",1000,2000
	C: "OO",3000,2000
	C: "OO",3001,2000
}
`).buffer;

describe('readFbx', () => {
  it('keeps the node tree and one colour per material group', async () => {
    const model = await readFbx(cubeFbx(), 'Cube.fbx');
    expect(model.format).toBe('FBX');
    expect(model.nodes.map((n) => n.name)).toEqual(['Cube.fbx', 'Cube']);
    expect(model.colors.map((c) => c.slice(0, 3).map((v) => +v.toFixed(3)))).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ]);
    const { groups } = model.protos[model.nodes[1].proto];
    expect(groups.map((g) => g.color)).toEqual([0, 1]);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(36);
    expect(model.triangles).toBe(12);
  });

  it('converts file units to mm and keeps Z up', async () => {
    const metres = await readFbx(cubeFbx(), 'Cube.fbx');
    expect(metres.unit).toBe('m');
    sizeOf(metres, null)!.forEach((v, i) => expect(v).toBeCloseTo([1000, 2000, 3000][i]));
    const centimetres = await readFbx(cubeFbx(1), 'Cube.fbx');
    expect(centimetres.unit).toBe('cm');
    sizeOf(centimetres, null)!.forEach((v, i) => expect(v).toBeCloseTo([10, 20, 30][i]));
  });

  it('explains files it cannot read', async () => {
    await expect(readFbx(new ArrayBuffer(8), 'broken.fbx')).rejects.toThrow(/Not a readable FBX file/);
  });
});
