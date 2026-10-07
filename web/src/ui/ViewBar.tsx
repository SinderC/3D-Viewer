import type { Dispatch, ReactNode, RefObject } from 'react';
import { UNITS, type UnitId } from '../core/units';
import { MEASURE_MODES, type MeasureMode } from '../viewer/measure';
import type { Axis, DisplayStyle, ViewName, Viewer } from '../viewer/Viewer';
import {
  Chevron,
  FitIcon,
  GridIcon,
  MeasureIcon,
  OrthoIcon,
  PmiIcon,
  SectionIcon,
  ShadedEdgesIcon,
  ShadedIcon,
  ShowAllIcon,
  ViewsIcon,
  WireframeIcon,
  ZoomSelectionIcon,
} from './icons';
import { Menu } from './Menu';
import { displayStyle, hasEdges, measureMode, type Action, type State } from './state';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  viewer: RefObject<Viewer | null>;
}

const VIEWS: Record<ViewName, string> = {
  iso: 'Isometric',
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};

const DISPLAY: Record<DisplayStyle, { label: string; icon: ReactNode }> = {
  shadedEdges: { label: 'Shaded with edges', icon: <ShadedEdgesIcon /> },
  shaded: { label: 'Shaded', icon: <ShadedIcon /> },
  wireframe: { label: 'Wireframe', icon: <WireframeIcon /> },
};

// Camera and display controls floating over the bottom of the viewport.
export function ViewBar({ state, dispatch, viewer }: Props) {
  const { section } = state;
  const display = displayStyle(state);
  const edges = hasEdges(state.model);
  const mode = measureMode(state);
  const noEdges = 'This model has no edges';
  const measuring = state.tool === 'measure';
  return (
    <div className="viewbar">
      <button className="icon" title="Fit all (F)" aria-label="Fit all" onClick={() => viewer.current?.fit()}>
        <FitIcon />
      </button>
      <button
        className="icon"
        title="Zoom to selection (Shift+F)"
        aria-label="Zoom to selection"
        disabled={state.selected === null}
        onClick={() => viewer.current?.fitSelection()}
      >
        <ZoomSelectionIcon />
      </button>
      <span className="sep" />
      <Menu up title="Standard views" className="icon wide" label={<><ViewsIcon /><Chevron /></>}>
        {Object.entries(VIEWS).map(([view, label]) => (
          <button key={view} className="menu-item" onClick={() => viewer.current?.setView(view as ViewName)}>
            {label}
          </button>
        ))}
      </Menu>
      <button
        className="icon"
        title="Orthographic projection"
        aria-label="Orthographic projection"
        aria-pressed={state.ortho}
        onClick={() => dispatch({ type: 'toggleOrtho' })}
      >
        <OrthoIcon />
      </button>
      <span className="sep" />
      <Menu up title="Display style" className="icon wide" label={<>{DISPLAY[display].icon}<Chevron /></>}>
        {Object.entries(DISPLAY).map(([id, { label, icon }]) => (
          <button
            key={id}
            className="menu-item"
            aria-pressed={id === display}
            disabled={!edges && id !== 'shaded'}
            title={!edges && id !== 'shaded' ? noEdges : undefined}
            onClick={() => dispatch({ type: 'setDisplay', display: id as DisplayStyle })}
          >
            {icon} {label}
          </button>
        ))}
      </Menu>
      <button
        className="icon"
        title="Ground grid"
        aria-label="Ground grid"
        aria-pressed={state.grid}
        onClick={() => dispatch({ type: 'toggleGrid' })}
      >
        <GridIcon />
      </button>
      {state.model!.pmi.length > 0 && (
        <button
          className="icon"
          title="PMI (P)"
          aria-label="PMI"
          aria-pressed={state.pmi}
          onClick={() => dispatch({ type: 'togglePmi' })}
        >
          <PmiIcon />
        </button>
      )}
      <span className="sep" />
      <Menu up title="Section" className="icon" pressed={section.axis !== null} label={<SectionIcon />}>
        <div className="menu-row">
          {([null, 'x', 'y', 'z'] as const).map((axis) => (
            <button
              key={axis ?? 'off'}
              aria-pressed={section.axis === axis}
              onClick={() => dispatch({ type: 'setSection', section: { axis: axis as Axis | null } })}
            >
              {axis?.toUpperCase() ?? 'Off'}
            </button>
          ))}
        </div>
        {section.axis && (
          <div className="menu-row">
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
          </div>
        )}
      </Menu>
      <button
        className="icon"
        title="Measure (M)"
        aria-label="Measure"
        aria-pressed={measuring}
        onClick={() => dispatch({ type: 'setTool', tool: measuring ? 'select' : 'measure' })}
      >
        <MeasureIcon />
      </button>
      <Menu up title="Measurement" className="icon narrow" label={<Chevron />}>
        {Object.entries(MEASURE_MODES).map(([id, { label, pick }]) => (
          <button
            key={id}
            className="menu-item"
            aria-pressed={measuring && id === mode}
            disabled={!edges && pick === 'edge'}
            title={!edges && pick === 'edge' ? noEdges : undefined}
            onClick={() => dispatch({ type: 'setMeasureMode', mode: id as MeasureMode })}
          >
            {label}
          </button>
        ))}
        <label className="menu-row">
          Units
          <select value={state.unit} onChange={(e) => dispatch({ type: 'setUnit', unit: e.target.value as UnitId })}>
            {Object.entries(UNITS).map(([id, { label }]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </Menu>
      <span className="sep" />
      <button
        className="icon"
        title="Show all"
        aria-label="Show all"
        disabled={state.hidden.size === 0}
        onClick={() => dispatch({ type: 'setHidden', hidden: new Set() })}
      >
        <ShowAllIcon />
      </button>
    </div>
  );
}
