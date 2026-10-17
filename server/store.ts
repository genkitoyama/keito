import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The boards folder, read and written the same way by the dev server and the command line (and,
 * later, the native app). The folder is the one truth about a board:
 *
 *   <root>/<title>__<id>/board.json
 *   <root>/<title>__<id>/assets/<hash>.<ext>
 *   <root>/<title>__<id>/revisions/<revision id>.json
 *   <root>/<title>__<id>/backups/<time>.json   (the board before each command-line write)
 *
 * Every write bumps `serial` in board.json. A writer says which serial its change was made on, and
 * a write made on an older one is refused, so two writers never silently undo each other.
 */

export const ID = /^[A-Za-z0-9_-]{1,64}$/;
const BACKUPS_KEPT = 30;

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

export interface BoardFile {
  id: string;
  title: string;
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
            return [{ id: doc.id as string, title: (doc.meta?.title as string) ?? d, updated: fs.statSync(file).mtimeMs, serial: Number(doc.serial) || 0, folder: d }];
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

    /** Keep the board as it stands before a command-line write; the oldest copies drop off. */
    backup(id: string, note: string): string | null {
      const dir = dirOf(id);
      if (!dir) return null;
      const folder = path.join(dir, 'backups');
      fs.mkdirSync(folder, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(path.join(folder, name), JSON.stringify({ note, board: readAt(dir) }, null, 2));
      const all = fs.readdirSync(folder).filter((f) => f.endsWith('.json')).sort();
      for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) fs.rmSync(path.join(folder, old));
      return name;
    },

    backups(id: string): { name: string; note: string }[] {
      const dir = dirOf(id);
      const folder = dir && path.join(dir, 'backups');
      if (!folder || !fs.existsSync(folder)) return [];
      return fs
        .readdirSync(folder)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .map((name) => {
          try {
            return { name, note: String(JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')).note ?? '') };
          } catch {
            return { name, note: '' };
          }
        });
    },

    readBackup(id: string, name: string): Stored | null {
      const dir = dirOf(id);
      const file = dir && path.join(dir, 'backups', path.basename(name));
      return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).board : null;
    },

    /** Deleting moves the folder aside instead of destroying it. */
    remove(id: string): void {
      const dir = dirOf(id);
      if (!dir) return;
      const trash = path.join(root, '.trash');
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(dir, path.join(trash, `${path.basename(dir)}-${Date.now()}`));
    },
  };
}

export type Store = ReturnType<typeof store>;
