import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeFile, store } from '../server/store';

let root = '';
beforeEach(() => void (root = fs.mkdtempSync(path.join(os.tmpdir(), 'keito-remove-'))));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const board = (id: string, title: string) => ({ version: 1, id, meta: { title, project: 'P' }, nodes: [], edges: [] });

// A board named in Japanese has a folder named so: taking a file away there must not bring the
// server down (Node 23.10's fs.rmSync crashes on such a path on Windows).
describe('taking files away from a board named in Japanese', () => {
  it('removes a kept state of the board', () => {
    const s = store(root);
    s.write(board('aaa111', '【サンプル】映像・センサー系統図'), undefined);
    expect(s.writeInto('aaa111', 'revisions', 'st1.json', '{}')).toBe(true);
    const file = path.join(s.dirOf('aaa111')!, 'revisions', 'st1.json');
    expect(fs.existsSync(file)).toBe(true);
    s.removeState('aaa111', 'st1');
    expect(fs.existsSync(file)).toBe(false);
    // Gone already: nothing to do.
    expect(() => s.removeState('aaa111', 'st1')).not.toThrow();
  });

  it('removes a file if it is there, and only then', () => {
    const dir = path.join(root, '配置図__bbb222');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, '{}');
    removeFile(file);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => removeFile(file)).not.toThrow();
    // A folder is not a file: said, not taken away.
    expect(() => removeFile(dir)).toThrow();
    expect(fs.existsSync(dir)).toBe(true);
  });
});
