import type { CSSProperties, Dispatch } from 'react';
import { APPEARANCES, type Appearance, type AppearanceId } from '../core/appearances';
import { AppearanceIcon } from './icons';
import { Menu } from './Menu';
import { appearanceOf, type Action, type State } from './state';

const GROUPS = [...new Set(Object.values(APPEARANCES).map((a) => a.group))];

// A sphere-like swatch: the preset's colour, or a rainbow for presets that keep the part's colour.
function swatch({ color, metalness, roughness }: Appearance): CSSProperties {
  const shine = `radial-gradient(circle at 35% 30%, rgb(255 255 255 / ${0.9 * (1 - roughness) * (0.4 + 0.6 * metalness)}), transparent 60%)`;
  const base = color ? `rgb(${color.map((c) => Math.round(c * 255)).join(' ')})` : 'conic-gradient(#e66, #ec6, #6c6, #6ce, #86e, #e66)';
  return { background: `${shine}, ${base}` };
}

// Finishes for the selected part, or the whole model when nothing is selected.
export function AppearanceMenu({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  const model = state.model!;
  const { selected, appearances } = state;
  const target = selected === null ? null : model.nodes[selected];
  const current = target ? appearanceOf(model, appearances, target.id) : undefined;
  const apply = (appearance: AppearanceId | null) => dispatch({ type: 'setAppearance', id: selected, appearance });
  return (
    <Menu up title="Appearance" className="icon" pressed={appearances.size > 0} label={<AppearanceIcon />}>
      <p className="menu-note appearance-target">Apply to {target ? <b>{target.name || 'unnamed part'}</b> : 'the whole model'}</p>
      {GROUPS.map((group) => (
        <div key={group} role="group" aria-label={group}>
          <div className="menu-label">{group}</div>
          {(Object.entries(APPEARANCES) as [AppearanceId, Appearance][])
            .filter(([, a]) => a.group === group)
            .map(([id, a]) => (
              <button key={id} className="menu-item" aria-pressed={id === current} onClick={() => apply(id)}>
                <span className="swatch" style={swatch(a)} />
                {a.label}
              </button>
            ))}
        </div>
      ))}
      <hr className="menu-sep" />
      <button className="menu-item" disabled={!target} onClick={() => apply(null)}>
        Reset part
      </button>
      <button className="menu-item" disabled={!appearances.size} onClick={() => dispatch({ type: 'setAppearance', id: null, appearance: null })}>
        Reset all
      </button>
    </Menu>
  );
}
