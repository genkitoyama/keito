import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blank } from './helpers';
import { stubPage, versionedDisk } from './page';

let page: ReturnType<typeof stubPage>;
beforeAll(() => void (page = stubPage()));
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a board written elsewhere while it is being read in', () => {
  it('keeps the other change and asks, rather than writing over it', async () => {
    const { boot, useStore } = await import('../src/model/store');
    const { backend, box } = versionedDisk([{ ...blank('aaa'), meta: { title: 'A', project: '' } }]);
    page.storage.set('keito:current', 'aaa');
    await boot(backend);
    // Written elsewhere (the command line); coming back to the window reads it in, slowly.
    box.kept.set('aaa', { doc: { ...blank('aaa'), meta: { title: 'A from CLI', project: '' } }, serial: 2 });
    box.delay = 100;
    page.listeners.focus();
    await vi.advanceTimersByTimeAsync(20);
    // An edit made here while it is read in.
    useStore.getState().mutate((d) => ({ ...d, meta: { ...d.meta, title: 'A here' } }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(box.kept.get('aaa')?.doc.meta.title).toBe('A from CLI');
    expect(useStore.getState().saving).toBe('conflict');
  });
});
