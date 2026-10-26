import { vi } from 'vitest';
import { Conflict, Gone } from '../src/platform/storage';
import type { Backend } from '../src/platform/storage';
import type { Doc } from '../src/model/types';

/** The store runs in a page: give it just enough of one. Returns the page's event listeners. */
export function stubPage(): { listeners: Record<string, (e?: unknown) => void>; storage: Map<string, string> } {
  const listeners: Record<string, (e?: unknown) => void> = {};
  const storage = new Map<string, string>();
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: (k: string, f: () => void) => (listeners[k] = f) });
  vi.stubGlobal('document', { getElementById: () => null, addEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  vi.stubGlobal('location', { hash: '', pathname: '/', search: '' });
  vi.stubGlobal('history', { replaceState: () => {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  return { listeners, storage };
}

/**
 * A folder of boards that, like the real ones, numbers each write and refuses one made on an older
 * version (Conflict) or on a board deleted meanwhile (Gone). `delay` holds up reads.
 */
export function versionedDisk(boards: Doc[]) {
  const kept = new Map<string, { doc: Doc; serial: number }>(boards.map((d) => [d.id, { doc: d, serial: 1 }]));
  const known = new Map<string, number>();
  const box = { kept, delay: 0 };
  const backend: Backend = {
    mode: 'server',
    assets: false,
    assetUrl: (_, src) => src,
    fitsExitSave: () => true,
    exitSave: () => {},
    list: async () => [...kept.values()].map(({ doc }) => ({ id: doc.id, title: doc.meta.title, updated: 0 })),
    load: async (id) => {
      if (box.delay) await new Promise((r) => setTimeout(r, box.delay));
      const k = kept.get(id);
      if (!k) return null;
      known.set(id, k.serial);
      return structuredClone(k.doc);
    },
    save: async (doc, force) => {
      const k = kept.get(doc.id);
      const base = force ? undefined : known.get(doc.id);
      if (base !== undefined && !k) throw new Gone();
      if (base !== undefined && k && k.serial !== base) throw new Conflict(k.serial);
      const serial = (k?.serial ?? 0) + 1;
      kept.set(doc.id, { doc, serial });
      known.set(doc.id, serial);
    },
    remove: async (id) => void kept.delete(id),
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
