import type { CSSProperties, Dispatch } from 'react';
import { APPEARANCES, type Appearance, type AppearanceId, type PartColor } from '../core/appearances';
import { AppearanceIcon } from './icons';
import { Menu } from './Menu';
import { appearanceOf, colorOf, type Action, type State } from './state';

const GROUPS = [...new Set(Object.values(APPEARANCES).map((a) => a.group))];

// One-click colours; any other comes from the browser's colour picker.
const COLORS: Record<PartColor, string> = {
  '#f2f2f2': 'White',
  '#9a9ea6': 'Grey',
  '#26282c': 'Black',
  '#d23c3c': 'Red',
  '#e8862a': 'Orange',
  '#f2c230': 'Yellow',
  '#3c9a4a': 'Green',
  '#2f6fd6': 'Blue',
};

// A sphere-like swatch: the preset's colour, or a rainbow for presets that keep the part's colour.
function swatch({ color, metalness, roughness }: Appearance): CSSProperties {
  const shine = `radial-gradient(circle at 35% 30%, rgb(255 255 255 / ${0.9 * (1 - roughness) * (0.4 + 0.6 * metalness)}), transparent 60%)`;
  const base = color ? `rgb(${color.map((c) => Math.round(c * 255)).join(' ')})` : 'conic-gradient(#e66, #ec6, #6c6, #6ce, #86e, #e66)';
  return { background: `${shine}, ${base}` };
}

// Colours and finishes for the selected part, or the whole model when nothing is selected. They combine:
// finishes take the colour, except those defined by their own (brass, copper).
export function AppearanceMenu({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  const model = state.model!;
  const { selected, appearances, colors } = state;
  const target = selected === null ? null : model.nodes[selected];
  const current = target ? appearanceOf(model, appearances, target.id) : undefined;
  const color = colorOf(model, colors, target?.id ?? model.roots[0]);
  const apply = (appearance: AppearanceId | null) => dispatch({ type: 'setAppearance', id: selected, appearance });
  const paint = (color: PartColor | null) => dispatch({ type: 'setColor', id: selected, color });
  return (
    <Menu up title="Appearance" className="icon" pressed={appearances.size + colors.size > 0} label={<AppearanceIcon />}>
      <p className="menu-note appearance-target">Apply to {target ? <b>{target.name || 'unnamed part'}</b> : 'the whole model'}</p>
      <div role="group" aria-label="Colour">
        <div className="menu-label">Colour</div>
        <div className="color-swatches">
          {(Object.entries(COLORS) as [PartColor, string][]).map(([c, name]) => (
            <button
              key={c}
              className="color-swatch"
              style={{ background: c }}
              title={name}
              aria-label={name}
              aria-pressed={c === color}
              onClick={() => paint(c)}
            />
          ))}
          {/* Live while dragging; the viewer drops the colours passed on the way. */}
          <label className={`color-swatch custom${color && !(color in COLORS) ? ' current' : ''}`} title="Other colour">
            <input type="color" aria-label="Other colour" value={color ?? '#b8bcc4'} onChange={(e) => paint(e.target.value as PartColor)} />
          </label>
        </div>
        <button className="menu-item" disabled={!target || !color} onClick={() => paint(null)}>
          Reset part colour
        </button>
        <button className="menu-item" disabled={!colors.size} onClick={() => dispatch({ type: 'setColor', id: null, color: null })}>
          Reset all colours
        </button>
      </div>
      <hr className="menu-sep" />
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
      <button className="menu-item" disabled={!target || !current} onClick={() => apply(null)}>
        Reset part finish
      </button>
      <button className="menu-item" disabled={!appearances.size} onClick={() => dispatch({ type: 'setAppearance', id: null, appearance: null })}>
        Reset all finishes
      </button>
    </Menu>
  );
}
