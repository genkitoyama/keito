import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../src/platform/storage';
import type { Doc } from '../src/model/types';
import { blank } from './helpers';

// The store runs in a page: give it just enough of one.
const listeners: Record<string, () => void> = {};
const storage = new Map<string, string>();
beforeAll(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: (k: string, f: () => void) => (listeners[k] = f) });
  vi.stubGlobal('document', { getElementById: () => null, addEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  vi.stubGlobal('location', { hash: '', pathname: '/', search: '' });
  vi.stubGlobal('history', { replaceState: () => {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A folder that refuses the next `failing` writes, as a busy or restarting server would. */
function flaky(board: Doc) {
  const kept = new Map([[board.id, board]]);
  const box = { failing: 0, writes: 0, kept };
  const backend: Backend = {
    mode: 'server',
    assets: false,
    assetUrl: (_, src) => src,
    fitsExitSave: () => true,
    exitSave: () => {},
    list: async () => [...kept.values()].map((d) => ({ id: d.id, title: d.meta.title, updated: 0 })),
    load: async (id) => kept.get(id) ?? null,
    save: async (doc) => {
      box.writes++;
      if (box.failing > 0) {
        box.failing--;
        throw new Error('busy');
      }
      kept.set(doc.id, doc);
    },
    remove: async () => {},
    trash: async () => [],
    restore: async () => '',
    putAsset: async (_, d) => d,
    saveRevision: async () => {},
    loadRevision: async () => null,
    removeRevision: async () => {},
    loadPresets: async () => [],
    savePresets: async () => {},
  };
  return { backend, box };
}

describe('autosave', () => {
  it('tries a failed write again by itself until it goes through', async () => {
    const { boot, useStore } = await import('../src/model/store');
    const board = { ...blank('retry1'), meta: { title: '再試行', project: '' } };
    const { backend, box } = flaky(board);
    await boot(backend);
    expect(useStore.getState().doc.id).toBe('retry1');

    box.failing = 2;
    useStore.getState().mutate((d) => ({ ...d, meta: { ...d.meta, title: '再試行 2' } }));
    await vi.advanceTimersByTimeAsync(600);
    expect(useStore.getState().saving).toBe('error');
    // Nothing more is edited: the store comes back to it, waiting longer each time.
    await vi.advanceTimersByTimeAsync(2_100);
    expect(useStore.getState().saving).toBe('error');
    await vi.advanceTimersByTimeAsync(5_100);
    expect(useStore.getState().saving).toBe('saved');
    expect(box.writes).toBe(3);
    expect(box.kept.get('retry1')?.meta.title).toBe('再試行 2');
    // Saved: no more attempts.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(box.writes).toBe(3);
  });
});
