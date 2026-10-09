import { useId, useRef, type ReactNode, type ToggleEvent } from 'react';
import { CheckIcon } from './icons';

interface Props {
  label: ReactNode;
  title: string;
  up?: boolean; // open above the trigger
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

// Dropdown on the Popover API: the browser handles outside clicks and Esc.
// Clicking a .menu-item closes it; other controls inside (sliders, selects) keep it open.
export function Menu({ label, title, up, pressed, disabled, className, children }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // The panel lives in the top layer, so place it next to the trigger. Runs before opening
  // (no size yet) and again after, to keep it inside the window.
  const place = (e: ToggleEvent<HTMLDivElement>) => {
    if (e.newState !== 'open') return;
    const r = trigger.current!.getBoundingClientRect();
    const p = panel.current!;
    const left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8));
    p.style.left = `${left}px`;
    if (up) p.style.bottom = `${innerHeight - r.top + 4}px`;
    else p.style.top = `${r.bottom + 4}px`;
    // Grow out of the trigger, even when the panel is shifted to stay inside the window.
    p.style.transformOrigin = `${r.left + r.width / 2 - left}px ${up ? '100%' : '0'}`;
  };

  return (
    <>
      <button
        ref={trigger}
        popoverTarget={id}
        className={className}
        title={title}
        aria-label={title}
        aria-pressed={pressed}
        disabled={disabled}
      >
        {label}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="menu"
        onBeforeToggle={place}
        onToggle={place}
        onClick={(e) => (e.target as Element).closest('.menu-item') && panel.current?.hidePopover()}
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

// A labelled group of mutually exclusive menu items, the current one checked.
export function MenuChoices<T extends string>({ label, options, value, onChange, disabled }: ChoicesProps<T>) {
  return (
    <div role="group" aria-label={label}>
      <div className="menu-label">{label}</div>
      {(Object.entries(options) as [T, string][]).map(([id, text]) => (
        <MenuItem key={id} label={text} checked={id === value} disabled={disabled} onClick={() => onChange(id)} />
      ))}
    </div>
  );
}
