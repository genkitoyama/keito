import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { blank } from './helpers';
import { stubPage, versionedDisk } from './page';

let page: ReturnType<typeof stubPage>;
beforeAll(() => void (page = stubPage()));
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Boards of one project, opened on the first; from then on, each takes 100 ms to load. */
async function start(...ids: string[]) {
  const { boot, useStore } = await import('../src/model/store');
  const { nextTab } = await import('../src/ui/tabKeys');
  const shape = { id: 'n1', type: 'text' as const, x: 0, y: 0, w: 10, h: 10, text: 'hello' };
  const { backend, box } = versionedDisk(ids.map((id) => ({ ...blank(id), meta: { title: id, project: 'P' }, nodes: [shape] })));
  page.storage.set('keito:current', ids[0]);
  await boot(backend);
  box.delay = 100;
  return {
    backend,
    box,
    state: useStore.getState,
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

describe('editing the board on screen while another loads', () => {
  it.each([
    ['with another click on its tab', true],
    ['without another click on its tab', false],
  ] as const)('saves the edit before showing the next board %s', async (_when, clickAgain) => {
    const { box, state, click, wait, now } = await start('a', 'b');
    click('b');
    await wait(50);
    expect(now()).toBe('a');
    state().updateNode('n1', { x: 12 });
    const view = { x: 24, y: 36, k: 2 };
    state().setView(view);
    if (clickAgain) click('b');
    await wait(60);
    expect(now()).toBe('b');
    expect(box.kept.get('a')?.doc.nodes[0].x).toBe(12);

    state().setView({ x: 0, y: 0, k: 1 });
    click('a');
    await wait(110);
    expect(now()).toBe('a');
    expect(state().view).toEqual(view);
    state().undo();
    expect(state().doc.nodes[0].x).toBe(0);
  });

  it('saves another edit made while the first is being written', async () => {
    const { backend, box, state, click, wait, now } = await start('aaa', 'bbb');
    const save = backend.save;
    const saving = vi.spyOn(backend, 'save').mockImplementationOnce(async (doc) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await save(doc);
    });
    click('bbb');
    await wait(50);
    state().updateNode('n1', { x: 12 });
    await wait(60);
    expect(now()).toBe('aaa');
    expect(saving.mock.calls[0]?.[0].nodes[0].x).toBe(12);
    expect(box.kept.get('aaa')?.doc.nodes[0].x).toBe(0);
    state().updateNode('n1', { x: 24 });
    await wait(100);
    expect(now()).toBe('bbb');
    expect(box.kept.get('aaa')?.doc.nodes[0].x).toBe(24);
  });

  it.each(['conflict', 'error'] as const)('stays on the board when the edit meets a save %s', async (saving) => {
    const { backend, box, state, click, wait, now } = await start('a', 'b');
    click('b');
    await wait(50);
    state().updateNode('n1', { x: 12 });
    if (saving === 'conflict') {
      const a = box.kept.get('a')!;
      box.kept.set('a', { ...a, serial: a.serial + 1 });
    } else {
      vi.spyOn(backend, 'save').mockRejectedValueOnce(new Error('busy'));
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    }
    await wait(60);
    expect(now()).toBe('a');
    expect(state().doc.nodes[0].x).toBe(12);
    expect(state().saving).toBe(saving);
    expect(box.kept.get('a')?.doc.nodes[0].x).toBe(0);
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
