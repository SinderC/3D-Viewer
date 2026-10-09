import { describe, expect, it } from 'vitest';
import { findShortcut, SHORTCUTS } from './shortcuts';

const press = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
  findShortcut({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('shortcuts', () => {
  it('binds each key once', () => {
    const keys = SHORTCUTS.map((s) => `${s.mod ? 'mod+' : ''}${s.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tells plain keys from Cmd/Ctrl ones and leaves Alt and unlisted combinations alone', () => {
    expect(press('o')?.label).toBe('Orthographic');
    expect(press('o', { metaKey: true })?.label).toBe('Open a file');
    expect(press('o', { ctrlKey: true })?.label).toBe('Open a file');
    expect(press('f', { metaKey: true })).toBeUndefined();
    expect(press('f', { altKey: true })).toBeUndefined();
    expect(press('F')?.label).toBe('Zoom to selection');
    expect(press('7')?.label).toBe('Bottom view');
  });
});
