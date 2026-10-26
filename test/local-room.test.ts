import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Doc } from '../src/model/types';
import { blank } from './helpers';

/** Browser storage that holds at most `limit` characters, as localStorage holds about 5 MB. */
const kept = new Map<string, string>();
const limit = 60_000;
beforeAll(() => {
  const used = () => [...kept].reduce((n, [k, v]) => n + k.length + v.length, 0);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (used() - (kept.get(k)?.length ?? 0) + v.length + (kept.has(k) ? 0 : k.length) > limit) throw new DOMException('full', 'QuotaExceededError');
      kept.set(k, v);
    },
    removeItem: (k: string) => void kept.delete(k),
    key: (i: number) => [...kept.keys()][i] ?? null,
    get length() {
      return kept.size;
    },
  });
  // Object.keys(localStorage) lists what it holds.
  vi.spyOn(Object, 'keys').mockImplementation(function (this: unknown, o: object) {
    return o === localStorage ? [...kept.keys()] : Reflect.ownKeys(o).filter((k): k is string => typeof k === 'string' && Object.getOwnPropertyDescriptor(o, k)?.enumerable === true);
  } as typeof Object.keys);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a board kept in the browser', () => {
  it('is still saved once its history has filled the storage, the oldest states making way', async () => {
    const { local } = await import('../src/platform/storage');
    const board = (text: string): Doc => ({ ...blank('b1'), meta: { title: 'B', project: '' }, nodes: [{ id: 'n', type: 'text', x: 0, y: 0, w: 10, h: 10, text }] });
    const revisions: NonNullable<Doc['revisions']> = [];
    // History until there is no room left for more.
    for (let i = 0; ; i++) {
      const id = `r${String(i).padStart(3, '0')}`;
      try {
        await local.saveRevision('b1', id, board('x'.repeat(4000)));
      } catch {
        break;
      }
      revisions.push({ id, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
      await local.save({ ...board('small'), revisions });
    }
    // The board grows: older states go, the board is written, the latest few stay.
    const big = { ...board('y'.repeat(20_000)), revisions };
    await expect(local.save(big)).resolves.toBeUndefined();
    expect(JSON.parse(kept.get('keito:board:b1')!).nodes[0].text).toHaveLength(20_000);
    const left = [...kept.keys()].filter((k) => k.startsWith('keito:rev:b1:')).sort();
    expect(left.length).toBeGreaterThanOrEqual(3);
    expect(left.at(-1)).toBe(`keito:rev:b1:${revisions.at(-1)!.id}`);
    // The board lists only the states still kept.
    const listed = JSON.parse(kept.get('keito:board:b1')!).revisions.map((r: { id: string }) => `keito:rev:b1:${r.id}`).sort();
    expect(listed).toEqual(left);
  });
});
