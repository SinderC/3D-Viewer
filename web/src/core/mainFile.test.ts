import { describe, expect, it } from 'vitest';
import { mainFileIndex } from './mainFile';

describe('mainFileIndex', () => {
  it('picks the assembly that names the other files', () => {
    expect(mainFileIndex(['part.stp', 'asm.stp'], ["DATA;#1=PRODUCT('p');", "DATA;#9=DOCUMENT_FILE('Part.STP','',$);"])).toBe(1);
  });

  it('picks the top assembly when a subassembly names files too', () => {
    const texts = ["DOCUMENT_FILE('part.stp')", "DOCUMENT_FILE('sub.stp')", 'part'];
    expect(mainFileIndex(['sub.stp', 'top.stp', 'part.stp'], texts)).toBe(1);
  });

  it('falls back to the first file', () => {
    expect(mainFileIndex(['a.stp', 'b.igs'], ['x', undefined])).toBe(0);
  });
});
