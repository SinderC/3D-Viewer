import { QUALITY, type Quality } from '../worker/protocol';
import { Menu, MenuChoices, MenuSubChoices } from './Menu';
import type { State } from './state';
import { BAR_SIZES, THEMES, type ViewPrefs } from './ViewMenu';

interface Props {
  status: State['status'];
  quality: Quality;
  onQuality: (q: Quality) => void;
  prefs: ViewPrefs;
}

const QUALITY_LABELS = Object.fromEntries(Object.entries(QUALITY).map(([id, q]) => [id, q.label])) as Record<Quality, string>;

// App preferences: mesh quality, theme and toolbar size.
export function SettingsMenu({ status, quality, onQuality, prefs }: Props) {
  return (
    <Menu title="Settings" label="Settings" className="menu-trigger" bar>
      {/* Applied when a file is read: changing it reloads the open model. */}
      <MenuChoices
        label="Mesh quality"
        options={QUALITY_LABELS}
        value={quality}
        disabled={status === 'loading'}
        onChange={onQuality}
      />
      <p className="menu-note">Changing it reloads the open model.</p>
      <hr className="menu-sep" />
      <MenuSubChoices label="Theme" options={THEMES} value={prefs.theme} onChange={prefs.setTheme} />
      <MenuSubChoices label="Toolbar size" options={BAR_SIZES} value={prefs.barSize} onChange={prefs.setBarSize} />
    </Menu>
  );
}
