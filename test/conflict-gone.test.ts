import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blank } from './helpers';
import { stubPage, versionedDisk } from './page';

let page: ReturnType<typeof stubPage>;
beforeAll(() => void (page = stubPage()));
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a board deleted elsewhere', () => {
  it('leaves the next board opened saving as usual', async () => {
    const { boot, useStore } = await import('../src/model/store');
    const { backend, box } = versionedDisk([{ ...blank('aaa'), meta: { title: 'A', project: '' } }, { ...blank('bbb'), meta: { title: 'B', project: '' } }]);
    page.storage.set('keito:current', 'aaa');
    await boot(backend);
    // Deleted on disk, then edited here: the save is refused.
    box.kept.delete('aaa');
    useStore.getState().mutate((d) => ({ ...d, meta: { ...d.meta, title: 'A2' } }));
    await vi.advanceTimersByTimeAsync(600);
    expect(useStore.getState().saving).toBe('gone');
    // Deleted here too: the next board opens, and its edits are written.
    useStore.getState().deleteBoard('aaa');
    await vi.advanceTimersByTimeAsync(10);
    expect(useStore.getState().doc.id).toBe('bbb');
    expect(useStore.getState().saving).toBe('saved');
    useStore.getState().mutate((d) => ({ ...d, meta: { ...d.meta, title: 'B edited' } }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(box.kept.get('bbb')?.doc.meta.title).toBe('B edited');
  });
});
