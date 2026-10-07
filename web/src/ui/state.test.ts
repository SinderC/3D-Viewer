import { describe, expect, it } from 'vitest';
import type { Model } from '../core/model';
import { displayStyle, initialState, measureMode, reducer, type State } from './state';

describe('reducer', () => {
  it('close drops the model and keeps view preferences', () => {
    const open: State = {
      ...initialState,
      status: 'ready',
      fileName: 'part.step',
      model: {} as Model,
      selected: 3,
      hidden: new Set([1]),
      display: 'wireframe',
      ortho: false,
      grid: true,
      measureMode: 'edgeLength',
    };
    expect(reducer(open, { type: 'close' })).toEqual({
      ...initialState,
      display: 'wireframe',
      ortho: false,
      grid: true,
      measureMode: 'edgeLength',
    });
  });

  it('falls back to shading and point distance for models without edges', () => {
    const withEdges = { protos: [{ edges: new Float32Array(6) }] } as unknown as Model;
    const meshOnly = { protos: [{ edges: new Float32Array(0) }] } as unknown as Model;
    const state: State = { ...initialState, display: 'wireframe' };
    expect(displayStyle({ ...state, model: withEdges })).toBe('wireframe');
    expect(displayStyle({ ...state, model: meshOnly })).toBe('shaded');
    const edgeMeasure: State = { ...initialState, measureMode: 'edgeRadius' };
    expect(measureMode({ ...edgeMeasure, model: withEdges })).toBe('edgeRadius');
    expect(measureMode({ ...edgeMeasure, model: meshOnly })).toBe('pointDistance');
    expect(measureMode({ ...initialState, measureMode: 'faceAngle', model: meshOnly })).toBe('faceAngle');
  });
});
