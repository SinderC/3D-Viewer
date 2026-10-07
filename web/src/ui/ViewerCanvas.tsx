import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Viewer } from '../viewer/Viewer';
import type { Action, State } from './state';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  viewerRef: React.RefObject<Viewer | null>;
}

// Mounts the Three.js viewer and keeps it in sync with React state.
export function ViewerCanvas({ state, dispatch, viewerRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const { model, hidden, selected, tool, measureMode, unit, section, display, ortho } = state;

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
  useEffect(() => viewer?.select(selected), [viewer, model, selected]);
  useEffect(() => viewer?.setTool(tool), [viewer, tool]);
  useEffect(() => viewer?.setMeasureMode(measureMode), [viewer, model, measureMode]);
  useEffect(() => viewer?.setUnit(unit), [viewer, unit]);
  useEffect(() => viewer?.setSection(section), [viewer, model, section]);
  useEffect(() => viewer?.setDisplayStyle(display), [viewer, display]);
  useEffect(() => viewer?.setOrthographic(ortho), [viewer, ortho]);

  return <div className="viewport" ref={host} data-tool={tool} />;
}
