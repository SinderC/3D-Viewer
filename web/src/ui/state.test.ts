import { describe, expect, it } from 'vitest';
import type { Model } from '../core/model';
import { initialState, reducer, type State } from './state';

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
      measureMode: 'edgeLength',
    };
    expect(reducer(open, { type: 'close' })).toEqual({
      ...initialState,
      display: 'wireframe',
      ortho: false,
      measureMode: 'edgeLength',
    });
  });
});
