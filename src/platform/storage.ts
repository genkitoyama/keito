import type { Doc, UserPreset } from '../model/types';
import { boardKind, readBoard } from '../model/load';
import { upgradePreset } from '../model/video';

/**
 * Persistence boundary. Boards live in a folder on disk when the keito server
 * is running (`npm run dev` / `npm run preview`): one folder per board holding
 * board.json and its pictures. Without the server — a static build, or
 * `?local` in the URL — everything stays in this browser's localStorage. A
 * Tauri build only needs to supply another Backend.
 */
export interface BoardInfo {
  id: string;
  title: string;
  updated: number;
  /** The project (案件名) it belongs to, and what kind of board it is (unset: a system board). */
  project?: string;
  kind?: Doc['kind'];
}

export interface Backend {
  mode: 'server' | 'local';
  list(): Promise<BoardInfo[]>;
  load(id: string): Promise<Doc | null>;
  /**
   * Store a board. On disk the write is checked against the version the board was read at, and
   * a board changed elsewhere meanwhile throws Conflict unless `force` says to overwrite it.
   */
  save(doc: Doc, force?: boolean): Promise<void>;
  /** The version of a board as last read or written here (on disk only). */
  serialOf?(id: string): number | undefined;
  remove(id: string): Promise<void>;
  /** Store a picture for a board; resolves to the `src` to keep on the node. */
  putAsset(boardId: string, dataUrl: string): Promise<string>;
  /** Keep / fetch / drop the board as it stood at a recorded revision. */
  saveRevision(boardId: string, id: string, doc: Doc): Promise<void>;
  loadRevision(boardId: string, id: string): Promise<Doc | null>;
  removeRevision(boardId: string, id: string): Promise<void>;
  /** The user's own device presets, shared by all boards. */
  loadPresets(): Promise<UserPreset[]>;
  savePresets(list: UserPreset[]): Promise<void>;
}

/** A board on disk was written by someone else (the command line, another tab) since it was read. */
export class Conflict extends Error {
  constructor(readonly serial: number) {
    super('ボードはほかの場所で更新されています');
  }
}

const INDEX = 'keito:boards';
const key = (id: string): string => `keito:board:${id}`;
const API = '/api/boards';

const clean = readBoard;

function localList(): BoardInfo[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function localLoad(id: string): Doc | null {
  try {
    return clean(JSON.parse(localStorage.getItem(key(id)) ?? 'null'));
  } catch {
    return null;
  }
}

/** Boards kept in this browser — the fallback store, and what gets migrated to disk. */
export const localBoards = (): Doc[] => localList().map((b) => localLoad(b.id)).filter((d): d is Doc => !!d);

const local: Backend = {
  mode: 'local',
  // Boards listed before projects and kinds were noted in the index get them from the board itself.
  list: async () =>
    localList().map((b) => {
      if (b.project !== undefined || b.kind !== undefined) return { ...b, kind: boardKind(b.kind) };
      const doc = localLoad(b.id);
      return doc ? { ...b, project: doc.meta.project || undefined, kind: doc.kind } : b;
    }),
  load: async (id) => localLoad(id),
  // Throws when the board no longer fits (localStorage holds roughly 5 MB per site).
  save: async (doc) => {
    localStorage.setItem(key(doc.id), JSON.stringify(doc));
    const info: BoardInfo = { id: doc.id, title: doc.meta.title, updated: Date.now(), project: doc.meta.project || undefined, kind: doc.kind };
    localStorage.setItem(INDEX, JSON.stringify([info, ...localList().filter((b) => b.id !== doc.id)]));
  },
  remove: async (id) => {
    localStorage.removeItem(key(id));
    localStorage.setItem(INDEX, JSON.stringify(localList().filter((b) => b.id !== id)));
  },
  putAsset: async (_boardId, dataUrl) => dataUrl,
  saveRevision: async (boardId, id, doc) => localStorage.setItem(`keito:rev:${boardId}:${id}`, JSON.stringify(doc)),
  loadRevision: async (boardId, id) => {
    try {
      return clean(JSON.parse(localStorage.getItem(`keito:rev:${boardId}:${id}`) ?? 'null'));
    } catch {
      return null;
    }
  },
  removeRevision: async (boardId, id) => localStorage.removeItem(`keito:rev:${boardId}:${id}`),
  loadPresets: async () => {
    try {
      const v = JSON.parse(localStorage.getItem('keito:presets') ?? '[]');
      return Array.isArray(v) ? v.map(upgradePreset) : [];
    } catch {
      return [];
    }
  },
  savePresets: async (list) => localStorage.setItem('keito:presets', JSON.stringify(list)),
};

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`保存サーバーがエラーを返しました (${res.status})`);
  return res;
}

// The version of each board on disk as this page last read or wrote it.
const serials = new Map<string, number>();

const server: Backend = {
  mode: 'server',
  list: async () => ((await (await ok(await fetch(API))).json()) as BoardInfo[]).map((b) => ({ ...b, kind: boardKind(b.kind) })),
  load: async (id) => {
    const res = await fetch(`${API}/${id}`);
    if (res.status === 404) return null;
    const raw = await (await ok(res)).json();
    serials.set(id, Number(raw?.serial) || 0);
    return clean(raw);
  },
  save: async (doc, force) => {
    const known = serials.get(doc.id);
    const res = await fetch(`${API}/${doc.id}`, {
      method: 'PUT',
      // Written on the version read; a board never read here (just made) has nothing to check.
      headers: { 'Content-Type': 'application/json', ...(force || known === undefined ? { 'If-Match': '*' } : { 'If-Match': String(known) }) },
      body: JSON.stringify(doc),
    });
    if (res.status === 409) throw new Conflict(Number((await res.json()).serial) || 0);
    const done = await (await ok(res)).json();
    if (typeof done?.serial === 'number') serials.set(doc.id, done.serial);
  },
  serialOf: (id) => serials.get(id),
  remove: async (id) => {
    await ok(await fetch(`${API}/${id}`, { method: 'DELETE' }));
  },
  putAsset: async (boardId, dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = EXT[blob.type.split(';')[0]];
    if (!ext) return dataUrl;
    // Named by content hash: the same picture is stored once, and its URL never changes.
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const name = `${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
    await ok(await fetch(`${API}/${boardId}/assets/${name}`, { method: 'PUT', body: blob }));
    return `asset:${name}`;
  },
  saveRevision: async (boardId, id, doc) => {
    await ok(await fetch(`${API}/${boardId}/revisions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) }));
  },
  loadRevision: async (boardId, id) => {
    const res = await fetch(`${API}/${boardId}/revisions/${id}`);
    return res.status === 404 ? null : clean(await (await ok(res)).json());
  },
  removeRevision: async (boardId, id) => {
    await ok(await fetch(`${API}/${boardId}/revisions/${id}`, { method: 'DELETE' }));
  },
  loadPresets: async () => {
    const v = await (await ok(await fetch('/api/presets'))).json();
    return Array.isArray(v) ? v.map(upgradePreset) : [];
  },
  savePresets: async (list) => {
    await ok(await fetch('/api/presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list) }));
  },
};

/** Use the on-disk store when the keito server answers; otherwise stay in the browser. */
export async function connect(): Promise<Backend> {
  if (new URLSearchParams(location.search).has('local')) return local;
  try {
    const res = await fetch(API);
    if (res.ok && Array.isArray(await res.json())) return server;
  } catch {
    // No server (static build / file://): fall through.
  }
  return local;
}

/** URL a picture is displayed from. `asset:` sources live in the board's folder. */
export const assetUrl = (boardId: string | undefined, src: string): string =>
  src.startsWith('asset:') && boardId ? `${API}/${boardId}/assets/${src.slice(6)}` : src;

/** Move embedded pictures (data URLs) out of the board into its asset folder. */
export async function externalize(doc: Doc, backend: Backend): Promise<Doc> {
  if (backend.mode === 'local' || !doc.nodes.some((n) => n.type === 'image' && n.src.startsWith('data:'))) return doc;
  // Assets hang off the board's folder, which exists once the board has been saved.
  await backend.save(doc);
  const nodes = await Promise.all(doc.nodes.map(async (n) => (n.type === 'image' && n.src.startsWith('data:') ? { ...n, src: await backend.putAsset(doc.id, n.src) } : n)));
  return { ...doc, nodes };
}

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('ファイルを読めませんでした'));
    r.readAsDataURL(blob);
  });

/** The opposite: pull pictures back into the board so an export or a saved file stands alone. */
export async function inlineImages(doc: Doc): Promise<Doc> {
  if (!doc.nodes.some((n) => n.type === 'image' && n.src.startsWith('asset:'))) return doc;
  const nodes = await Promise.all(
    doc.nodes.map(async (n) => {
      if (n.type !== 'image' || !n.src.startsWith('asset:')) return n;
      try {
        return { ...n, src: await toDataUrl(await (await ok(await fetch(assetUrl(doc.id, n.src)))).blob()) };
      } catch {
        return n;
      }
    }),
  );
  return { ...doc, nodes };
}

export function getSetting(name: string): string {
  return localStorage.getItem(`keito:setting:${name}`) ?? '';
}
export function setSetting(name: string, value: string): void {
  localStorage.setItem(`keito:setting:${name}`, value);
}

export function download(name: string, data: Blob | string, type = 'application/octet-stream'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Ask for one file of the given kinds; null when the dialog is dismissed. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\s]+/g, '_') || 'board';

export interface LoadedImage {
  src: string;
  w: number;
  h: number;
  name: string;
}

const MAX_SIDE = 2400;
export const isImageFile = (f: File): boolean => f.type.startsWith('image/') || /\.(svg|png|jpe?g|gif|webp)$/i.test(f.name);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

/** Read a picture as a data URL. SVG stays vector; very large rasters are scaled down. */
export async function readImageFile(file: File): Promise<LoadedImage> {
  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  let src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await file.text())}` : await toDataUrl(file);
  const img = await loadImage(src);
  let w = img.naturalWidth || 300;
  let h = img.naturalHeight || 300;
  if (!svg && Math.max(w, h) > MAX_SIDE) {
    const k = MAX_SIDE / Math.max(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    src = canvas.toDataURL('image/webp', 0.92);
    w = canvas.width;
    h = canvas.height;
  }
  return { src, w, h, name: file.name.replace(/\.[^.]+$/, '') };
}
