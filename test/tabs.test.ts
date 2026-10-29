import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
