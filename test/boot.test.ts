import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../src/platform/storage';
import { stubPage } from './page';

beforeAll(() => void stubPage());
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('starting on a folder whose boards cannot be read', () => {
  it('does not take it for a first run and write the sample project among them', async () => {
    const { boot } = await import('../src/model/store');
    const saved: string[] = [];
    const backend = {
      mode: 'server',
      assets: false,
      assetUrl: (_: string, src: string) => src,
      fitsExitSave: () => true,
      exitSave: () => {},
      list: async () => [{ id: 'mine', title: 'わたしのボード', updated: 0 }],
      load: async () => {
        throw new Error('unreadable');
      },
      save: async (doc: { meta: { title: string } }) => void saved.push(doc.meta.title),
      remove: async () => {},
      trash: async () => [],
      restore: async () => '',
      putAsset: async (_: string, d: string) => d,
      saveRevision: async () => {},
      loadRevision: async () => null,
      removeRevision: async () => {},
      loadPresets: async () => [],
      savePresets: async () => {},
    } as unknown as Backend;
    await boot(backend);
    expect(saved).toEqual([]);
  });
});
