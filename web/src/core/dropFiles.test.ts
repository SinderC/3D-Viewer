import { describe, expect, it } from 'vitest';
import { duplicateNames, filesOfDrop, filesOfFolder, type Entry } from './dropFiles';

const file = (name: string) => new File(['x'], name);
const fileEntry = (name: string): Entry => ({ isFile: true, isDirectory: false, file: (done) => done(file(name)) });
// Readers hand out the entries in batches of two, then none
const dirEntry = (...children: Entry[]): Entry => ({
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let at = 0;
    return {
      readEntries: (done) => {
        done(children.slice(at, at + 2));
        at += 2;
      },
    };
  },
});
const drop = (entries: Entry[]) =>
  ({ items: entries.map((e) => ({ webkitGetAsEntry: () => e, getAsFile: () => (e.isFile ? file('loose.stp') : null) })), files: [] }) as unknown as DataTransfer;

describe('filesOfDrop', () => {
  it('reads the model files of a dropped folder, subfolders and batches included', async () => {
    const dropped = dirEntry(fileEntry('a.jt'), fileEntry('notes.txt'), dirEntry(fileEntry('b.jt')), fileEntry('c.stp'));
    const names = (await filesOfDrop(drop([dropped]))).map((f) => f.name);
    expect(names.sort()).toEqual(['a.jt', 'b.jt', 'c.stp']);
  });

  it('keeps files dropped next to a folder', async () => {
    const names = (await filesOfDrop(drop([fileEntry('x'), dirEntry(fileEntry('a.jt'))]))).map((f) => f.name);
    expect(names.sort()).toEqual(['a.jt', 'loose.stp']);
  });
});

describe('filesOfFolder', () => {
  it('keeps the model files', () => {
    expect(filesOfFolder([file('a.jt'), file('readme.md')]).map((f) => f.name)).toEqual(['a.jt']);
  });
});

describe('duplicateNames', () => {
  it('names the files that share a name, whatever the case', () => {
    expect(duplicateNames([file('a.jt'), file('b.jt'), file('A.JT'), file('c.jt'), file('a.jt')])).toEqual(['a.jt']);
  });

  it('finds none among distinct names', () => {
    expect(duplicateNames([file('a.jt'), file('b.jt')])).toEqual([]);
  });
});
