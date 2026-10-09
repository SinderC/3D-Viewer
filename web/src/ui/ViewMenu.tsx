import { useEffect, useState, type Dispatch, type RefObject } from 'react';
import type { Viewer } from '../viewer/Viewer';
import { Menu, MenuItem, MenuChoices } from './Menu';
import type { Action, State } from './state';
import { MAC } from './Toolbar';

export const THEMES = { system: 'System', light: 'Light', dark: 'Dark' };
export type ThemeChoice = keyof typeof THEMES;
export const BAR_SIZES = { small: 'Small', regular: 'Regular', large: 'Large' };
export type BarSize = keyof typeof BAR_SIZES;

/** View settings kept across sessions (App.tsx). */
export interface ViewPrefs {
  sidebar: boolean;
  toggleSidebar: () => void;
  props: boolean;
  toggleProps: () => void;
  cube: boolean;
  toggleCube: () => void;
  axes: boolean;
  toggleAxes: () => void;
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  barSize: BarSize;
  setBarSize: (size: BarSize) => void;
}

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  viewer: RefObject<Viewer | null>;
  prefs: ViewPrefs;
  /** No properties panel in narrow windows (they show an Info tab instead). */
  narrow: boolean;
  onHelp: () => void;
}

const SHIFT = MAC ? '⇧' : 'Shift+';

function useFullscreen(): boolean {
  const [full, setFull] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  return full;
}

// Panels, viewport overlays and appearance; the view toolbar's toggles too, with their shortcuts.
export function ViewMenu({ state, dispatch, viewer, prefs, narrow, onHelp }: Props) {
  const full = useFullscreen();
  const loaded = state.status === 'ready';
  const measuring = state.tool === 'measure';
  return (
    <Menu title="View" label="View" className="menu-trigger" bar>
      <MenuItem label="Sidebar" checked={prefs.sidebar} onClick={prefs.toggleSidebar} />
      {!narrow && <MenuItem label="Properties" checked={prefs.props} onClick={prefs.toggleProps} />}
      <hr className="menu-sep" />
      <MenuItem label="View cube" checked={prefs.cube} onClick={prefs.toggleCube} />
      <MenuItem label="Axes" checked={prefs.axes} onClick={prefs.toggleAxes} />
      <MenuItem label="Ground grid" kbd="G" checked={state.grid} onClick={() => dispatch({ type: 'toggleGrid' })} />
      <MenuItem label="Orthographic" kbd="O" checked={state.ortho} onClick={() => dispatch({ type: 'toggleOrtho' })} />
      <MenuItem
        label="PMI"
        kbd="P"
        checked={state.pmi}
        disabled={!state.model?.pmi.length}
        onClick={() => dispatch({ type: 'togglePmi' })}
      />
      <MenuItem
        label="Measure"
        kbd="M"
        checked={measuring}
        disabled={!loaded}
        onClick={() => dispatch({ type: 'setTool', tool: measuring ? 'select' : 'measure' })}
      />
      <hr className="menu-sep" />
      <MenuItem label="Fit all" kbd="F" disabled={!loaded} onClick={() => viewer.current?.fit()} />
      <MenuItem
        label="Zoom to selection"
        kbd={`${SHIFT}F`}
        disabled={state.selected === null}
        onClick={() => viewer.current?.fitSelection()}
      />
      {document.fullscreenEnabled && (
        <>
          <hr className="menu-sep" />
          <MenuItem
            label="Full screen"
            checked={full}
            onClick={() => (full ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
          />
        </>
      )}
      <hr className="menu-sep" />
      <MenuChoices label="Theme" options={THEMES} value={prefs.theme} onChange={prefs.setTheme} />
      <hr className="menu-sep" />
      <MenuChoices label="Toolbar size" options={BAR_SIZES} value={prefs.barSize} onChange={prefs.setBarSize} />
      <hr className="menu-sep" />
      <MenuItem label="Keyboard shortcuts" kbd="?" onClick={onHelp} />
    </Menu>
  );
}
