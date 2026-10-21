import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Busy, LOCK, locked, store } from '../server/store';

let root = '';
beforeEach(() => void (root = fs.mkdtempSync(path.join(os.tmpdir(), 'keito-lock-'))));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const run = (who: string, count: number) =>
  new Promise<number>((done) => {
    const child = spawn('npx', ['tsx', path.join(__dirname, 'fixtures', 'lock-worker.ts'), root, who, String(count)], { stdio: 'inherit' });
    child.on('exit', (code) => done(code ?? 1));
  });

describe('the boards folder lock', () => {
  it('waits for a writer holding it, and gives up after a while', () => {
    fs.writeFileSync(path.join(root, LOCK), '');
    expect(() => locked(root, () => 1, 60)).toThrow(Busy);
    expect(fs.existsSync(path.join(root, LOCK))).toBe(true);
  });

  it('takes over a lock left behind by a writer that died', () => {
    const file = path.join(root, LOCK);
    fs.writeFileSync(file, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(file, old, old);
    expect(locked(root, () => 'done', 60)).toBe('done');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('loses no change when several processes write one board at once', async () => {
    store(root).write({ version: 1, id: 'shared1', meta: { title: '共有' }, nodes: [], edges: [] }, undefined);
    const codes = await Promise.all(['a', 'b', 'c', 'd'].map((who) => run(who, 15)));
    expect(codes).toEqual([0, 0, 0, 0]);
    const doc = store(root).read('shared1')!;
    expect(doc.nodes).toHaveLength(60);
    expect(doc.serial).toBe(61);
    // Nothing left behind: no lock, no half-written file.
    expect(fs.readdirSync(root).filter((f) => f.startsWith('.'))).toEqual([]);
    expect(fs.readdirSync(store(root).dirOf('shared1')!).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  }, 60_000);
});
