import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { Viewer } from '../viewer/Viewer';
import { EXTENSIONS, FORMATS, isSupported } from '../core/formats';
import { mainFile } from '../core/mainFile';
import { loadModel } from '../worker/loadModel';
import { QUALITY, type Quality } from '../worker/protocol';
import { baseName, download } from './download';
import { LockIcon, OpenFileIcon } from './icons';
import { MissingFiles } from './MissingFiles';
import { Properties } from './Properties';
import { findShortcut, type ShortcutContext } from './shortcuts';
import { ShortcutHelp } from './ShortcutHelp';
import { Sidebar } from './Sidebar';
import { Splitter } from './Splitter';
import { initialState, reducer, type State } from './state';
import { useStored, useStoredFlag } from './storage';
import { SettingsMenu } from './SettingsMenu';
import { Toolbar } from './Toolbar';
import { ViewBar } from './ViewBar';
import { ViewerCanvas } from './ViewerCanvas';
import { BAR_SIZES, PMI_COLORS, THEMES, UP_AXES, ViewMenu, type ViewPrefs } from './ViewMenu';

// Minimal typing for the File Handling API (installed PWA "Open with").
interface LaunchParams {
  files: FileSystemFileHandle[];
}
declare global {
  interface Window {
    launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void };
  }
}


const LIGHT = '(prefers-color-scheme: light)';

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
  const addInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [quality, setQuality] = useStored<Quality>('quality', QUALITY, 'normal');
  const [themeChoice, setTheme] = useStored('theme', THEMES, 'system');
  const [pmiColor, setPmiColor] = useStored('pmi-color', PMI_COLORS, 'blue');
  const [barSize, setBarSize] = useStored('viewbar-size', BAR_SIZES, 'regular');
  const [upAxis, setUpAxis] = useStored('up-axis', UP_AXES, 'z');
  const [showSidebar, toggleSidebar] = useStoredFlag('sidebar');
  const [showProps, toggleProps] = useStoredFlag('properties');
  const [showCube, toggleCube] = useStoredFlag('viewcube');
  const [showAxes, toggleAxes] = useStoredFlag('axes');
  const narrow = useMediaQuery(NARROW);
  const systemTheme = useMediaQuery(LIGHT) ? 'light' : 'dark';
  const theme = themeChoice === 'system' ? systemTheme : themeChoice;
  const prefs: ViewPrefs = {
    sidebar: showSidebar,
    toggleSidebar,
    props: showProps,
    toggleProps,
    cube: showCube,
    toggleCube,
    axes: showAxes,
    toggleAxes,
    theme: themeChoice,
    setTheme,
    pmiColor,
    setPmiColor,
    barSize,
    setBarSize,
    upAxis,
    setUpAxis,
  };
  const propsPanel = showProps && !narrow;
  const lastFiles = useRef<File[]>([]);
  const loading = useRef<AbortController | null>(null);

  const open = useCallback(
    // Several files: an assembly and the files it keeps parts in (STEP external references).
    async (files: File[], q: Quality = quality) => {
      // Only the latest file may land: cancel a load still running.
      loading.current?.abort();
      const { signal } = (loading.current = new AbortController());
      lastFiles.current = files;
      const file = await mainFile(files);
      if (signal.aborted) return;
      dispatch({ type: 'loadStart', fileName: file.name, quality: q });
      if (!isSupported(file.name)) {
        dispatch({ type: 'failed', error: `Unsupported file type. Supported: ${EXTENSIONS.join(' ')}` });
        return;
      }
      const t0 = performance.now();
      try {
        const others = files.filter((f) => f !== file);
        const model = await loadModel(
          await file.arrayBuffer(),
          file.name,
          (stage, percent) => dispatch({ type: 'progress', stage, percent }),
          QUALITY[q].options,
          signal,
          await Promise.all(others.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() }))),
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
    lastFiles.current = [];
    dispatch({ type: 'close' });
  };

  const saveImage = async () => {
    const png = await viewer.current?.screenshot();
    if (png) download(png, `${baseName(state.fileName)}.png`);
  };

  const exportModel = async (format: 'stl' | 'glb') => {
    const blob = await viewer.current?.exportModel(format);
    if (blob) download(blob, `${baseName(state.fileName)}.${format}`);
  };

  // Files an assembly references, added to the ones it was opened with; a file of the same name replaces one.
  const addFiles = (added: File[]) => {
    const names = new Set(added.map((f) => f.name.toLowerCase()));
    open([...lastFiles.current.filter((f) => !names.has(f.name.toLowerCase())), ...added]);
  };

  // Quality is applied at load time, so reload the open model with the new setting.
  const changeQuality = (q: Quality) => {
    setQuality(q);
    if (lastFiles.current.length) open(lastFiles.current, q);
  };

  // Theme tokens in styles.css key off this; the browser chrome follows the background.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [theme]);

  // Files opened via the OS when installed as a PWA.
  useEffect(() => {
    window.launchQueue?.setConsumer(async ({ files }) => {
      if (files.length) open(await Promise.all(files.map((f) => f.getFile())));
    });
  }, [open]);

  // Keyboard shortcuts (shortcuts.ts), read through a ref so the handler is registered once.
  const [help, setHelp] = useState(false);
  const shortcutCtx = useRef<ShortcutContext>(null!);
  shortcutCtx.current = { state, dispatch, viewer: null, openFile: () => fileInput.current?.click(), showHelp: () => setHelp(true) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = findShortcut(e);
      if (!shortcut) return;
      // Typing in a field, or a dialog open: only Cmd/Ctrl shortcuts apply.
      const t = e.target;
      const typing =
        (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(t.type)) ||
        t instanceof HTMLSelectElement ||
        (t instanceof Element && t.closest('dialog'));
      if (typing && !shortcut.mod) return;
      e.preventDefault();
      shortcut.run({ ...shortcutCtx.current, viewer: viewer.current });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { status } = state;
  return (
    <div
      className={[
        'app',
        !propsPanel && 'no-props',
        !showSidebar && 'no-side',
        !showCube && 'no-cube',
        !showAxes && 'no-axes',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) open([...e.dataTransfer.files]);
      }}
    >
      <Toolbar
        status={status}
        onOpen={() => fileInput.current?.click()}
        onClose={close}
        onSaveImage={saveImage}
        onExport={exportModel}
        showProps={showProps}
        onToggleProps={toggleProps}
        onHelp={() => setHelp(true)}
      >
        <ViewMenu state={state} dispatch={dispatch} viewer={viewer} prefs={prefs} narrow={narrow} />
        <SettingsMenu status={status} quality={quality} onQuality={changeQuality} prefs={prefs} />
      </Toolbar>
      <input
        ref={fileInput}
        type="file"
        accept={EXTENSIONS.join(',')}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) open([...e.target.files]);
          e.target.value = '';
        }}
      />
      <input
        ref={addInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) addFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      {showSidebar && <Sidebar state={state} dispatch={dispatch} info={narrow} onCollapse={toggleSidebar} />}
      <main className="stage">
        <ViewerCanvas state={state} dispatch={dispatch} viewerRef={viewer} theme={theme} pmiColor={pmiColor} upAxis={upAxis} />
        {status === 'ready' && <ViewBar state={state} dispatch={dispatch} viewer={viewer} size={barSize} />}
        {status === 'ready' && state.model && <MissingFiles model={state.model} onAdd={() => addInput.current?.click()} />}
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
        <ShortcutHelp open={help} onClose={() => setHelp(false)} />
      </main>
      {propsPanel && (
        <aside className="props">
          <Splitter variable="--props-w" edge="left" onCollapse={toggleProps} />
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
  const known = progress !== undefined && progress.percent >= 0;
  return (
    <>
      <div className={`progress${known ? '' : ' indeterminate'}`}>
        <div style={known ? { transform: `scaleX(${progress.percent / 100})` } : undefined} />
      </div>
      <p className="muted progress-text">
        {stage}
        {known ? ` ${progress.percent}%` : '…'} · {seconds} s
      </p>
    </>
  );
}
