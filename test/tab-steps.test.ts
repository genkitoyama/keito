import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { blank } from './helpers';
import { stubPage, versionedDisk } from './page';
import type { DeviceNode } from '../src/model/types';

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
  const shape: DeviceNode = { id: 'n1', type: 'device', x: 0, y: 0, w: 160, h: 0, text: 'old', maker: '', model: '', category: '', note: '', ports: [], shared: 'pc', sharedAt: 1 };
  const { backend, box } = versionedDisk(ids.map((id) => ({ ...blank(id), meta: { title: id, project: 'P' }, nodes: [shape] })));
  page.storage.set('keito:current', ids[0]);
  // A board of the same id left on screen by an earlier test would make this one's opening look like an edit of it.
  useStore.setState({ ready: false, doc: blank('none') });
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
    keepState: async () => {
      box.delay = 0;
      useStore.getState().nameState('kept');
      await vi.advanceTimersByTimeAsync(1000);
      box.delay = 100;
      vi.spyOn(backend, 'loadRevision').mockResolvedValue({ ...blank(ids[0]), meta: { title: ids[0], project: 'P' } });
      return useStore.getState().doc.revisions!.at(-1)!.id;
    },
    justShown: async (id: string) => {
      for (let ms = 0; ms < 10_000 && useStore.getState().doc.id !== id; ms++) await vi.advanceTimersByTimeAsync(1);
      return useStore.getState().doc.id;
    },
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
    await wait(170);
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
    await wait(210);
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

describe('a state from the history opened while another board loads', () => {
  it.each([
    ['left open', false],
    ['closed again', true],
  ] as const)('keeps the undo steps of the board left, with the state %s', async (_how, closeAgain) => {
    const { state, click, wait, now, keepState } = await start('a', 'b');
    state().updateNode('n1', { x: 12 });
    const revision = await keepState();
    click('b');
    await wait(50);
    state().viewRevision(revision);
    await wait(10);
    expect(state().viewing).toBeTruthy();
    if (closeAgain) state().exitRevision();
    await wait(100);
    expect(now()).toBe('b');

    click('a');
    await wait(200);
    expect(now()).toBe('a');
    state().undo();
    expect(state().doc.nodes[0].x).toBe(0);
  });

  it('keeps the undo step of an edit made just before the state is opened', async () => {
    const { state, click, wait, now, keepState } = await start('a', 'b');
    const revision = await keepState();
    click('b');
    await wait(50);
    state().updateNode('n1', { x: 24 });
    state().viewRevision(revision);
    await wait(10);
    expect(state().viewing).toBeTruthy();
    await wait(200);
    expect(now()).toBe('b');

    click('a');
    await wait(200);
    expect(now()).toBe('a');
    expect(state().doc.nodes[0].x).toBe(24);
    state().undo();
    expect(state().doc.nodes[0].x).toBe(0);
  });
});

describe('a state from the history clicked again while a shared edit is being written', () => {
  it('says the board is saved once it is', async () => {
    const { backend, state, wait, keepState } = await start('a', 'b');
    await wait(200);
    const revision = await keepState();
    const save = backend.save;
    vi.spyOn(backend, 'save').mockImplementation(async (doc) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await save(doc);
    });
    state().updateNode('n1', { text: 'new' });
    state().viewRevision(revision);
    await wait(80);
    state().viewRevision(revision);
    await wait(1000);
    state().exitRevision();
    expect(state().saving).toBe('saved');
  });
});

describe('a board edited while a state from the history waits for a shared edit to be written', () => {
  it('saves the board, never the state opened over it', async () => {
    const { box, state, wait, keepState } = await start('a', 'b', 'c');
    await wait(200);
    const revision = await keepState();
    state().updateNode('n1', { text: 'new' });
    await wait(850);
    state().viewRevision(revision);
    await wait(50);
    state().updateNode('n1', { x: 9 });
    await wait(3000);
    expect(state().viewing).toBeTruthy();
    expect(box.kept.get('a')?.doc.nodes[0]).toMatchObject({ text: 'new', x: 9 });
  });
});

describe('a shared device edited while another board loads', () => {
  it('keeps the edit on every board when the next one is edited as soon as it is shown', async () => {
    const { box, state, click, wait, justShown } = await start('a', 'b');
    click('b');
    await wait(50);
    state().updateNode('n1', { text: 'new' });
    expect(await justShown('b')).toBe('b');
    expect(state().doc.nodes[0]).toMatchObject({ text: 'new' });
    state().updateNode('n1', { ip: '10.0.0.2' });
    await wait(2000);
    for (const id of ['a', 'b']) expect(box.kept.get(id)?.doc.nodes[0]).toMatchObject({ text: 'new', ip: '10.0.0.2' });
  });

  it('shows the edit made while the one before it is being written to the other boards', async () => {
    const { state, click, wait, justShown } = await start('a', 'b');
    click('b');
    await wait(50);
    state().updateNode('n1', { text: 'ne' });
    await wait(100);
    state().updateNode('n1', { text: 'new' });
    expect(await justShown('b')).toBe('b');
    expect(state().doc.nodes[0]).toMatchObject({ text: 'new' });
  });

  it('shows the edit still being written to the other boards when the load ends', async () => {
    const { box, state, click, wait, justShown } = await start('a', 'c', 'b');
    await wait(200);
    box.delay = 900;
    click('b');
    await wait(10);
    state().updateNode('n1', { text: 'new' });
    expect(await justShown('b')).toBe('b');
    expect(state().doc.nodes[0]).toMatchObject({ text: 'new' });
  });

  it('shows the edit when a state from the history is opened over it before the load ends', async () => {
    const { backend, box, state, click, wait, justShown, keepState } = await start('a', 'b');
    const revision = await keepState();
    const readAtRequest = structuredClone(box.kept.get('b')!.doc);
    vi.spyOn(backend, 'load').mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return readAtRequest;
    });
    click('b');
    await wait(50);
    state().updateNode('n1', { text: 'new' });
    state().viewRevision(revision);
    expect(await justShown('b')).toBe('b');
    expect(state().doc.nodes[0]).toMatchObject({ text: 'new' });
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
