import { useState } from 'react';

// Storage can be unavailable (private mode, blocked site data); what it keeps is a convenience.

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a value, or removes it when null. */
export function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** A choice among the keys of `options`, kept across sessions. */
export function useStored<T extends string>(key: string, options: Record<T, unknown>, fallback: NoInfer<T>): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const v = load(key);
    return v !== null && v in options ? (v as T) : fallback;
  });
  const set = (v: T) => {
    setValue(v);
    save(key, v);
  };
  return [value, set];
}

const FLAG = { shown: true, hidden: false };

/** Whether something is shown (the default), kept across sessions; and its toggle. */
export function useStoredFlag(key: string): [boolean, () => void] {
  const [value, set] = useStored(key, FLAG, 'shown');
  return [FLAG[value], () => set(value === 'shown' ? 'hidden' : 'shown')];
}
