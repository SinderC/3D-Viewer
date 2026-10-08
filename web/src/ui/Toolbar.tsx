import { QUALITY, type Quality } from '../worker/protocol';
import { Chevron, GitHubIcon } from './icons';
import { Menu } from './Menu';
import type { State } from './state';

interface Props {
  status: State['status'];
  onOpen: () => void;
  onClose: () => void;
  quality: Quality;
  onQuality: (q: Quality) => void;
}

const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

export function Toolbar({ status, onOpen, onClose, quality, onQuality }: Props) {
  return (
    <header className="toolbar">
      <Menu title="File" label={<>File <Chevron /></>} className="menu-trigger">
        <button className="menu-item" onClick={onOpen}>
          Open… <kbd>{MOD}O</kbd>
        </button>
        <button className="menu-item" onClick={onClose} disabled={status === 'idle'}>
          Close
        </button>
      </Menu>
      <label title="Mesh quality (reloads the model)">
        Quality{' '}
        <select value={quality} disabled={status === 'loading'} onChange={(e) => onQuality(e.target.value as Quality)}>
          {Object.entries(QUALITY).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
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
