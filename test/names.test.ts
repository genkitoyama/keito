import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/model/lists';
import { safeName } from '../src/model/names';

describe('file names', () => {
  it('makes any title a name every system takes', () => {
    expect(safeName('展示 系統図: v2/最終?')).toBe('展示_系統図_v2_最終');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('nul.v2')).toBe('_nul.v2');
    expect(safeName('末尾の点...')).toBe('末尾の点');
    expect(safeName('a\u0001b')).toBe('a_b');
    expect(safeName('')).toBe('board');
  });

  it('keeps a long Japanese title short enough for the file system', () => {
    const name = safeName('長'.repeat(200));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(150);
  });
});

describe('CSV', () => {
  const csv = (cells: string[]) => toCsv({ title: 't', head: ['a'], widths: [1], rows: cells.map((c) => [c]), refs: cells.map(() => []) } as never);

  it('keeps text that looks like a formula as text', () => {
    const out = csv(['+4dBu', '-10dBV', '=SUM(A1)', '@x', '-10', '12.5']).split('\r\n');
    expect(out.slice(1, 7)).toEqual(["'+4dBu", "'-10dBV", "'=SUM(A1)", "'@x", '-10', '12.5']);
  });

  it('starts with a BOM so Excel reads Japanese', () => {
    expect(csv(['日本語']).charCodeAt(0)).toBe(0xfeff);
  });
});
