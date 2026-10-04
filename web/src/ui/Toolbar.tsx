import type { Dispatch, RefObject } from 'react';
import type { Axis, ViewName, Viewer } from '../viewer/Viewer';
import type { Action, State } from './state';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  viewer: RefObject<Viewer | null>;
  onOpen: () => void;
}

const VIEWS: ViewName[] = ['iso', 'front', 'top', 'right'];

export function Toolbar({ state, dispatch, viewer, onOpen }: Props) {
  const ready = state.status === 'ready';
  const { section } = state;
  return (
    <header className="toolbar">
      <button onClick={onOpen} className="primary">
        Open STEP…
      </button>
      <fieldset disabled={!ready}>
        <span className="sep" />
        <button onClick={() => viewer.current?.setView('iso')} title="Fit all (F)">
          Fit
        </button>
        {VIEWS.map((v) => (
          <button key={v} onClick={() => viewer.current?.setView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
        <label className="toggle">
          <input type="checkbox" checked={state.ortho} onChange={() => dispatch({ type: 'toggleOrtho' })} /> Ortho
        </label>
        <label className="toggle">
          <input type="checkbox" checked={state.edges} onChange={() => dispatch({ type: 'toggleEdges' })} /> Edges
        </label>
        <span className="sep" />
        <button
          aria-pressed={state.tool === 'measure'}
          onClick={() => dispatch({ type: 'setTool', tool: state.tool === 'measure' ? 'select' : 'measure' })}
          title="Click two points (M)"
        >
          Measure
        </button>
        <span className="sep" />
        <label>
          Section{' '}
          <select
            value={section.axis ?? ''}
            onChange={(e) => dispatch({ type: 'setSection', section: { axis: (e.target.value || null) as Axis | null } })}
          >
            <option value="">off</option>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </label>
        {section.axis && (
          <>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={section.position}
              aria-label="Section position"
              onChange={(e) => dispatch({ type: 'setSection', section: { position: Number(e.target.value) } })}
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={section.flip}
                onChange={() => dispatch({ type: 'setSection', section: { flip: !section.flip } })}
              />{' '}
              Flip
            </label>
          </>
        )}
        <span className="sep" />
        <button onClick={() => dispatch({ type: 'setHidden', hidden: new Set() })}>Show all</button>
      </fieldset>
    </header>
  );
}
