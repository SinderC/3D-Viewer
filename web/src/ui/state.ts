import type { Model } from '../core/model';
import type { UnitId } from '../core/units';
import type { MeasureMode } from '../viewer/measure';
import type { DisplayStyle, Section, Tool } from '../viewer/Viewer';

export interface State {
  status: 'idle' | 'loading' | 'ready' | 'error';
  fileName?: string;
  progress?: { stage: string; percent: number };
  error?: string;
  loadMs?: number;
  model?: Model;
  hidden: ReadonlySet<number>;
  selected: number | null;
  tool: Tool;
  measureMode: MeasureMode;
  unit: UnitId;
  section: Section;
  display: DisplayStyle;
  ortho: boolean;
}

export type Action =
  | { type: 'loadStart'; fileName: string }
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'loaded'; model: Model; ms: number }
  | { type: 'failed'; error: string }
  | { type: 'close' }
  | { type: 'setHidden'; hidden: ReadonlySet<number> }
  | { type: 'select'; id: number | null }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setMeasureMode'; mode: MeasureMode }
  | { type: 'setUnit'; unit: UnitId }
  | { type: 'setSection'; section: Partial<Section> }
  | { type: 'setDisplay'; display: DisplayStyle }
  | { type: 'toggleOrtho' };

const noSection: Section = { axis: null, position: 0.5, flip: false };

export const initialState: State = {
  status: 'idle',
  hidden: new Set(),
  selected: null,
  tool: 'select',
  measureMode: 'pointDistance',
  unit: 'mm',
  section: noSection,
  display: 'shadedEdges',
  ortho: true,
};

// View preferences survive opening and closing files.
const keepPrefs = ({ display, ortho, measureMode }: State): State => ({ ...initialState, display, ortho, measureMode });

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loadStart':
      return { ...keepPrefs(state), status: 'loading', fileName: action.fileName };
    case 'progress':
      return { ...state, progress: { stage: action.stage, percent: action.percent } };
    case 'loaded':
      return { ...state, status: 'ready', model: action.model, unit: action.model.unit, loadMs: action.ms, progress: undefined };
    case 'failed':
      return { ...state, status: 'error', error: action.error, progress: undefined };
    case 'close':
      return keepPrefs(state);
    case 'setHidden':
      return { ...state, hidden: action.hidden };
    case 'select':
      return { ...state, selected: action.id };
    case 'setTool':
      return { ...state, tool: action.tool };
    case 'setMeasureMode':
      return { ...state, tool: 'measure', measureMode: action.mode };
    case 'setUnit':
      return { ...state, unit: action.unit };
    case 'setSection':
      return { ...state, section: { ...state.section, ...action.section } };
    case 'setDisplay':
      return { ...state, display: action.display };
    case 'toggleOrtho':
      return { ...state, ortho: !state.ortho };
  }
}

// Hide everything except the node, its ancestors and its subtree.
export function isolate(model: Model, id: number): Set<number> {
  const keep = new Set<number>();
  for (let p = id; p >= 0; p = model.nodes[p].parent) keep.add(p);
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    keep.add(n);
    stack.push(...model.nodes[n].children);
  }
  return new Set(model.nodes.filter((n) => !keep.has(n.id)).map((n) => n.id));
}
