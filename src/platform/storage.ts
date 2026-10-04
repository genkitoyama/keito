import type { Doc } from '../model/types';

/**
 * Persistence boundary. The web build keeps boards in localStorage and uses
 * browser file pickers; a Tauri build only needs to replace this module.
 */
export interface BoardInfo {
  id: string;
  title: string;
  updated: number;
}

const INDEX = 'keito:boards';
const CURRENT = 'keito:current';
const key = (id: string): string => `keito:board:${id}`;

export function listBoards(): BoardInfo[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function loadBoard(id: string): Doc | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) ?? 'null');
    if (!v || v.version !== 1 || !Array.isArray(v.nodes)) return null;
    // Empty text boxes are invisible; drop any left behind by older versions.
    v.nodes = v.nodes.filter((n: { type?: string; text?: string }) => n.type !== 'text' || (n.text ?? '').trim() !== '');
    return v as Doc;
  } catch {
    return null;
  }
}

/** Set when the last save did not fit (localStorage holds roughly 5 MB per site). */
export let saveFailed = false;

export function saveBoard(doc: Doc): BoardInfo[] {
  try {
    localStorage.setItem(key(doc.id), JSON.stringify(doc));
    localStorage.setItem(CURRENT, doc.id);
    const info: BoardInfo = { id: doc.id, title: doc.meta.title, updated: Date.now() };
    const boards = [info, ...listBoards().filter((b) => b.id !== doc.id)];
    localStorage.setItem(INDEX, JSON.stringify(boards));
    saveFailed = false;
    return boards;
  } catch {
    saveFailed = true;
    return listBoards();
  }
}

export function removeBoard(id: string): BoardInfo[] {
  localStorage.removeItem(key(id));
  const boards = listBoards().filter((b) => b.id !== id);
  localStorage.setItem(INDEX, JSON.stringify(boards));
  return boards;
}

export const currentBoardId = (): string | null => localStorage.getItem(CURRENT);

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

export const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\s]+/g, '_') || 'board';

export interface LoadedImage {
  src: string;
  w: number;
  h: number;
  name: string;
}

const MAX_SIDE = 1600;
export const isImageFile = (f: File): boolean => f.type.startsWith('image/') || /\.(svg|png|jpe?g|gif|webp)$/i.test(f.name);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

/**
 * Read a picture as a data URL so it travels inside the board file. SVG stays
 * vector; large rasters are scaled down to keep boards within storage limits.
 */
export async function readImageFile(file: File): Promise<LoadedImage> {
  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  let src: string;
  if (svg) {
    src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await file.text())}`;
  } else {
    src = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('ファイルを読めませんでした'));
      r.readAsDataURL(file);
    });
  }
  const img = await loadImage(src);
  let w = img.naturalWidth || 300;
  let h = img.naturalHeight || 300;
  if (!svg && (file.size > 400_000 || Math.max(w, h) > MAX_SIDE)) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    src = canvas.toDataURL('image/webp', 0.9);
    w = canvas.width;
    h = canvas.height;
  }
  return { src, w, h, name: file.name.replace(/\.[^.]+$/, '') };
}
