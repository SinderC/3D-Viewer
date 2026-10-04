import type { Model } from '../core/model';
import type { Section, Tool } from '../viewer/Viewer';

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
  section: Section;
  edges: boolean;
  ortho: boolean;
}

export type Action =
  | { type: 'loadStart'; fileName: string }
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'loaded'; model: Model; ms: number }
  | { type: 'failed'; error: string }
  | { type: 'setHidden'; hidden: ReadonlySet<number> }
  | { type: 'select'; id: number | null }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setSection'; section: Partial<Section> }
  | { type: 'toggleEdges' }
  | { type: 'toggleOrtho' };

const noSection: Section = { axis: null, position: 0.5, flip: false };

export const initialState: State = {
  status: 'idle',
  hidden: new Set(),
  selected: null,
  tool: 'select',
  section: noSection,
  edges: true,
  ortho: false,
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loadStart':
      return { ...initialState, edges: state.edges, ortho: state.ortho, status: 'loading', fileName: action.fileName };
    case 'progress':
      return { ...state, progress: { stage: action.stage, percent: action.percent } };
    case 'loaded':
      return { ...state, status: 'ready', model: action.model, loadMs: action.ms, progress: undefined };
    case 'failed':
      return { ...state, status: 'error', error: action.error, progress: undefined };
    case 'setHidden':
      return { ...state, hidden: action.hidden };
    case 'select':
      return { ...state, selected: action.id };
    case 'setTool':
      return { ...state, tool: action.tool };
    case 'setSection':
      return { ...state, section: { ...state.section, ...action.section } };
    case 'toggleEdges':
      return { ...state, edges: !state.edges };
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
