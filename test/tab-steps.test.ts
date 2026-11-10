import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blank } from './helpers';
import { stubPage, versionedDisk } from './page';

let page: ReturnType<typeof stubPage>;
beforeAll(() => void (page = stubPage()));
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Boards of one project, opened on the first; from then on, each takes 100 ms to load. */
async function start(...ids: string[]) {
  const { boot, useStore } = await import('../src/model/store');
  const { nextTab } = await import('../src/ui/tabKeys');
  const { backend, box } = versionedDisk(ids.map((id) => ({ ...blank(id), meta: { title: id, project: 'P' } })));
  page.storage.set('keito:current', ids[0]);
  await boot(backend);
  box.delay = 100;
  return {
    press: (step: 1 | -1) => useStore.getState().openBoard(nextTab(step)!),
    click: (id: string) => useStore.getState().openBoard(id),
    wait: (ms: number) => vi.advanceTimersByTimeAsync(ms),
    shown: async () => {
      await vi.advanceTimersByTimeAsync(1000);
      return useStore.getState().doc.id;
    },
  };
}

describe('⌘⇧] / ⌘⇧[ pressed again before the board opens', () => {
  it('goes one tab further on each press', async () => {
    const { press, shown } = await start('a', 'b', 'c');
    press(1);
    press(1);
    expect(await shown()).toBe('c');
  });

  it('cancels the load when pressed back to the board on screen, and counts from that board', async () => {
    const { press, shown } = await start('a', 'b', 'c');
    press(1); // b
    press(-1); // a, the board on screen: the load of b is cancelled
    press(-1); // c
    expect(await shown()).toBe('c');
  });

  it('counts from the board still loading after an earlier, cancelled load of the same board ends', async () => {
    const { press, wait, shown } = await start('a', 'b');
    press(1); // b
    press(1); // a, the board on screen: the load of b is cancelled
    await wait(10);
    press(1); // b again
    await wait(95); // the cancelled load of b ends
    press(1); // a
    expect(await shown()).toBe('a');
  });

  it('counts from a tab clicked while a board is loading', async () => {
    const { press, click, shown } = await start('a', 'b', 'c', 'd');
    press(1); // b
    click('d');
    press(1); // a, the tab after d
    expect(await shown()).toBe('a');
  });
});
