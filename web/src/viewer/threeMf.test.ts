// @vitest-environment happy-dom
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { describe, expect, it } from 'vitest';
import { sizeOf } from '../core/bounds';
import { read3mf } from './threeMf';

// A 1 × 2 × 3 box (12 triangles) as 3MF in the given unit, red with one blue triangle.
const CORNERS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1].map((v, i) => (v * ((i % 3) + 1)) / 2);
const TRIANGLES = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
const box3mf = (unit?: string) => {
  const vertices = Array.from({ length: 8 }, (_, i) => `<vertex x="${CORNERS[i * 3]}" y="${CORNERS[i * 3 + 1]}" z="${CORNERS[i * 3 + 2]}"/>`);
  const triangles = Array.from({ length: 12 }, (_, i) => {
    const [a, b, c] = TRIANGLES.slice(i * 3, i * 3 + 3);
    return `<triangle v1="${a}" v2="${b}" v3="${c}"${i === 11 ? ' pid="1" p1="1"' : ''}/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${unit ? ` unit="${unit}"` : ''}>
  <resources>
    <basematerials id="1">
      <base name="Red" displaycolor="#FF0000"/>
      <base name="Blue" displaycolor="#0000FF"/>
    </basematerials>
    <object id="2" name="Box" type="model" pid="1" pindex="0">
      <mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>
    </object>
  </resources>
  <build><item objectid="2"/></build>
</model>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  return zipSync({ '_rels/.rels': strToU8(rels), '3D/3dmodel.model': strToU8(model) }).buffer as ArrayBuffer;
};

describe('read3mf', () => {
  it('keeps the object and its material colours', async () => {
    const model = await read3mf(box3mf(), 'Box.3mf');
    expect(model.format).toBe('3MF');
    expect(model.triangles).toBe(12);
    const colors = model.colors.map((c) => c.slice(0, 3).map((v) => +v.toFixed(3)).join());
    expect(colors).toContain('1,0,0');
    expect(colors).toContain('0,0,1');
  });

  it('converts the file unit to mm and keeps Z up', async () => {
    const mm = await read3mf(box3mf(), 'Box.3mf');
    expect(mm.unit).toBe('mm');
    sizeOf(mm, null)!.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3][i]));
    const inches = await read3mf(box3mf('inch'), 'Box.3mf');
    expect(inches.unit).toBe('in');
    sizeOf(inches, null)!.forEach((v, i) => expect(v).toBeCloseTo([25.4, 50.8, 76.2][i]));
  });

  it('explains files it cannot read', async () => {
    await expect(read3mf(new ArrayBuffer(8), 'broken.3mf')).rejects.toThrow(/Not a readable 3MF file/);
  });
});
