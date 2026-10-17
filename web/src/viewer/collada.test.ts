// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { sizeOf } from '../core/bounds';
import { readCollada } from './collada';

// A 1 × 2 × 3 box (12 triangles) as Collada in the given unit and up axis, red.
const CORNERS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1].map((v, i) => (v * ((i % 3) + 1)) / 2);
const TRIANGLES = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
const boxDae = (meter: number, upAxis: 'Y_UP' | 'Z_UP') =>
  new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit meter="${meter}"/><up_axis>${upAxis}</up_axis></asset>
  <library_effects>
    <effect id="red-fx"><profile_COMMON><technique sid="common"><phong>
      <diffuse><color>1 0 0 1</color></diffuse>
    </phong></technique></profile_COMMON></effect>
  </library_effects>
  <library_materials><material id="red" name="Red"><instance_effect url="#red-fx"/></material></library_materials>
  <library_geometries>
    <geometry id="box" name="Box"><mesh>
      <source id="box-pos">
        <float_array id="box-pos-array" count="${CORNERS.length}">${CORNERS.join(' ')}</float_array>
        <technique_common><accessor source="#box-pos-array" count="8" stride="3">
          <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
        </accessor></technique_common>
      </source>
      <vertices id="box-vtx"><input semantic="POSITION" source="#box-pos"/></vertices>
      <triangles material="mat" count="12"><input semantic="VERTEX" source="#box-vtx" offset="0"/><p>${TRIANGLES.join(' ')}</p></triangles>
    </mesh></geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene"><node id="box-node" name="Box">
      <instance_geometry url="#box"><bind_material><technique_common>
        <instance_material symbol="mat" target="#red"/>
      </technique_common></bind_material></instance_geometry>
    </node></visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>`).buffer;

describe('readCollada', () => {
  it('keeps the node tree and material colour', async () => {
    const model = await readCollada(boxDae(1, 'Z_UP'), 'Box.dae');
    expect(model.format).toBe('Collada');
    expect(model.nodes.map((n) => n.name)).toContain('Box');
    expect(model.colors.map((c) => c.slice(0, 3).map((v) => +v.toFixed(3)))).toEqual([[1, 0, 0]]);
    expect(model.triangles).toBe(12);
  });

  it('converts the file unit to mm and keeps Z up', async () => {
    const metres = await readCollada(boxDae(1, 'Z_UP'), 'Box.dae');
    expect(metres.unit).toBe('m');
    sizeOf(metres, null)!.forEach((v, i) => expect(v).toBeCloseTo([1000, 2000, 3000][i]));
    // Y-up: the file's Y becomes Z.
    const inches = await readCollada(boxDae(0.0254, 'Y_UP'), 'Box.dae');
    expect(inches.unit).toBe('in');
    sizeOf(inches, null)!.forEach((v, i) => expect(v).toBeCloseTo([25.4, 76.2, 50.8][i]));
  });

  it('explains files it cannot read', async () => {
    await expect(readCollada(new TextEncoder().encode('not xml').buffer, 'broken.dae')).rejects.toThrow(/Not a readable Collada file/);
  });
});
