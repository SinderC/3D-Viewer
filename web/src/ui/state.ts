import type { AppearanceId, AppearanceSetting } from '../core/appearances';
import type { Model } from '../core/model';
import type { UnitId } from '../core/units';
import { MEASURE_MODES, type MeasureMode } from '../viewer/measure';
import type { DisplayStyle, Section, Tool } from '../viewer/Viewer';
import type { Quality } from '../worker/protocol';

export interface State {
  status: 'idle' | 'loading' | 'ready' | 'error';
  fileName?: string;
  quality?: Quality; // mesh quality the file is loaded with
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
  grid: boolean;
  ghost: boolean; // draw hidden parts translucent
  explode: number; // 0 assembled .. 1 fully exploded
  appearances: ReadonlyMap<number, AppearanceSetting>; // per node, for its subtree (see appearanceOf)
  pmi: boolean; // show PMI
  hiddenPmi: ReadonlySet<number>;
  selectedPmi: number | null;
  view: { index: number } | null; // saved view last applied; a new object per apply, so re-applying moves the camera again
}

export type Action =
  | { type: 'loadStart'; fileName: string; quality: Quality }
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
  | { type: 'toggleOrtho' }
  | { type: 'toggleGrid' }
  | { type: 'toggleGhost' }
  | { type: 'setExplode'; amount: number }
  /** For a node's subtree, or the whole model when `id` is null; a null appearance restores the file's. */
  | { type: 'setAppearance'; id: number | null; appearance: AppearanceId | null }
  | { type: 'togglePmi' }
  | { type: 'setHiddenPmi'; hidden: ReadonlySet<number> }
  | { type: 'selectPmi'; index: number | null }
  | { type: 'applyView'; index: number };

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
  grid: false,
  ghost: false,
  explode: 0,
  appearances: new Map(),
  pmi: true,
  hiddenPmi: new Set(),
  selectedPmi: null,
  view: null,
};

// View preferences survive opening and closing files.
const keepPrefs = ({ display, ortho, grid, ghost, pmi, measureMode }: State): State => ({
  ...initialState,
  display,
  ortho,
  grid,
  ghost,
  pmi,
  measureMode,
});

// Mesh formats (STL, OBJ…) carry no B-rep edges, so only plain shading applies to them.
// Exploding needs at least two parts to move apart.
export const canExplode = (model?: Model): boolean => (model?.nodes.filter((n) => n.proto >= 0).length ?? 0) > 1;

export const hasEdges = (model?: Model): boolean => !!model?.protos.some((p) => p.edges.length);

// The chosen style is kept for the next model that has edges.
export const needsEdges = (style: DisplayStyle): boolean => style === 'shadedEdges' || style === 'wireframe';

export const displayStyle = (state: State): DisplayStyle =>
  needsEdges(state.display) && !hasEdges(state.model) ? 'shaded' : state.display;

/** Why a measurement cannot be taken on the model, or undefined. Meshes have faces (non-planar), but no edges. */
export function unavailable(mode: MeasureMode, model?: Model): string | undefined {
  if (MEASURE_MODES[mode].picks.includes('edge') && !hasEdges(model)) return 'This model has no edges';
}

// Likewise edge measurements: without edges, measure between points.
export const measureMode = (state: State): MeasureMode =>
  unavailable(state.measureMode, state.model) ? 'pointDistance' : state.measureMode;

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loadStart':
      return { ...keepPrefs(state), status: 'loading', fileName: action.fileName, quality: action.quality };
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
      return { ...state, selected: action.id, selectedPmi: action.id === null ? state.selectedPmi : null };
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
    case 'toggleGrid':
      return { ...state, grid: !state.grid };
    case 'toggleGhost':
      return { ...state, ghost: !state.ghost };
    case 'setExplode':
      return { ...state, explode: action.amount };
    case 'setAppearance':
      return { ...state, appearances: setAppearance(state, action.id, action.appearance) };
    case 'togglePmi':
      return { ...state, pmi: !state.pmi };
    case 'setHiddenPmi':
      return { ...state, hiddenPmi: action.hidden };
    case 'selectPmi':
      return { ...state, selectedPmi: action.index, selected: action.index === null ? state.selected : null };
    case 'applyView': {
      // A view shows exactly its PMI; views without any (e.g. "Front") leave PMI visibility as it is.
      const shown = new Set(state.model?.views[action.index]?.pmi);
      const hiddenPmi = shown.size ? new Set(state.model!.pmi.keys().filter((i) => !shown.has(i))) : state.hiddenPmi;
      return { ...state, view: { index: action.index }, pmi: state.pmi || shown.size > 0, hiddenPmi };
    }
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

/** Nodes to list for a name search: the matches with their subtrees, and their ancestors (expanded). Null without a query. */
export function searchTree(model: Model, query: string): { shown: Set<number>; expand: Set<number> } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const shown = new Set<number>();
  const expand = new Set<number>();
  const subtrees = new Set<number>(); // shown with everything below them
  for (const n of model.nodes) {
    if (!n.name.toLowerCase().includes(q)) continue;
    for (let p = n.parent; p >= 0 && !expand.has(p); p = model.nodes[p].parent) expand.add(p);
    const stack = [n.id];
    while (stack.length) {
      const c = stack.pop()!;
      if (subtrees.has(c)) continue;
      subtrees.add(c);
      stack.push(...model.nodes[c].children);
    }
  }
  for (const id of expand) shown.add(id);
  for (const id of subtrees) shown.add(id);
  return { shown, expand };
}

/** The appearance a node shows: its own setting, else its nearest ancestor's; undefined for the file's. */
export function appearanceOf(model: Model, settings: ReadonlyMap<number, AppearanceSetting>, id: number): AppearanceId | undefined {
  for (let n = id; n >= 0; n = model.nodes[n].parent) {
    const s = settings.get(n);
    if (s) return s === 'file' ? undefined : s;
  }
}

// The node's subtree takes the appearance; settings below it are dropped.
function setAppearance(state: State, id: number | null, appearance: AppearanceId | null): ReadonlyMap<number, AppearanceSetting> {
  const model = state.model;
  if (!model) return state.appearances;
  if (id === null) return new Map(appearance ? model.roots.map((r) => [r, appearance]) : []);
  const next = new Map(state.appearances);
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    next.delete(n);
    stack.push(...model.nodes[n].children);
  }
  const parent = model.nodes[id].parent;
  const inherited = parent >= 0 ? appearanceOf(model, next, parent) : undefined;
  if (appearance) next.set(id, appearance);
  else if (inherited) next.set(id, 'file');
  return next;
}
