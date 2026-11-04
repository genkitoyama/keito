import { describe, expect, it } from 'vitest';
import { shortcuts } from '../src/platform/io';

describe('shortcuts as the system writes them', () => {
  it('stays as it is on a Mac', () => {
    expect(shortcuts('やり直す（⇧⌘Z）', true)).toBe('やり直す（⇧⌘Z）');
  });

  it('spells out Ctrl and Shift elsewhere', () => {
    expect(shortcuts('元に戻す（⌘Z）', false)).toBe('元に戻す（Ctrl+Z）');
    expect(shortcuts('やり直す（⇧⌘Z）', false)).toBe('やり直す（Ctrl+Shift+Z）');
    expect(shortcuts('全体表示 (⇧1)', false)).toBe('全体表示 (Shift+1)');
    expect(shortcuts('keito > 設定…（⌘,）', false)).toBe('keito > 設定…（Ctrl+,）');
  });

  it('does not write the plus twice where the text has one', () => {
    expect(shortcuts('⌘+スクロール: ズーム ／ Space+ドラッグ: パン', false)).toBe('Ctrl+スクロール: ズーム ／ Space+ドラッグ: パン');
  });
});
