import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Viewer } from '../viewer/Viewer';
import { loadStep } from '../worker/loadStep';
import { ModelTree } from './ModelTree';
import { initialState, reducer } from './state';
import { Toolbar } from './Toolbar';
import { ViewerCanvas } from './ViewerCanvas';

// Minimal typing for the File Handling API (installed PWA "Open with").
interface LaunchParams {
  files: FileSystemFileHandle[];
}
declare global {
  interface Window {
    launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void };
  }
}

const STAGES: Record<string, string> = { read: 'Parsing', transfer: 'Translating' };

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const viewer = useRef<Viewer | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const open = useCallback(async (file: File) => {
    dispatch({ type: 'loadStart', fileName: file.name });
    const t0 = performance.now();
    try {
      const model = await loadStep(await file.arrayBuffer(), (stage, percent) =>
        dispatch({ type: 'progress', stage, percent }),
      );
      dispatch({ type: 'loaded', model, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      dispatch({ type: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Files opened via the OS when installed as a PWA.
  useEffect(() => {
    window.launchQueue?.setConsumer(async ({ files }) => {
      if (files[0]) open(await files[0].getFile());
    });
  }, [open]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'f') viewer.current?.fit();
      if (e.key === 'm') dispatch({ type: 'setTool', tool: state.tool === 'measure' ? 'select' : 'measure' });
      if (e.key === 'Escape') {
        dispatch({ type: 'setTool', tool: 'select' });
        dispatch({ type: 'select', id: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.tool]);

  const { model, status } = state;
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) open(file);
      }}
    >
      <Toolbar state={state} dispatch={dispatch} viewer={viewer} onOpen={() => fileInput.current?.click()} />
      <input
        ref={fileInput}
        type="file"
        accept=".stp,.step,.STP,.STEP"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) open(file);
          e.target.value = '';
        }}
      />
      <aside className="sidebar">
        {model ? (
          <>
            <ModelTree key={state.fileName} model={model} hidden={state.hidden} selected={state.selected} dispatch={dispatch} />
            <dl className="info">
              <dt>File</dt>
              <dd title={state.fileName}>{state.fileName}</dd>
              <dt>Format</dt>
              <dd title={model.schema}>STEP {model.ap}</dd>
              <dt>Units</dt>
              <dd>{model.unit.label}</dd>
              <dt>Parts</dt>
              <dd>
                {model.protos.length} ({model.nodes.filter((n) => n.proto >= 0).length} instances)
              </dd>
              <dt>Triangles</dt>
              <dd>{model.triangles.toLocaleString()}</dd>
              <dt>Load time</dt>
              <dd>{((state.loadMs ?? 0) / 1000).toFixed(2)} s</dd>
            </dl>
          </>
        ) : (
          <p className="hint">No model loaded.</p>
        )}
      </aside>
      <main className="stage">
        <ViewerCanvas state={state} dispatch={dispatch} viewerRef={viewer} />
        {status === 'idle' && (
          <div className="overlay">
            <p>
              Drop a STEP file (AP203, AP214, AP242) here or use <b>Open STEP…</b>
            </p>
            <p className="muted">Files are processed locally in your browser and never uploaded.</p>
          </div>
        )}
        {status === 'loading' && (
          <div className="overlay">
            <p>Loading {state.fileName}…</p>
            {state.progress && (
              <p className="muted">
                {STAGES[state.progress.stage] ?? state.progress.stage} {state.progress.percent}%
              </p>
            )}
          </div>
        )}
        {status === 'error' && (
          <div className="overlay error">
            <p>Could not open {state.fileName}</p>
            <p className="muted">{state.error}</p>
          </div>
        )}
        {dragging && <div className="overlay drop">Drop to open</div>}
      </main>
    </div>
  );
}
