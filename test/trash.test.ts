import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Gone, store } from '../server/store';

let root = '';
beforeEach(() => void (root = fs.mkdtempSync(path.join(os.tmpdir(), 'keito-trash-'))));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const board = (id: string, title: string) => ({ version: 1, id, meta: { title, project: 'P' }, nodes: [], edges: [] });

describe('deleted boards on disk', () => {
  it('lists a deleted board and puts it back', () => {
    const s = store(root);
    s.write(board('aaa111', '配置図'), undefined);
    s.remove('aaa111');
    expect(s.list()).toHaveLength(0);
    const [t] = s.trashed();
    expect(t).toMatchObject({ id: 'aaa111', title: '配置図', project: 'P' });
    expect(s.restore(t.key)).toBe('aaa111');
    expect(s.list().map((b) => b.id)).toEqual(['aaa111']);
    expect(s.trashed()).toHaveLength(0);
  });

  it('never overwrites a board that is there again', () => {
    const s = store(root);
    s.write(board('aaa111', '配置図'), undefined);
    s.remove('aaa111');
    s.write(board('aaa111', '配置図'), undefined);
    expect(() => s.restore(s.trashed()[0].key)).toThrow('同じボードがすでにあります');
  });

  it('refuses keys that point outside the trash', () => {
    const s = store(root);
    for (const key of ['../x', '.hidden', 'missing']) expect(() => s.restore(key)).toThrow();
  });
});

describe('writes made on an older version', () => {
  it('never bring back a board deleted meanwhile', () => {
    const s = store(root);
    const { serial } = s.write(board('aaa111', '配置図'), undefined);
    s.remove('aaa111');
    // A page that read version `serial` before the delete saves again.
    expect(() => s.write(board('aaa111', '配置図'), serial)).toThrow(Gone);
    expect(s.list()).toHaveLength(0);
    // Asked to (no version given), it is written anew.
    s.write(board('aaa111', '配置図'), undefined);
    expect(s.list()).toHaveLength(1);
  });
});
