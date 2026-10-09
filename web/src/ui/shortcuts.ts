// Keyboard shortcuts: one table drives both the key handler (App.tsx) and the help dialog.
import type { Dispatch } from 'react';
import type { DisplayStyle, ViewName, Viewer } from '../viewer/Viewer';
import { displayStyle, hasEdges, isolate, needsEdges, type Action, type State } from './state';
import { MAC } from './Toolbar';
import { VIEWS } from './ViewBar';

export interface ShortcutContext {
  state: State;
  dispatch: Dispatch<Action>;
  viewer: Viewer | null;
  openFile: () => void;
  showHelp: () => void;
}

export interface Shortcut {
  /** KeyboardEvent.key, so Shift is part of it ("F" is Shift+F). */
  key: string;
  /** Needs Cmd (macOS) or Ctrl. */
  mod?: boolean;
  label: string;
  group: 'General' | 'View' | 'Display' | 'Parts' | 'Measure';
  run: (ctx: ShortcutContext) => void;
}

const DISPLAY_CYCLE: DisplayStyle[] = ['shadedEdges', 'shaded', 'realistic', 'wireframe'];

const hideSelected = ({ state, dispatch }: ShortcutContext) => {
  if (state.selected === null) return;
  dispatch({ type: 'setHidden', hidden: new Set(state.hidden).add(state.selected) });
  dispatch({ type: 'select', id: null });
};

export const SHORTCUTS: Shortcut[] = [
  { key: 'o', mod: true, label: 'Open a file', group: 'General', run: (c) => c.openFile() },
  { key: '?', label: 'Keyboard shortcuts', group: 'General', run: (c) => c.showHelp() },
  {
    key: 'Escape',
    label: 'Stop measuring, clear the selection',
    group: 'General',
    run: ({ dispatch }) => {
      dispatch({ type: 'setTool', tool: 'select' });
      dispatch({ type: 'select', id: null });
    },
  },
  { key: 'f', label: 'Fit all', group: 'View', run: (c) => c.viewer?.fit() },
  { key: 'F', label: 'Zoom to selection', group: 'View', run: (c) => c.viewer?.fitSelection() },
  ...(Object.entries(VIEWS) as [ViewName, string][]).map(([view, label], i): Shortcut => ({
    key: String(i + 1),
    label: `${label} view`,
    group: 'View',
    run: (c) => c.viewer?.setView(view),
  })),
  { key: 'o', label: 'Orthographic', group: 'View', run: (c) => c.dispatch({ type: 'toggleOrtho' }) },
  {
    key: 'd',
    label: 'Next display style',
    group: 'Display',
    run: ({ state, dispatch }) => {
      const styles = DISPLAY_CYCLE.filter((s) => hasEdges(state.model) || !needsEdges(s));
      const next = styles[(styles.indexOf(displayStyle(state)) + 1) % styles.length];
      dispatch({ type: 'setDisplay', display: next });
    },
  },
  { key: 'g', label: 'Ground grid', group: 'Display', run: (c) => c.dispatch({ type: 'toggleGrid' }) },
  { key: 'p', label: 'PMI', group: 'Display', run: (c) => c.dispatch({ type: 'togglePmi' }) },
  { key: 'h', label: 'Hide the selection', group: 'Parts', run: hideSelected },
  {
    key: 'i',
    label: 'Show only the selection',
    group: 'Parts',
    run: ({ state, dispatch }) => {
      if (state.model && state.selected !== null) dispatch({ type: 'setHidden', hidden: isolate(state.model, state.selected) });
    },
  },
  { key: 'x', label: 'Ghost hidden parts', group: 'Parts', run: (c) => c.dispatch({ type: 'toggleGhost' }) },
  { key: 'H', label: 'Show all', group: 'Parts', run: (c) => c.dispatch({ type: 'setHidden', hidden: new Set() }) },
  {
    key: 'm',
    label: 'Measure',
    group: 'Measure',
    run: ({ state, dispatch }) => dispatch({ type: 'setTool', tool: state.tool === 'measure' ? 'select' : 'measure' }),
  },
  { key: 'Backspace', label: 'Remove the last measurement', group: 'Measure', run: (c) => c.viewer?.undoMeasurement() },
];

/** The shortcut a key press triggers. Alt combinations and Cmd/Ctrl ones not listed stay with the browser. */
export function findShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): Shortcut | undefined {
  if (e.altKey) return undefined;
  const mod = e.metaKey || e.ctrlKey;
  return SHORTCUTS.find((s) => s.key === e.key && !!s.mod === mod);
}

const NAMES: Record<string, string> = { Escape: 'Esc', Backspace: MAC ? '⌫' : 'Backspace' };

/** How the key is written in menus and the help, e.g. "⇧F" or "Ctrl+O". */
export function keyLabel({ key, mod }: Pick<Shortcut, 'key' | 'mod'>): string {
  const shift = key.length === 1 && key !== key.toLowerCase() ? (MAC ? '⇧' : 'Shift+') : '';
  return `${mod ? (MAC ? '⌘' : 'Ctrl+') : ''}${shift}${NAMES[key] ?? key.toUpperCase()}`;
}
