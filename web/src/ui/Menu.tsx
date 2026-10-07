import { useId, useRef, type ReactNode, type ToggleEvent } from 'react';

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
    p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8))}px`;
    if (up) p.style.bottom = `${innerHeight - r.top + 4}px`;
    else p.style.top = `${r.bottom + 4}px`;
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
