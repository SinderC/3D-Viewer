import type { Dispatch, ReactNode, RefObject } from 'react';
import { UNITS, type UnitId } from '../core/units';
import { MEASURE_MODES, type MeasureMode } from '../viewer/measure';
import type { Axis, DisplayStyle, ViewName, Viewer } from '../viewer/Viewer';
import {
  Chevron,
  ExplodeIcon,
  FitIcon,
  GhostIcon,
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
import { AppearanceMenu } from './AppearanceMenu';
import { Menu } from './Menu';
import { keyLabel } from './shortcuts';
import type { BarSize } from './ViewMenu';
import { canExplode, displayStyle, hasEdges, measureMode, unavailable, type Action, type State } from './state';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  viewer: RefObject<Viewer | null>;
  size: BarSize;
}

export const VIEWS: Record<ViewName, string> = {
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
export function ViewBar({ state, dispatch, viewer, size }: Props) {
  const { section } = state;
  const display = displayStyle(state);
  const edges = hasEdges(state.model);
  const mode = measureMode(state);
  const noEdges = 'This model has no edges';
  const measuring = state.tool === 'measure';
  return (
    <div className={`viewbar ${size}`}>
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
        title="Orthographic projection (O)"
        aria-label="Orthographic projection"
        aria-pressed={state.ortho}
        onClick={() => dispatch({ type: 'toggleOrtho' })}
      >
        <OrthoIcon />
      </button>
      <span className="sep" />
      <Menu up title="Display style (D)" className="icon wide" label={<>{DISPLAY[display].icon}<Chevron /></>}>
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
      <AppearanceMenu state={state} dispatch={dispatch} />
      <button
        className="icon"
        title="Ground grid (G)"
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
      {canExplode(state.model) && (
        <Menu up title="Exploded view" className="icon" pressed={state.explode > 0} label={<ExplodeIcon />}>
          <div className="menu-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.explode}
              aria-label="Explode"
              onChange={(e) => dispatch({ type: 'setExplode', amount: Number(e.target.value) })}
            />
            <button disabled={state.explode === 0} onClick={() => dispatch({ type: 'setExplode', amount: 0 })}>
              Reset
            </button>
          </div>
        </Menu>
      )}
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
          <button
            aria-pressed={section.axis === 'face' || state.tool === 'sectionFace'}
            title="Click a planar face to cut along it"
            onClick={(e) => {
              e.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
              dispatch({ type: 'setTool', tool: 'sectionFace' });
            }}
          >
            Face
          </button>
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
        {(Object.entries(MEASURE_MODES) as [MeasureMode, { label: string }][]).map(([id, { label }]) => (
          <button
            key={id}
            className="menu-item"
            aria-pressed={measuring && id === mode}
            disabled={!!unavailable(id, state.model)}
            title={unavailable(id, state.model)}
            onClick={() => dispatch({ type: 'setMeasureMode', mode: id })}
          >
            {label}
          </button>
        ))}
        <hr className="menu-sep" />
        <button className="menu-item" disabled={!measuring} onClick={() => viewer.current?.clearMeasurements()}>
          Clear measurements
        </button>
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
        title="Ghost hidden parts (X)"
        aria-label="Ghost hidden parts"
        aria-pressed={state.ghost}
        onClick={() => dispatch({ type: 'toggleGhost' })}
      >
        <GhostIcon />
      </button>
      <button
        className="icon"
        title={`Show all (${keyLabel({ key: 'H' })})`}
        aria-label="Show all"
        disabled={state.hidden.size === 0}
        onClick={() => dispatch({ type: 'setHidden', hidden: new Set() })}
      >
        <ShowAllIcon />
      </button>
    </div>
  );
}
