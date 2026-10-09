import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Viewer, type Theme } from '../viewer/Viewer';
import { defaultView } from '../core/model';
import { displayStyle, measureMode, type Action, type State } from './state';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  viewerRef: React.RefObject<Viewer | null>;
  theme: Theme;
}

// Mounts the Three.js viewer and keeps it in sync with React state.
export function ViewerCanvas({ state, dispatch, viewerRef, theme }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const { model, hidden, selected, tool, unit, section, ortho, grid, ghost, pmi, hiddenPmi, selectedPmi, view } = state;
  const display = displayStyle(state);
  const mode = measureMode(state);

  useEffect(() => {
    const viewer = new Viewer(host.current!);
    viewer.onPick = (id) => dispatch({ type: 'select', id });
    viewerRef.current = viewer;
    setViewer(viewer);
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [dispatch, viewerRef]);

  // Load first: the effects below re-apply display state to the new scene.
  // No model (closed, or another one loading) frees the old scene right away.
  useEffect(() => void (model ? viewer?.load(model) : viewer?.clear()), [viewer, model]);
  useEffect(() => viewer?.setHidden(hidden), [viewer, model, hidden]);
  useEffect(() => viewer?.setGhost(ghost), [viewer, ghost]);
  useEffect(() => viewer?.select(selected), [viewer, model, selected]);
  useEffect(() => viewer?.setTool(tool), [viewer, tool]);
  useEffect(() => viewer?.setMeasureMode(mode), [viewer, model, mode]);
  useEffect(() => viewer?.setUnit(unit), [viewer, unit]);
  useEffect(() => viewer?.setSection(section), [viewer, model, section]);
  useEffect(() => viewer?.setTheme(theme), [viewer, theme]);
  useEffect(() => viewer?.setDisplayStyle(display), [viewer, display]);
  useEffect(() => viewer?.setOrthographic(ortho), [viewer, ortho]);
  useEffect(() => viewer?.setGridVisible(grid), [viewer, grid]);
  useEffect(() => viewer?.setPmi(pmi, hiddenPmi), [viewer, model, pmi, hiddenPmi]);
  useEffect(() => viewer?.selectPmi(selectedPmi), [viewer, model, selectedPmi]);
  // After the PMI visibility above, so the camera frames the view's PMI.
  // A file with saved views opens in its default one (orientation only; all PMI stays shown).
  useEffect(() => {
    const v = model && defaultView(model);
    if (v) viewer?.lookAlong(v.direction, v.up, false);
  }, [viewer, model]);
  useEffect(() => {
    const v = view && model?.views[view.index];
    if (v) viewer?.lookAlong(v.direction, v.up);
  }, [viewer, view]);

  return <div className="viewport" ref={host} data-tool={tool} />;
}
