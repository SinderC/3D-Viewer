import { useId, useRef, type ReactNode, type ToggleEvent } from 'react';
import { CheckIcon, ChevronRight } from './icons';

interface Props {
  label: ReactNode;
  title: string;
  up?: boolean; // open above the trigger
  bar?: boolean; // a title in the top menu bar
  sub?: boolean; // a submenu: the trigger is a row of the parent menu
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

// Dropdown on the Popover API: the browser handles outside clicks and Esc.
// Clicking a .menu-item closes it (and the menus it is in); other controls inside (sliders, selects,
// submenu rows) keep it open.
export function Menu({ label, title, up, bar, sub, pressed, disabled, className, children }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // The panel lives in the top layer, so place it next to the trigger. Runs before opening
  // (no size yet) and again after, to keep it inside the window.
  const place = (e: ToggleEvent<HTMLDivElement>) => {
    if (e.newState !== 'open') return;
    const r = trigger.current!.getBoundingClientRect();
    const p = panel.current!;
    if (sub) {
      // Beside the row, its first item level with it; on the left when the right has no room.
      const right = r.right + p.offsetWidth + 8 <= innerWidth;
      p.style.left = `${right ? r.right : r.left - p.offsetWidth}px`;
      p.style.top = `${Math.max(8, Math.min(r.top - 6, innerHeight - p.offsetHeight - 8))}px`;
      p.style.transformOrigin = right ? 'left top' : 'right top';
      return;
    }
    const left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8));
    p.style.left = `${left}px`;
    if (up) p.style.bottom = `${innerHeight - r.top + 4}px`;
    else p.style.top = `${r.bottom + 4}px`;
    // Grow out of the trigger, even when the panel is shifted to stay inside the window.
    p.style.transformOrigin = `${r.left + r.width / 2 - left}px ${up ? '100%' : '0'}`;
  };

  // Like the macOS menu bar: while one bar menu is open, pointing at another title switches to it.
  // Showing an auto popover closes the open one.
  const switchTo = () => {
    const p = panel.current!;
    if (!p.matches(':popover-open') && document.querySelector('.menu.bar:popover-open')) p.showPopover();
  };

  // Submenus open on pointing or clicking, and never toggle shut under the pointer.
  const open = () => {
    const p = panel.current!;
    if (!p.matches(':popover-open')) p.showPopover();
  };
  // Pointing at another row of this menu closes its open submenus.
  const closeSubmenus = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('.submenu, .menu.sub') === null)
      panel.current!.querySelectorAll<HTMLElement>('.menu.sub:popover-open').forEach((m) => m.hidePopover());
  };

  return (
    <>
      <button
        ref={trigger}
        popoverTarget={sub ? undefined : id}
        className={className}
        title={sub ? undefined : title}
        aria-label={title}
        aria-haspopup={sub ? 'menu' : undefined}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={sub ? open : undefined}
        onPointerEnter={bar ? switchTo : sub ? open : undefined}
      >
        {label}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className={bar ? 'menu bar' : sub ? 'menu sub' : 'menu'}
        onBeforeToggle={place}
        onToggle={place}
        onPointerOver={closeSubmenus}
        onClick={(e) => (e.target as Element).closest('.menu-item:not(.submenu)') && panel.current?.hidePopover()}
      >
        {children}
      </div>
    </>
  );
}

interface ItemProps {
  label: string;
  /** Shows a checkmark column; omit for a plain command. */
  checked?: boolean;
  kbd?: string;
  disabled?: boolean;
  onClick: () => void;
}

// A menu command, optionally a checked toggle, aligned with its siblings by a check column.
export function MenuItem({ label, checked, kbd, disabled, onClick }: ItemProps) {
  return (
    <button className="menu-item choice" aria-pressed={checked} disabled={disabled} onClick={onClick}>
      <span className="check">{checked && <CheckIcon />}</span>
      {label}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

interface ChoicesProps<T extends string> {
  label: string;
  options: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

const choiceItems = <T extends string>({ options, value, onChange, disabled }: ChoicesProps<T>) =>
  (Object.entries(options) as [T, string][]).map(([id, text]) => (
    <MenuItem key={id} label={text} checked={id === value} disabled={disabled} onClick={() => onChange(id)} />
  ));

// A labelled group of mutually exclusive menu items, the current one checked.
export function MenuChoices<T extends string>(props: ChoicesProps<T>) {
  return (
    <div role="group" aria-label={props.label}>
      <div className="menu-label">{props.label}</div>
      {choiceItems(props)}
    </div>
  );
}

// The same as a submenu: a row naming the setting and its current value. For more than a few options,
// or to keep a long menu short.
export function MenuSubChoices<T extends string>(props: ChoicesProps<T>) {
  const { label, options, value, disabled } = props;
  return (
    <Menu
      sub
      title={`${label}: ${options[value]}`}
      className="menu-item choice submenu"
      disabled={disabled}
      label={
        <>
          <span className="check" />
          {label}
          <span className="menu-value">{options[value]}</span>
          <ChevronRight />
        </>
      }
    >
      {choiceItems(props)}
    </Menu>
  );
}
