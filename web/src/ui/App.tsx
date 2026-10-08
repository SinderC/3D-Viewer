import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Viewer } from '../viewer/Viewer';
import { EXTENSIONS, FORMATS, isSupported } from '../core/formats';
import { loadModel } from '../worker/loadModel';
import { QUALITY, type Quality } from '../worker/protocol';
import { LockIcon, OpenFileIcon } from './icons';
import { Properties } from './Properties';
import { Sidebar } from './Sidebar';
import { Splitter } from './Splitter';
import { initialState, reducer, type State } from './state';
import { load, save } from './storage';
import { Toolbar } from './Toolbar';
import { ViewBar } from './ViewBar';
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
const PROPS_KEY = 'properties';

function storedQuality(): Quality {
  const q = load(QUALITY_KEY);
  return q && q in QUALITY ? (q as Quality) : 'normal';
}

// Windows this narrow stack the sidebar under the viewer (see styles.css) and show properties as a tab.
const NARROW = '(max-width: 700px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const STAGES: Record<string, string> = { read: 'Parsing', transfer: 'Translating', mesh: 'Meshing' };

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const viewer = useRef<Viewer | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [quality, setQuality] = useState<Quality>(storedQuality);
  const [showProps, setShowProps] = useState(() => load(PROPS_KEY) !== 'hidden');
  const narrow = useMediaQuery(NARROW);
  const propsPanel = showProps && !narrow;
  const lastFile = useRef<File | null>(null);
  const loading = useRef<AbortController | null>(null);

  const open = useCallback(
    async (file: File, q: Quality = quality) => {
      // Only the latest file may land: cancel a load still running.
      loading.current?.abort();
      const { signal } = (loading.current = new AbortController());
      lastFile.current = file;
      dispatch({ type: 'loadStart', fileName: file.name });
      if (!isSupported(file.name)) {
        dispatch({ type: 'failed', error: `Unsupported file type. Supported: ${EXTENSIONS.join(' ')}` });
        return;
      }
      const t0 = performance.now();
      try {
        const model = await loadModel(
          await file.arrayBuffer(),
          file.name,
          (stage, percent) => dispatch({ type: 'progress', stage, percent }),
          QUALITY[q].options,
          signal,
        );
        dispatch({ type: 'loaded', model, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        if (!signal.aborted) dispatch({ type: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [quality],
  );

  const close = () => {
    loading.current?.abort();
    lastFile.current = null;
    dispatch({ type: 'close' });
  };

  // Quality is applied at load time, so reload the open model with the new setting.
  const changeQuality = (q: Quality) => {
    setQuality(q);
    save(QUALITY_KEY, q);
    if (lastFile.current) open(lastFile.current, q);
  };

  const toggleProps = () => {
    setShowProps(!showProps);
    save(PROPS_KEY, showProps ? 'hidden' : null);
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'f') viewer.current?.fit();
      if (e.key === 'F') viewer.current?.fitSelection();
      if (e.key === 'm') dispatch({ type: 'setTool', tool: state.tool === 'measure' ? 'select' : 'measure' });
      if (e.key === 'p') dispatch({ type: 'togglePmi' });
      if (e.key === 'Escape') {
        dispatch({ type: 'setTool', tool: 'select' });
        dispatch({ type: 'select', id: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.tool]);

  const { status } = state;
  return (
    <div
      className={`app${propsPanel ? '' : ' no-props'}`}
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
        status={status}
        onOpen={() => fileInput.current?.click()}
        onClose={close}
        quality={quality}
        onQuality={changeQuality}
        showProps={showProps}
        onToggleProps={toggleProps}
      />
      <input
        ref={fileInput}
        type="file"
        accept={EXTENSIONS.join(',')}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) open(file);
          e.target.value = '';
        }}
      />
      <Sidebar state={state} dispatch={dispatch} info={narrow} />
      <main className="stage">
        <ViewerCanvas state={state} dispatch={dispatch} viewerRef={viewer} />
        {status === 'ready' && <ViewBar state={state} dispatch={dispatch} viewer={viewer} />}
        {status === 'idle' && (
          <div className="overlay">
            <div className="welcome">
              <OpenFileIcon />
              <h1>Open a 3D model</h1>
              <p className="muted">Drag a file anywhere onto this window, or</p>
              <button className="primary" onClick={() => fileInput.current?.click()}>
                Choose a file…
              </button>
              <ul className="formats" aria-label="Supported formats">
                {FORMATS.map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
              </ul>
              <p className="muted">
                <LockIcon /> Files stay on your computer. Nothing is uploaded.
              </p>
            </div>
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
      {propsPanel && (
        <aside className="props">
          <Splitter variable="--props-w" edge="left" />
          <div className="tree">
            <Properties state={state} />
          </div>
        </aside>
      )}
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
