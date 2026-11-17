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
    /** The board on screen at this moment (`shown` waits for the loads under way first). */
    now: () => useStore.getState().doc.id,
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

describe('a tab clicked again while its board is still loading', () => {
  it('lets the load go on, rather than start it over', async () => {
    const { click, wait, now } = await start('a', 'b');
    click('b');
    await wait(50);
    click('b');
    await wait(60); // 110 ms: the first load has ended; one begun at the second click would not have
    expect(now()).toBe('b');
  });
});

describe('the keys for the next and the previous tab', () => {
  type Mods = Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>;
  const key = (k: string, mods: Mods = {}) => ({ key: k, metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, ...mods });

  it('takes ⌘⇧] / ⌘⇧[, shifted or not, and Ctrl in place of ⌘', async () => {
    const { tabStep } = await import('../src/ui/tabKeys');
    expect(tabStep(key(']'), false)).toBe(1);
    expect(tabStep(key('}'), false)).toBe(1);
    expect(tabStep(key('['), false)).toBe(-1);
    expect(tabStep(key('{', { metaKey: false, ctrlKey: true }), false)).toBe(-1);
    // From a text field too: the edit is committed first.
    expect(tabStep(key(']'), true)).toBe(1);
  });

  it('takes ⌘⇧→ / ⌘⇧← too, but leaves them to select text in a field', async () => {
    const { tabStep } = await import('../src/ui/tabKeys');
    expect(tabStep(key('ArrowRight'), false)).toBe(1);
    expect(tabStep(key('ArrowLeft', { metaKey: false, ctrlKey: true }), false)).toBe(-1);
    expect(tabStep(key('ArrowRight'), true)).toBe(0);
    expect(tabStep(key('ArrowLeft'), true)).toBe(0);
  });

  it('leaves other keys alone: ⌘+arrow (the next shape), ⌘⇧↑, and any with ⌥', async () => {
    const { tabStep } = await import('../src/ui/tabKeys');
    expect(tabStep(key('ArrowRight', { shiftKey: false }), false)).toBe(0);
    expect(tabStep(key('ArrowUp'), false)).toBe(0);
    expect(tabStep(key(']', { altKey: true }), false)).toBe(0);
    expect(tabStep(key(']', { metaKey: false }), false)).toBe(0);
  });
});
