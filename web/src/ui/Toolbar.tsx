import type { ReactNode } from 'react';
import { PropertiesIcon } from './icons';
import { Menu, MenuItem } from './Menu';
import type { State } from './state';

interface Props {
  status: State['status'];
  onOpen: () => void;
  onClose: () => void;
  onSaveImage: () => void;
  onExport: (format: 'stl' | 'glb') => void;
  showProps: boolean;
  onToggleProps: () => void;
  onHelp: () => void;
  /** Menus between File and Help (View, Settings). */
  children: ReactNode;
}

export const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl+';
const REPO = 'https://github.com/SinderC/3D-Viewer';

export function Toolbar({ status, onOpen, onClose, onSaveImage, onExport, showProps, onToggleProps, onHelp, children }: Props) {
  return (
    <header className="toolbar">
      <span className="app-name">Open CAD Viewer</span>
      <Menu title="File" label="File" className="menu-trigger" bar>
        <MenuItem label="Open…" kbd={`${MOD}O`} onClick={onOpen} />
        <MenuItem label="Close" disabled={status === 'idle'} onClick={onClose} />
        <hr className="menu-sep" />
        <MenuItem label="Save image…" disabled={status !== 'ready'} onClick={onSaveImage} />
        <MenuItem label="Export STL…" disabled={status !== 'ready'} onClick={() => onExport('stl')} />
        <MenuItem label="Export glTF (GLB)…" disabled={status !== 'ready'} onClick={() => onExport('glb')} />
      </Menu>
      {children}
      <Menu title="Help" label="Help" className="menu-trigger" bar>
        <MenuItem label="Keyboard shortcuts" kbd="?" onClick={onHelp} />
        <MenuItem label="Source on GitHub" onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </Menu>
      <button
        className="icon props-toggle"
        aria-pressed={showProps}
        onClick={onToggleProps}
        title="Properties panel"
        aria-label="Properties panel"
      >
        <PropertiesIcon />
      </button>
    </header>
  );
}
