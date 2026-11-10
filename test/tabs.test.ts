import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Doc } from '../src/model/types';
import type { BoardInfo } from '../src/platform/storage';
import { blank } from './helpers';
import { stubPage, versionedDisk } from './page';

let page: ReturnType<typeof stubPage>;
beforeAll(() => void (page = stubPage()));
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('going to another tab and back', () => {
  it('keeps the board’s undo steps and where it was looked at', async () => {
    const { boot, useStore } = await import('../src/model/store');
    const { backend, box } = versionedDisk([{ ...blank('aaa'), meta: { title: 'A', project: 'P' } }, { ...blank('bbb'), meta: { title: 'B', project: 'P' } }]);
    page.storage.set('keito:current', 'aaa');
    await boot(backend);
    const s = () => useStore.getState();
    s().mutate((d) => ({ ...d, meta: { ...d.meta, title: 'A2' } }));
    s().setView({ x: 12, y: 34, k: 2 });
    s().openBoard('bbb');
    await vi.advanceTimersByTimeAsync(10);
    expect(s().doc.id).toBe('bbb');
    expect(s().past).toHaveLength(0);
    s().openBoard('aaa');
    await vi.advanceTimersByTimeAsync(10);
    expect(s().doc.meta.title).toBe('A2');
    expect(s().view).toEqual({ x: 12, y: 34, k: 2 });
    s().undo();
    expect(s().doc.meta.title).toBe('A');

    // Changed elsewhere meanwhile: the old steps no longer apply, and start afresh.
    s().openBoard('bbb');
    await vi.advanceTimersByTimeAsync(10);
    const a = box.kept.get('aaa')!;
    box.kept.set('aaa', { ...a, doc: { ...a.doc, meta: { ...a.doc.meta, title: 'A from the command line' } }, serial: a.serial + 1 });
    s().openBoard('aaa');
    await vi.advanceTimersByTimeAsync(10);
    expect(s().doc.meta.title).toBe('A from the command line');
    expect(s().past).toHaveLength(0);
  });
});

describe('the next and the previous tab (⌘⇧] / ⌘⇧[)', () => {
  const boards: BoardInfo[] = [
    { id: 'seq', title: 'A', updated: 0, project: 'P', kind: 'sequence' },
    { id: 'c', title: 'C', updated: 0, project: 'P' },
    { id: 'b', title: 'B', updated: 0, project: 'P', kind: 'system' },
    { id: 'free', title: 'Z', updated: 0, project: 'P', kind: 'free' },
    { id: 'other', title: 'O', updated: 0, project: 'Q' },
  ];
  const open = (id: string): Doc => {
    const b = boards.find((x) => x.id === id)!;
    return { ...blank(id), kind: b.kind, meta: { title: b.title, project: b.project ?? '' } };
  };

  it('goes along the tabs as they are shown, and round from either end', async () => {
    const { boardBeside } = await import('../src/ui/BoardTabs');
    // The tabs: B, C (system), A (sequence), Z (free).
    expect(boardBeside(open('b'), boards, 1)).toBe('c');
    expect(boardBeside(open('c'), boards, 1)).toBe('seq');
    expect(boardBeside(open('free'), boards, 1)).toBe('b');
    expect(boardBeside(open('b'), boards, -1)).toBe('free');
  });

  it('goes nowhere from a board alone in its project, or in none', async () => {
    const { boardBeside } = await import('../src/ui/BoardTabs');
    expect(boardBeside(open('other'), boards, 1)).toBeUndefined();
    expect(boardBeside({ ...blank('x'), meta: { title: 'X', project: '' } }, boards, -1)).toBeUndefined();
  });
});
