import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The boards folder, read and written the same way by the dev server and the command line (and,
 * later, the native app). The folder is the one truth about a board:
 *
 *   <root>/<title>__<id>/board.json
 *   <root>/<title>__<id>/assets/<hash>.<ext>
 *   <root>/<title>__<id>/revisions/<state id>.json   (the board's history, listed in board.json)
 *
 * Every write bumps `serial` in board.json. A writer says which serial its change was made on, and
 * a write made on an older one is refused, so two writers never silently undo each other.
 */

/**
 * What an id (of a board, a revision) may be. A double underscore is kept out: it parts a board's
 * title from its id in the folder's name, and inside an id it would make two boards' folders alike.
 */
export const ID = /^(?!.*__)[A-Za-z0-9_-]{1,64}$/;

/** Where the boards live: KEITO_BOARDS, else the folder named in ~/.config/keito/config.json, else ./boards. */
export function boardsRoot(fallback = path.resolve('boards')): string {
  if (process.env.KEITO_BOARDS) return path.resolve(process.env.KEITO_BOARDS);
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'keito', 'config.json'), 'utf8'));
    if (typeof conf?.boards === 'string' && conf.boards) return path.resolve(conf.boards.replace(/^~(?=$|\/)/, os.homedir()));
  } catch {
    // No config: the default folder.
  }
  return fallback;
}

export const slug = (title: string): string => title.replace(/[\\/:*?"<>|\s.]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'board';

export class Conflict extends Error {
  constructor(readonly serial: number) {
    super(`ボードはほかの場所で更新されています（版番号 ${serial}）`);
  }
}

/** A board written on a version read earlier, though it has been deleted since. */
export class Gone extends Error {
  constructor() {
    super('ボードはほかの場所で削除されています');
  }
}

/** A deleted board, lying in .trash until it is put back. */
export interface TrashedFile {
  /** Its folder's name under .trash (the board's folder, with the time it was deleted). */
  key: string;
  id: string;
  title: string;
  project?: string;
  kind?: string;
  /** When it was deleted (ms). */
  deleted: number;
}

/** Deleted boards' folders are moved here, and back from here when restored. */
const TRASH = '.trash';

export interface BoardFile {
  id: string;
  title: string;
  project?: string;
  kind?: string;
  updated: number;
  serial: number;
  folder: string;
}

// The board.json shape this module needs; the rest passes through untouched.
interface Stored {
  id: string;
  nodes: unknown[];
  meta?: { title?: string };
  serial?: number;
  [k: string]: unknown;
}

export function store(root: string) {
  const dirs = (): string[] => (fs.existsSync(root) ? fs.readdirSync(root).filter((d) => !d.startsWith('.') && fs.existsSync(path.join(root, d, 'board.json'))) : []);
  const dirOf = (id: string): string | null => {
    const hit = dirs().find((d) => d === id || d.endsWith(`__${id}`));
    return hit ? path.join(root, hit) : null;
  };
  const readAt = (dir: string): Stored => JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'));
  const serialAt = (dir: string | null): number => {
    if (!dir) return 0;
    try {
      return Number(readAt(dir).serial) || 0;
    } catch {
      return 0;
    }
  };

  return {
    root,
    dirOf,
    serialAt,

    /** Every readable board; one that cannot be read is skipped with a warning, not fatal to the rest. */
    list(): BoardFile[] {
      return dirs()
        .flatMap((d) => {
          const file = path.join(root, d, 'board.json');
          try {
            const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (typeof doc?.id !== 'string') throw new Error('no id');
            return [{ id: doc.id as string, title: (doc.meta?.title as string) ?? d, project: (doc.meta?.project as string) || undefined, kind: (doc.kind as string) || undefined, updated: fs.statSync(file).mtimeMs, serial: Number(doc.serial) || 0, folder: d }];
          } catch (e) {
            console.warn(`[keito] skipped ${path.join(d, 'board.json')}: ${e instanceof Error ? e.message : e}`);
            return [];
          }
        })
        .sort((a, b) => b.updated - a.updated);
    },

    read(id: string): Stored | null {
      const dir = dirOf(id);
      return dir ? readAt(dir) : null;
    },

    /**
     * Write a board, made on version `base` of it (undefined: whatever is there, for a forced
     * write). Returns the new serial; throws Conflict when the board moved on meanwhile.
     */
    write(doc: Stored, base: number | undefined): { serial: number; folder: string } {
      const dir = dirOf(doc.id);
      const now = serialAt(dir);
      // Made on a version read earlier, of a board deleted since: never brought back unasked.
      if (base !== undefined && !dir) throw new Gone();
      if (base !== undefined && dir && base !== now) throw new Conflict(now);
      const wanted = path.join(root, `${slug(String(doc.meta?.title ?? ''))}__${doc.id}`);
      let target = dir ?? wanted;
      fs.mkdirSync(target, { recursive: true });
      // Follow a renamed board with its folder; keep the old name if the new one is taken.
      if (target !== wanted && !fs.existsSync(wanted)) {
        fs.renameSync(target, wanted);
        target = wanted;
      }
      const serial = now + 1;
      const tmp = path.join(target, 'board.json.tmp');
      fs.writeFileSync(tmp, JSON.stringify({ ...doc, serial }, null, 2));
      fs.renameSync(tmp, path.join(target, 'board.json'));
      return { serial, folder: path.basename(target) };
    },

    /** A state from a board's history (revisions/<id>.json). */
    readState(id: string, state: string): Stored | null {
      const dir = dirOf(id);
      const file = dir && path.join(dir, 'revisions', `${path.basename(state)}.json`);
      return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    },

    writeState(id: string, state: string, doc: unknown): void {
      const dir = dirOf(id);
      if (!dir || !ID.test(state)) return;
      fs.mkdirSync(path.join(dir, 'revisions'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'revisions', `${state}.json`), JSON.stringify(doc, null, 2));
    },

    removeState(id: string, state: string): void {
      const dir = dirOf(id);
      const file = dir && path.join(dir, 'revisions', `${path.basename(state)}.json`);
      if (file && fs.existsSync(file)) fs.rmSync(file);
    },

    /** Deleting moves the folder aside instead of destroying it. */
    remove(id: string): void {
      const dir = dirOf(id);
      if (!dir) return;
      const trash = path.join(root, TRASH);
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(dir, path.join(trash, `${path.basename(dir)}-${Date.now()}`));
    },

    /** Deleted boards, the most recently deleted first; a folder that cannot be read is left out. */
    trashed(): TrashedFile[] {
      const trash = path.join(root, TRASH);
      if (!fs.existsSync(trash)) return [];
      return fs
        .readdirSync(trash)
        .flatMap((key): TrashedFile[] => {
          try {
            const doc = JSON.parse(fs.readFileSync(path.join(trash, key, 'board.json'), 'utf8'));
            if (typeof doc?.id !== 'string') return [];
            // The folder's name ends with the time it was deleted; failing that, when it was moved.
            const deleted = Number(/-(\d{10,})$/.exec(key)?.[1]) || fs.statSync(path.join(trash, key)).mtimeMs;
            return [{ key, id: doc.id, title: (doc.meta?.title as string) || '無題のボード', project: (doc.meta?.project as string) || undefined, kind: (doc.kind as string) || undefined, deleted }];
          } catch {
            return [];
          }
        })
        .sort((a, b) => b.deleted - a.deleted);
    },

    /**
     * Put a deleted board back where it was, and say its id. A board of the same id that is there
     * now (one restored before, say) is never overwritten: that throws instead.
     */
    restore(key: string): string {
      if (key !== path.basename(key) || key.startsWith('.')) throw new Error('bad key');
      const from = path.join(root, TRASH, key);
      if (!fs.existsSync(path.join(from, 'board.json'))) throw new Error('削除したボードが見つかりません');
      const doc = JSON.parse(fs.readFileSync(path.join(from, 'board.json'), 'utf8'));
      if (typeof doc?.id !== 'string' || !ID.test(doc.id)) throw new Error('not a board');
      if (dirOf(doc.id)) throw new Error('同じボードがすでにあります');
      const to = path.join(root, `${slug(String(doc.meta?.title ?? ''))}__${doc.id}`);
      if (fs.existsSync(to)) throw new Error('同じ名前のフォルダーがすでにあります');
      fs.renameSync(from, to);
      return doc.id;
    },
  };
}

export type Store = ReturnType<typeof store>;
