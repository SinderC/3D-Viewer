import { useEffect, type KeyboardEvent, type PointerEvent } from 'react';
import { load, save } from './storage';

interface Props {
  /** CSS variable holding the panel width (read by the .app grid); also its storage key. */
  variable: string;
  /** Edge of the parent panel the splitter sits on. */
  edge: 'left' | 'right';
}

const MIN = 180;
const STEP = 16;
const root = document.documentElement.style;

// The stylesheet caps the width at 40vw as well, for a window that shrinks later.
function setWidth(variable: string, px: number) {
  root.setProperty(variable, `${Math.round(Math.min(Math.max(px, MIN), innerWidth * 0.4))}px`);
}

// Drag handle (or arrow keys) on a panel edge to set the panel's width; double-click restores the default.
export function Splitter({ variable, edge }: Props) {
  useEffect(() => {
    const px = Number(load(variable));
    if (px) setWidth(variable, px);
  }, [variable]);

  const sign = edge === 'right' ? 1 : -1;
  const panel = (e: { currentTarget: HTMLElement }) => e.currentTarget.parentElement!.getBoundingClientRect();
  const commit = () => save(variable, String(parseFloat(root.getPropertyValue(variable))));

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = panel(e);
    setWidth(variable, edge === 'right' ? e.clientX - r.left : r.right - e.clientX);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    setWidth(variable, panel(e).width + dir * sign * STEP);
    commit();
  };

  return (
    <div
      className={`splitter ${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={commit}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        root.removeProperty(variable);
        save(variable, null);
      }}
    />
  );
}
