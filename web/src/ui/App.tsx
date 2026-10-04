import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Viewer } from '../viewer/Viewer';
import { loadStep } from '../worker/loadStep';
import { QUALITY, type Quality } from '../worker/protocol';
import { ModelTree } from './ModelTree';
import { initialState, reducer, type State } from './state';
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

const QUALITY_KEY = 'quality';

// Storage can be unavailable (private mode, blocked site data); the setting is a convenience.
function storedQuality(): Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (q && q in QUALITY) return q as Quality;
  } catch {}
  return 'normal';
}

const STAGES: Record<string, string> = { read: 'Parsing', transfer: 'Translating', mesh: 'Meshing' };

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const viewer = useRef<Viewer | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [quality, setQuality] = useState<Quality>(storedQuality);
  const lastFile = useRef<File | null>(null);

  const open = useCallback(
    async (file: File, q: Quality = quality) => {
      lastFile.current = file;
      dispatch({ type: 'loadStart', fileName: file.name });
      const t0 = performance.now();
      try {
        const model = await loadStep(
          await file.arrayBuffer(),
          (stage, percent) => dispatch({ type: 'progress', stage, percent }),
          QUALITY[q].options,
        );
        dispatch({ type: 'loaded', model, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        dispatch({ type: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [quality],
  );

  // Quality is applied at load time, so reload the open model with the new setting.
  const changeQuality = (q: Quality) => {
    setQuality(q);
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {}
    if (lastFile.current) open(lastFile.current, q);
  };

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
      <Toolbar
        state={state}
        dispatch={dispatch}
        viewer={viewer}
        onOpen={() => fileInput.current?.click()}
        quality={quality}
        onQuality={changeQuality}
      />
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
              <dd>{model.unit}</dd>
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
            <LoadProgress key={state.fileName} progress={state.progress} />
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

// Stage, percent when known, and elapsed time: some stages run long without measurable progress.
function LoadProgress({ progress }: { progress: State['progress'] }) {
  const [t0] = useState(() => performance.now());
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.floor((performance.now() - t0) / 1000);
  const stage = progress ? (STAGES[progress.stage] ?? progress.stage) : 'Starting';
  const percent = progress && progress.percent >= 0 ? ` ${progress.percent}%` : '…';
  return (
    <p className="muted">
      {stage}
      {percent} · {seconds} s
    </p>
  );
}
