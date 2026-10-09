import type { ReactNode } from 'react';
import { QUALITY, type Quality } from '../worker/protocol';
import { GitHubIcon, PropertiesIcon } from './icons';
import { Menu, MenuChoices, MenuItem } from './Menu';
import type { State } from './state';

interface Props {
  status: State['status'];
  onOpen: () => void;
  onClose: () => void;
  quality: Quality;
  onQuality: (q: Quality) => void;
  showProps: boolean;
  onToggleProps: () => void;
  /** Menus after File (View). */
  children: ReactNode;
}

export const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl+';
const QUALITY_LABELS = Object.fromEntries(Object.entries(QUALITY).map(([id, q]) => [id, q.label])) as Record<Quality, string>;

export function Toolbar({ status, onOpen, onClose, quality, onQuality, showProps, onToggleProps, children }: Props) {
  return (
    <header className="toolbar">
      <span className="app-name">Open CAD Viewer</span>
      <Menu title="File" label="File" className="menu-trigger" bar>
        <MenuItem label="Open…" kbd={`${MOD}O`} onClick={onOpen} />
        <MenuItem label="Close" disabled={status === 'idle'} onClick={onClose} />
        <hr className="menu-sep" />
        {/* Applied when a file is read: changing it reloads the open model. */}
        <MenuChoices
          label="Mesh quality"
          options={QUALITY_LABELS}
          value={quality}
          disabled={status === 'loading'}
          onChange={onQuality}
        />
        <p className="menu-note">Changing it reloads the open model.</p>
      </Menu>
      {children}
      <button
        className="icon props-toggle"
        aria-pressed={showProps}
        onClick={onToggleProps}
        title="Properties panel"
        aria-label="Properties panel"
      >
        <PropertiesIcon />
      </button>
      <a
        className="repo-link"
        href="https://github.com/SinderC/3D-Viewer"
        target="_blank"
        rel="noopener noreferrer"
        title="Source on GitHub"
        aria-label="Source on GitHub"
      >
        <GitHubIcon />
      </a>
    </header>
  );
}
