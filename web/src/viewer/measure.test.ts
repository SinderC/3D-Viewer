import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { evaluate, type EdgePick, type FacePick } from './measure';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function face(normal: THREE.Vector3, point: THREE.Vector3, planar = true): FacePick {
  const plane = planar ? new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), point) : null;
  return { kind: 'face', point, triangles: new Float32Array(), plane };
}

function circle(radius: number, point: THREE.Vector3): EdgePick {
  return {
    kind: 'edge',
    point,
    segments: new Float32Array(),
    curve: 'circle',
    length: 2 * Math.PI * radius,
    radius,
    center: v(0, 0, 0),
    axis: v(0, 0, 1),
  };
}

describe('evaluate', () => {
  it('edge length', () => {
    expect(evaluate('edgeLength', [circle(5, v(5, 0, 0))], 'mm').text).toBe('31.416 mm');
  });

  it('radius and diameter of a circular edge, drawn towards the click', () => {
    const r = evaluate('edgeRadius', [circle(5, v(0, 6, 1))], 'mm');
    expect(r.text).toBe('R 5.000 mm');
    expect(r.lines[1].toArray()).toEqual([0, 5, 0]);
    expect(evaluate('edgeDiameter', [circle(5, v(0, 6, 1))], 'mm').text).toBe('Ø 10.000 mm');
  });

  it('rejects radius of a straight edge', () => {
    const line: EdgePick = { ...circle(0, v(0, 0, 0)), curve: 'line' };
    expect(evaluate('edgeRadius', [line], 'mm')).toMatchObject({ warn: true, text: 'Not a circular edge' });
  });

  it('distance between points', () => {
    expect(evaluate('pointDistance', [{ kind: 'point', point: v(0, 0, 0) }, { kind: 'point', point: v(3, 4, 0) }], 'mm').text).toBe(
      '5.000 mm',
    );
  });

  it('distance between parallel faces, independent of where they were clicked', () => {
    const r = evaluate('faceDistance', [face(v(0, 0, 1), v(5, 5, 0)), face(v(0, 0, -1), v(-3, 2, 25.4))], 'in');
    expect(r.text).toBe('1.0000 in');
    expect(r.warn).toBeUndefined();
  });

  it('rejects distance between non-parallel or non-planar faces', () => {
    expect(evaluate('faceDistance', [face(v(0, 0, 1), v(0, 0, 0)), face(v(1, 0, 0), v(1, 0, 0))], 'mm')).toMatchObject({
      warn: true,
      text: 'Faces not parallel (90.00°)',
    });
    expect(evaluate('faceDistance', [face(v(0, 0, 1), v(0, 0, 0)), face(v(0, 0, 1), v(0, 0, 1), false)], 'mm').warn).toBe(true);
  });

  it('angle between faces', () => {
    expect(evaluate('faceAngle', [face(v(0, 0, 1), v(0, 0, 0)), face(v(1, 0, 0), v(1, 0, 0))], 'mm').text).toBe('90.00°');
    expect(evaluate('faceAngle', [face(v(0, 0, 1), v(0, 0, 0)), face(v(0, 1, 1), v(1, 0, 0))], 'mm').text).toBe('45.00° (135.00°)');
    expect(evaluate('faceAngle', [face(v(0, 0, 1), v(0, 0, 0)), face(v(0, 0, -1), v(0, 0, 3))], 'mm').text).toBe('0.00° (parallel)');
  });

  it('distance from a point to a planar face, perpendicular to it', () => {
    const r = evaluate('pointFace', [{ kind: 'point', point: v(7, -2, 12) }, face(v(0, 0, 1), v(0, 0, 2))], 'mm');
    expect(r.text).toBe('10.000 mm');
    expect(r.lines.map((p) => p.toArray())).toEqual([
      [7, -2, 12],
      [7, -2, 2],
    ]);
    expect(evaluate('pointFace', [{ kind: 'point', point: v(0, 0, 0) }, face(v(0, 0, 1), v(0, 0, 2), false)], 'mm').warn).toBe(true);
  });

  it('point coordinates', () => {
    expect(evaluate('pointCoords', [{ kind: 'point', point: v(1, -2, 25.4) }], 'mm').text).toBe('X 1.000 mm   Y -2.000 mm   Z 25.400 mm');
  });
});
