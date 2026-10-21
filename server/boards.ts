import fs from 'node:fs';
import path from 'node:path';
import type { Server, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { Busy, Conflict, Gone, ID, SERVER_FILE, boardsRoot, store } from './store';

/**
 * Board storage on disk, served by the dev / preview server:
 *
 *   boards/<title>__<id>/board.json
 *   boards/<title>__<id>/assets/<hash>.<ext>
 *   boards/<title>__<id>/revisions/<revision id>.json
 *   boards/presets.json            (the user's own device presets)
 *
 * The folder is named after the board's title so it reads well in Finder and
 * in git; the id after the double underscore is what URLs and the API use, so
 * renaming a board never breaks a link. KEITO_BOARDS overrides the location.
 */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const MAX_BODY = 64 * 1024 * 1024;
const ASSET = /^[A-Za-z0-9_-]{1,80}\.(png|jpe?g|gif|webp|svg)$/;

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new Error('too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function keitoBoards(root = boardsRoot()): Plugin {
  const boards = store(root);
  const dirOf = boards.dirOf;

  // Pages that want to hear when a board changes on disk (a command-line write, an edit by hand).
  const listeners = new Set<ServerResponse>();
  // The serial this server last wrote for each board: its own writes are not news to anyone.
  // Which page wrote each board last through this server, and at which serial: the news of a write
  // says who made it, so that page alone knows it for its own and every other page hears of it.
  const ours = new Map<string, { serial: number; writer: string }>();
  const announce = (id: string, serial: number, writer?: string) => {
    const msg = `data: ${JSON.stringify({ id, serial, ...(writer ? { writer } : {}) })}\n\n`;
    for (const res of listeners) res.write(msg);
  };
  const pending = new Map<string, NodeJS.Timeout>();
  const watch = () => {
    fs.mkdirSync(root, { recursive: true });
    try {
      fs.watch(root, { recursive: true }, (_event, file) => {
        const name = String(file ?? '');
        if (!name.endsWith('board.json')) return;
        const folder = name.split(/[\\/]/)[0];
        // A write lands as several events: look once things have settled.
        clearTimeout(pending.get(folder));
        pending.set(
          folder,
          setTimeout(() => {
            pending.delete(folder);
            try {
              const doc = JSON.parse(fs.readFileSync(path.join(root, folder, 'board.json'), 'utf8'));
              const serial = Number(doc.serial) || 0;
              if (typeof doc.id !== 'string') return;
              const by = ours.get(doc.id);
              announce(doc.id, serial, by?.serial === serial ? by.writer : undefined);
            } catch {
              // Mid-write or gone: the next event will tell.
            }
          }, 120),
        );
      });
    } catch (e) {
      console.warn(`[keito] not watching ${root}: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handle = async (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let parts: string[];
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      // A broken escape such as "/%" is not ours to judge unless it is aimed at the API.
      if (!url.pathname.startsWith('/api/')) return next();
      res.statusCode = 400;
      return void res.end();
    }
    // The user's own device presets, shared by every board: boards/presets.json.
    if (parts[0] === 'api' && parts[1] === 'presets' && parts.length === 2) {
      const file = path.join(root, 'presets.json');
      try {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          return void res.end(fs.existsSync(file) ? fs.readFileSync(file) : '[]');
        }
        if (req.method === 'PUT') {
          const list = JSON.parse((await readBody(req)).toString('utf8'));
          if (!Array.isArray(list)) throw new Error('not a list');
          boards.writePresets(JSON.stringify(list, null, 2));
          res.statusCode = 204;
          return void res.end();
        }
        res.statusCode = 405;
        return void res.end();
      } catch (e) {
        res.statusCode = 500;
        return void res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    }
    // Changes to boards on disk, as server-sent events: {"id", "serial"} per board written elsewhere.
    if (parts[0] === 'api' && parts[1] === 'events' && parts.length === 2) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': keito\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    // Deleted boards: GET lists them, POST /api/trash/<key> puts one back and answers its id.
    if (parts[0] === 'api' && parts[1] === 'trash' && parts.length <= 3) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (parts.length === 2 && req.method === 'GET') return void res.end(JSON.stringify(boards.trashed()));
        if (parts.length === 3 && req.method === 'POST') return void res.end(JSON.stringify({ id: boards.restore(parts[2]) }));
        res.statusCode = 405;
        return void res.end();
      } catch (e) {
        res.statusCode = 409;
        return void res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    }
    if (parts[0] !== 'api' || parts[1] !== 'boards') return next();
    const send = (status: number, body?: unknown, type = 'application/json') => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.end(body === undefined ? '' : Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      const [, , id, sub, name] = parts;
      if (!id) {
        if (req.method !== 'GET') return send(405);
        // One unreadable board (a merge conflict, a bad hand edit) must not hide all the others:
        // failing the whole list would send the app quietly off to browser storage.
        return send(200, boards.list().map(({ id, title, updated, project, kind }) => ({ id, title, updated, project, kind })));
      }
      if (!ID.test(id)) return send(400, { error: 'bad id' });
      const dir = dirOf(id);

      if (sub === 'assets') {
        if (!name || !ASSET.test(name)) return send(400, { error: 'bad asset name' });
        if (req.method === 'GET') {
          const file = dir && path.join(dir, 'assets', name);
          if (!file || !fs.existsSync(file)) return send(404);
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream');
          // Asset names are content hashes, so a given URL never changes.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return void res.end(fs.readFileSync(file));
        }
        if (req.method === 'PUT') {
          if (!dir) return send(404, { error: 'save the board first' });
          fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
          fs.writeFileSync(path.join(dir, 'assets', name), await readBody(req));
          return send(204);
        }
        return send(405);
      }
      if (sub === 'revisions') {
        // Snapshots of the board as it stood at each recorded revision.
        if (!name || !ID.test(name)) return send(400, { error: 'bad revision id' });
        const file = dir && path.join(dir, 'revisions', `${name}.json`);
        if (req.method === 'GET') {
          if (!file || !fs.existsSync(file)) return send(404);
          return send(200, fs.readFileSync(file), 'application/json');
        }
        if (req.method === 'PUT') {
          if (!dir || !file) return send(404, { error: 'save the board first' });
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(JSON.parse((await readBody(req)).toString('utf8')), null, 2));
          return send(204);
        }
        if (req.method === 'DELETE') {
          if (file && fs.existsSync(file)) fs.rmSync(file);
          return send(204);
        }
        return send(405);
      }
      if (sub) return send(404);

      if (req.method === 'GET') {
        if (!dir) return send(404);
        return send(200, fs.readFileSync(path.join(dir, 'board.json')), 'application/json');
      }
      if (req.method === 'PUT') {
        const doc = JSON.parse((await readBody(req)).toString('utf8'));
        if (doc.id !== id || !Array.isArray(doc.nodes)) return send(400, { error: 'not a board' });
        // The serial the page's change was made on; a page that sends none writes regardless
        // (and so does one asked to overwrite: "If-Match: *").
        const match = req.headers['if-match'];
        const base = match === undefined || match === '*' ? undefined : Number(match);
        try {
          const done = boards.write(doc, Number.isFinite(base) ? base : undefined);
          ours.set(id, { serial: done.serial, writer: String(req.headers['x-keito-writer'] ?? '') });
          return send(200, { updated: Date.now(), ...done });
        } catch (e) {
          if (e instanceof Conflict) return send(409, { error: e.message, serial: e.serial });
          if (e instanceof Gone) return send(410, { error: e.message });
          if (e instanceof Busy) return send(503, { error: e.message });
          throw e;
        }
      }
      if (req.method === 'DELETE') {
        boards.remove(id);
        return send(204);
      }
      return send(405);
    } catch (e) {
      return send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
  // Connect never awaits a handler: anything thrown outside the try blocks above must still be
  // answered here, or it becomes an unhandled rejection that takes the whole server down.
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    handle(req, res, next).catch((e: unknown) => {
      if (res.headersSent) return void res.end();
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    });
  };

  // Say where this server listens, in the folder it serves, for `keito url`; unsaid when it stops.
  const sayWhere = (http: Server | null) => {
    const file = path.join(root, SERVER_FILE);
    http?.once('listening', () => {
      const at = http.address();
      if (!at || typeof at === 'string') return;
      const host = at.address === '::1' ? '[::1]' : 'localhost';
      try {
        fs.writeFileSync(file, JSON.stringify({ url: `http://${host}:${at.port}/`, pid: process.pid }));
      } catch (e) {
        console.warn(`[keito] could not write ${file}: ${e instanceof Error ? e.message : e}`);
      }
    });
    const unsay = () => {
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.rmSync(file);
      } catch {
        // Not ours, or gone already.
      }
    };
    http?.once('close', unsay);
    process.once('exit', unsay);
  };

  return {
    name: 'keito-boards',
    configureServer(server) {
      watch();
      sayWhere(server.httpServer);
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      watch();
      sayWhere(server.httpServer as Server | null);
      server.middlewares.use(handler);
    },
  };
}
