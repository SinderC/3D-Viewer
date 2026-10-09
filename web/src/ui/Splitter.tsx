import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { load, save } from './storage';

interface Props {
  /** CSS variable holding the panel width (read by the .app grid); also its storage key. */
  variable: string;
  /** Edge of the parent panel the splitter sits on. */
  edge: 'left' | 'right';
  /** Dragging well past the minimum width hides the panel. */
  onCollapse?: () => void;
}

const MIN = 180;
const STEP = 16;
const SPRING_RESPONSE = 0.3; // seconds, critically damped
const root = document.documentElement.style;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const maxWidth = () => innerWidth * 0.4;
const setRaw = (variable: string, px: number) => root.setProperty(variable, `${Math.round(px)}px`);

// The stylesheet caps the width at 40vw as well, for a window that shrinks later.
function setWidth(variable: string, px: number) {
  setRaw(variable, Math.min(Math.max(px, MIN), maxWidth()));
}

// Progressive resistance past the minimum width, instead of a hard stop.
function rubberband(overshoot: number, dimension = MIN, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * overshoot);
}

// Drag handle (or arrow keys) on a panel edge to set the panel's width; double-click restores the default.
export function Splitter({ variable, edge, onCollapse }: Props) {
  const spring = useRef(0);
  useEffect(() => () => cancelAnimationFrame(spring.current), []);
  useEffect(() => {
    const px = Number(load(variable));
    if (px) setWidth(variable, px);
  }, [variable]);

  const sign = edge === 'right' ? 1 : -1;
  const panel = (e: { currentTarget: HTMLElement }) => e.currentTarget.parentElement!.getBoundingClientRect();
  const commit = () => save(variable, String(parseFloat(root.getPropertyValue(variable))));
  const dragWidth = (e: PointerEvent<HTMLDivElement>) => {
    const r = panel(e);
    return edge === 'right' ? e.clientX - r.left : r.right - e.clientX;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const w = dragWidth(e);
    if (w < MIN) setRaw(variable, MIN - rubberband(MIN - w));
    else setWidth(variable, w);
  };

  // Settle back to the minimum from wherever the rubber band left the panel.
  const springBack = (from: number) => {
    const omega = (2 * Math.PI) / SPRING_RESPONSE;
    const x0 = from - MIN;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / 1000;
      const x = x0 * (1 + omega * t) * Math.exp(-omega * t);
      setRaw(variable, MIN + x);
      if (Math.abs(x) > 0.5 && !reducedMotion.matches) spring.current = requestAnimationFrame(step);
      else setWidth(variable, MIN);
    };
    spring.current = requestAnimationFrame(step);
  };

  // Fires after pointerup and pointercancel alike, so the panel never stays rubber-banded.
  const onRelease = (e: PointerEvent<HTMLDivElement>) => {
    const w = dragWidth(e);
    if (w >= MIN) return commit();
    save(variable, String(MIN));
    if (onCollapse && w < MIN / 2) {
      setWidth(variable, MIN);
      onCollapse();
    } else springBack(panel(e).width);
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
        cancelAnimationFrame(spring.current);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onLostPointerCapture={onRelease}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        root.removeProperty(variable);
        save(variable, null);
      }}
    />
  );
}
