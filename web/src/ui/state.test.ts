import { describe, expect, it } from 'vitest';
import type { Model } from '../core/model';
import { appearanceOf, displayStyle, initialState, measureMode, reducer, searchTree, type State } from './state';

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
    expect(displayStyle({ ...state, display: 'realistic', model: meshOnly })).toBe('realistic'); // needs no edges
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

describe('searchTree', () => {
  // asm ─ sub ─ Bolt M8
  //     │     └ Nut
  //     └ bolt cover ─ cap
  const names = ['asm', 'sub', 'Bolt M8', 'Nut', 'bolt cover', 'cap'];
  const parents = [-1, 0, 1, 1, 0, 4];
  const children = names.map((_, i) => parents.flatMap((p, c) => (p === i ? [c] : [])));
  const model = { nodes: names.map((name, id) => ({ id, name, parent: parents[id], children: children[id] })) } as unknown as Model;

  it('shows matches, their ancestors expanded and their subtrees, ignoring case', () => {
    const r = searchTree(model, ' BOLT ')!;
    expect([...r.shown].sort()).toEqual([0, 1, 2, 4, 5]);
    expect([...r.expand].sort()).toEqual([0, 1]);
  });

  it('is null for an empty query', () => {
    expect(searchTree(model, '  ')).toBeNull();
  });
});

describe('appearances', () => {
  // 0 ─ 1 ─ 2
  //       └ 3
  const parents = [-1, 0, 1, 1];
  const model = {
    roots: [0],
    nodes: parents.map((parent, id) => ({ id, parent, children: parents.flatMap((p, c) => (p === id ? [c] : [])) })),
  } as unknown as Model;
  const loaded: State = { ...initialState, status: 'ready', model };
  const shown = (s: State) => [0, 1, 2, 3].map((id) => appearanceOf(model, s.appearances, id));

  it('applies to a subtree, the nearest setting winning', () => {
    let s = reducer(loaded, { type: 'setAppearance', id: null, appearance: 'brass' });
    s = reducer(s, { type: 'setAppearance', id: 2, appearance: 'rubber' });
    expect(shown(s)).toEqual(['brass', 'brass', 'rubber', 'brass']);
  });

  it('restores the file look under an appearance, and replaces settings below', () => {
    let s = reducer(loaded, { type: 'setAppearance', id: 2, appearance: 'rubber' });
    s = reducer(s, { type: 'setAppearance', id: null, appearance: 'brass' });
    expect(shown(s)).toEqual(['brass', 'brass', 'brass', 'brass']);
    s = reducer(s, { type: 'setAppearance', id: 3, appearance: null });
    expect(shown(s)).toEqual(['brass', 'brass', 'brass', undefined]);
    s = reducer(s, { type: 'setAppearance', id: 1, appearance: 'copper' });
    expect(shown(s)).toEqual(['brass', 'copper', 'copper', 'copper']);
    expect(reducer(s, { type: 'setAppearance', id: null, appearance: null }).appearances.size).toBe(0);
  });

  it('resets when another file opens', () => {
    const s = reducer(loaded, { type: 'setAppearance', id: null, appearance: 'brass' });
    expect(reducer(s, { type: 'loadStart', fileName: 'b.step', quality: 'normal' }).appearances.size).toBe(0);
  });
});
