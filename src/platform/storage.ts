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
    return v && v.version === 1 && Array.isArray(v.nodes) ? (v as Doc) : null;
  } catch {
    return null;
  }
}

export function saveBoard(doc: Doc): BoardInfo[] {
  localStorage.setItem(key(doc.id), JSON.stringify(doc));
  localStorage.setItem(CURRENT, doc.id);
  const info: BoardInfo = { id: doc.id, title: doc.meta.title, updated: Date.now() };
  const boards = [info, ...listBoards().filter((b) => b.id !== doc.id)];
  localStorage.setItem(INDEX, JSON.stringify(boards));
  return boards;
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
