import type { Dispatch, RefObject } from 'react';
import { UNITS, type UnitId } from '../core/units';
import { MEASURE_MODES, type MeasureMode } from '../viewer/measure';
import { QUALITY, type Quality } from '../worker/protocol';
import type { Axis, ViewName, Viewer } from '../viewer/Viewer';
import type { Action, State } from './state';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  viewer: RefObject<Viewer | null>;
  onOpen: () => void;
  quality: Quality;
  onQuality: (q: Quality) => void;
}

const VIEWS: ViewName[] = ['iso', 'front', 'top', 'right'];

export function Toolbar({ state, dispatch, viewer, onOpen, quality, onQuality }: Props) {
  const ready = state.status === 'ready';
  const { section } = state;
  return (
    <header className="toolbar">
      <button onClick={onOpen} className="primary">
        Open STEP…
      </button>
      <label title="Mesh quality (reloads the model)">
        Quality{' '}
        <select value={quality} disabled={state.status === 'loading'} onChange={(e) => onQuality(e.target.value as Quality)}>
          {Object.entries(QUALITY).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={!ready}>
        <span className="sep" />
        <button onClick={() => viewer.current?.fit()} title="Fit all (F)">
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
          title="Measure (M)"
        >
          Measure
        </button>
        <select
          value={state.measureMode}
          aria-label="Measurement"
          onChange={(e) => dispatch({ type: 'setMeasureMode', mode: e.target.value as MeasureMode })}
        >
          {Object.entries(MEASURE_MODES).map(([mode, { label }]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
        <select value={state.unit} aria-label="Units" onChange={(e) => dispatch({ type: 'setUnit', unit: e.target.value as UnitId })}>
          {Object.entries(UNITS).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
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
