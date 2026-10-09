import fs from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

/**
 * Board storage on disk, served by the dev / preview server:
 *
 *   boards/<title>__<id>/board.json
 *   boards/<title>__<id>/assets/<hash>.<ext>
 *   boards/<title>__<id>/revisions/<revision id>.json
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
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET = /^[A-Za-z0-9_-]{1,80}\.(png|jpe?g|gif|webp|svg)$/;

const slug = (title: string): string => title.replace(/[\\/:*?"<>|\s.]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'board';

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

export function keitoBoards(root = process.env.KEITO_BOARDS ?? path.resolve('boards')): Plugin {
  const dirs = (): string[] => (fs.existsSync(root) ? fs.readdirSync(root).filter((d) => !d.startsWith('.') && fs.existsSync(path.join(root, d, 'board.json'))) : []);
  const dirOf = (id: string): string | null => {
    const hit = dirs().find((d) => d === id || d.endsWith(`__${id}`));
    return hit ? path.join(root, hit) : null;
  };

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
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
        const list = dirs().map((d) => {
          const file = path.join(root, d, 'board.json');
          const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
          return { id: doc.id as string, title: (doc.meta?.title as string) ?? d, updated: fs.statSync(file).mtimeMs };
        });
        return send(200, list.sort((a, b) => b.updated - a.updated));
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
          return res.end(fs.readFileSync(file));
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
        const text = (await readBody(req)).toString('utf8');
        const doc = JSON.parse(text);
        if (doc.id !== id || !Array.isArray(doc.nodes)) return send(400, { error: 'not a board' });
        const wanted = path.join(root, `${slug(String(doc.meta?.title ?? ''))}__${id}`);
        let target = dir ?? wanted;
        fs.mkdirSync(target, { recursive: true });
        // Follow a renamed board with its folder; keep the old name if the new one is taken.
        if (target !== wanted && !fs.existsSync(wanted)) {
          fs.renameSync(target, wanted);
          target = wanted;
        }
        const tmp = path.join(target, 'board.json.tmp');
        fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
        fs.renameSync(tmp, path.join(target, 'board.json'));
        return send(200, { updated: Date.now(), folder: path.basename(target) });
      }
      if (req.method === 'DELETE') {
        if (!dir) return send(204);
        // Deleting moves the folder aside instead of destroying it.
        const trash = path.join(root, '.trash');
        fs.mkdirSync(trash, { recursive: true });
        fs.renameSync(dir, path.join(trash, `${path.basename(dir)}-${Date.now()}`));
        return send(204);
      }
      return send(405);
    } catch (e) {
      return send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
    name: 'keito-boards',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
