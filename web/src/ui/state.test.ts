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

describe('PMI state', () => {
  const model = {
    protos: [],
    pmi: [{}, {}, {}],
    views: [
      { name: 'MBD_A', direction: [0, 0, -1], up: [0, 1, 0], pmi: [0, 2] },
      { name: 'Front', direction: [0, 1, 0], up: [0, 0, 1], pmi: [] },
    ],
  } as unknown as Model;
  const ready: State = { ...initialState, status: 'ready', model, pmi: false };

  it('applying a view shows exactly its PMI', () => {
    const s = reducer(ready, { type: 'applyView', index: 0 });
    expect(s.pmi).toBe(true);
    expect([...s.hiddenPmi]).toEqual([1]);
    expect(s.view).toEqual({ index: 0 });
  });

  it('a view without PMI keeps the current visibility', () => {
    const s = reducer({ ...ready, hiddenPmi: new Set([2]) }, { type: 'applyView', index: 1 });
    expect(s.pmi).toBe(false);
    expect([...s.hiddenPmi]).toEqual([2]);
  });

  it('selecting a part clears the PMI selection and the other way round', () => {
    const s = reducer({ ...ready, selectedPmi: 1 }, { type: 'select', id: 4 });
    expect(s.selectedPmi).toBeNull();
    expect(reducer(s, { type: 'selectPmi', index: 2 }).selected).toBeNull();
  });
});
