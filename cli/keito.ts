#!/usr/bin/env -S npx tsx
/**
 * keito on the command line: read a board as YAML, write YAML back to it, read its lists, write
 * its workbook. It works on the boards folder itself, so the app need not be running; a page that
 * has the board open picks the change up at once (through the dev server's watch on the folder).
 *
 * Meant for people and for agents alike: `keito guide` prints the YAML format, `keito show` a
 * board in it, and `keito apply` takes a whole board or a changed copy back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Conflict, SERVER_FILE, boardsRoot, store } from '../server/store';
import { DSL_GUIDE, fromYaml, toYaml } from '../src/model/dsl';
import { catalog, pull, stamp } from '../src/model/shared';
import { fitLegends } from '../src/model/legend';
import { TABLES, type Table, checkTable, toCsv } from '../src/model/lists';
import { safeName } from '../src/model/names';
import { drawingOf, entryFor, fingerprint, labelOf, thin } from '../src/model/history';
import { kindOf } from '../src/model/kinds';
import { boardKind, readBoard, readSerial } from '../src/model/load';
import { randomId } from '../src/model/presets';
import { registerSignals } from '../src/model/signals';
import { type Doc, type Revision, emptyMeta } from '../src/model/types';
import { updateWorkbook, workbook } from '../src/export/xlsx';

const HELP = `keito — 系統図ボードをコマンドラインから読み書きする

使い方: keito <コマンド> [引数] [--dir <ボードのフォルダ>]

  boards                         ボードの一覧（id・タイトル・更新日時）
  show <ボード> [--json]          ボードを YAML（--json で JSON）で表示
  apply <ボード> [ファイル|-]      YAML をボードに反映（- または省略で標準入力）。--relayout で位置を捨てて自動配置
  new <タイトル> [ファイル|-] [--kind 種類] [--project 案件名]
                                 YAML から新しいボードを作る（YAML なしで空のボード）。種類: system / software / sequence / free
  lists <ボード> [表] [--csv|--json]
                                 表を表示。表: equipment / cables / summary / power / network / comms（通信一覧）/ check
                                 （既定はボードの種類の最初の表）
  check <ボード>                  チェック表。要修正があれば終了コード 1
  xlsx <ボード> [-o ファイル] [--update 前回.xlsx]
                                 Excel に書き出す。--update で前回のファイルを図の内容に更新（購入ステータスなどは引き継ぐ）
  history <ボード>                履歴の一覧（番号・日時か名前・変わったところ）
  restore <ボード> <番号|名前>     履歴のその時点に戻す（戻す前の状態も履歴に残る）
  name <ボード> <名前>            今の状態に名前を付けて履歴に残す（自動で消えなくなる）
  url <ボード>                    画面で開く URL（このフォルダを開いている開発サーバーのもの）
  guide                          YAML の書式（AI に渡す用）

<ボード> は id、フォルダ名、またはタイトルの一部。
ボードのフォルダ: --dir、環境変数 KEITO_BOARDS、~/.config/keito/config.json の "boards"、keito の boards/ の順に探します。
書き込む前には毎回、元の状態を履歴に残します（画面の「履歴」にも出ます）。`;

const here = path.dirname(fileURLToPath(import.meta.url));

// Output cut short by the reader (`keito history | head`) is no error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

/** The address of a dev / preview server serving this boards folder, if one is running. */
async function serverUrl(): Promise<string | null> {
  try {
    const { url } = JSON.parse(fs.readFileSync(path.join(boards.root, SERVER_FILE), 'utf8'));
    const res = await fetch(new URL('api/boards', url), { signal: AbortSignal.timeout(1500) });
    return res.ok ? String(url) : null;
  } catch {
    return null;
  }
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`keito: ${msg}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
const flag = (name: string): boolean => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const option = (...names: string[]): string | undefined => {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i >= 0) {
      const v = args[i + 1];
      if (v === undefined) fail(`${name} の値がありません`);
      args.splice(i, 2);
      return v;
    }
  }
  return undefined;
};

const dir = option('--dir');
const boards = store(dir ? path.resolve(dir) : boardsRoot(path.resolve(here, '..', 'boards')));

/** A board by id, folder name, or a piece of its title; more than one match is an error that lists them. */
function find(query: string | undefined) {
  if (!query) fail('ボードを指定してください（keito boards で一覧）');
  const all = boards.list();
  const exact = all.find((b) => b.id === query || b.folder === query);
  if (exact) return exact;
  const q = query.toLowerCase();
  const hits = all.filter((b) => b.title.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) fail(`「${query}」に当たるボードがありません（keito boards で一覧）`);
  fail(`「${query}」に当たるボードが複数あります: ${hits.map((b) => `${b.id}（${b.title}）`).join('、')}`);
}

function load(query: string | undefined): { doc: Doc; serial: number } {
  const info = find(query);
  const raw = boards.read(info.id);
  const doc = readBoard(raw);
  if (!doc) fail(`${info.folder}/board.json は keito のボードとして読めません`);
  registerSignals(doc.signals);
  return { doc, serial: readSerial(raw?.serial) };
}

/** YAML from a file, or from standard input (a pipe from `keito show`, an agent's heredoc …). */
async function input(file: string | undefined): Promise<string> {
  if (file && file !== '-') return fs.readFileSync(path.resolve(file), 'utf8');
  if (process.stdin.isTTY) fail('YAML をファイルで渡すか、標準入力から流してください');
  // Read as a stream: a pipe is not always ready to be read in one go.
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Write a changed board. The board as it was goes into its history first (unless the history
 * already ends with it), so the change can always be undone; a board changed meanwhile is left alone.
 */
function save(before: Doc, next: Doc, serial: number, extra: Partial<Revision> = { source: 'cli' }): number {
  let history = before.revisions ?? [];
  let drop: string[] = [];
  if (history.at(-1)?.hash !== fingerprint(before)) {
    const entry = entryFor(before, null, randomId(), { ...extra, summary: undefined });
    boards.writeState(before.id, entry.id, drawingOf(before));
    ({ keep: history, drop } = thin([...history, entry]));
  }
  const done = commit({ ...next, revisions: history }, serial);
  // Drawings thinned out go only once the board no longer lists them: a refused write keeps them all.
  for (const id of drop) boards.removeState(before.id, id);
  process.stderr.write(`保存しました: ${done.folder}（版番号 ${done.serial}）。元の状態は履歴に残っています（keito history）\n`);
  return done.serial;
}

/** The other boards of a board's project, as stored. */
function projectBoards(doc: Doc): Doc[] {
  const project = doc.meta.project?.trim();
  if (!project) return [];
  return boards
    .list()
    .filter((info) => info.id !== doc.id && (info.project ?? '').trim() === project)
    .map((info) => readBoard(boards.read(info.id)))
    .filter((d): d is Doc => !!d);
}

/** Write the shared things of a board through to the other boards of its project (as the app does). */
function shareOut(doc: Doc): void {
  const project = doc.meta.project?.trim();
  if (!project) return;
  const mine = catalog([doc]);
  for (const info of boards.list()) {
    if (info.id === doc.id || (info.project ?? '').trim() !== project) continue;
    const raw = boards.read(info.id);
    const other = readBoard(raw);
    if (!other) continue;
    const next = pull(other, mine);
    if (next === other) continue;
    try {
      boards.write(next as never, readSerial(raw?.serial));
      process.stderr.write(`共有している項目を「${other.meta.title}」にも反映しました\n`);
    } catch (e) {
      process.stderr.write(`「${other.meta.title}」には反映できませんでした（開いたときに取り込まれます）: ${e instanceof Error ? e.message : e}\n`);
    }
  }
}

/** Write the board on the version read; a board changed meanwhile is left alone, and says so. */
function commit(doc: Doc, serial: number): { serial: number; folder: string } {
  try {
    return boards.write(doc as never, serial);
  } catch (e) {
    if (e instanceof Conflict) fail(`${e.message}。もう一度 show してからやり直してください`);
    throw e;
  }
}

/** A state in a board's history by its number in `keito history` (1 = newest), id or name. */
function stateOf(doc: Doc, key: string | undefined): Revision {
  if (!key) fail('履歴の番号か名前を指定してください（keito history で一覧）');
  const list = [...(doc.revisions ?? [])].reverse();
  const hit = /^\d+$/.test(key) ? list[Number(key) - 1] : (list.find((r) => r.id === key) ?? list.find((r) => r.name === key) ?? list.find((r) => r.name?.includes(key)));
  if (!hit) fail(`履歴に「${key}」がありません（keito history で一覧）`);
  return hit;
}

/** A file's bytes as an ArrayBuffer of their own (a Buffer may sit in a larger shared one). */
function bytes(file: string): ArrayBuffer {
  const b = fs.readFileSync(path.resolve(file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const LISTS: Record<string, (doc: Doc) => Table> = Object.fromEntries(Object.entries(TABLES).map(([k, t]) => [k, t.make]));

/** A list as plain text: columns padded to line up (full-width characters count double). */
function text(t: Table): string {
  const width = (s: string): number => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  const keep = t.head.map((_, j) => j === 0 || t.rows.some((r) => r[j]?.trim()));
  const rows = [t.head, ...t.rows].map((r) => r.filter((_, j) => keep[j]));
  const widths = rows[0].map((_, j) => Math.max(...rows.map((r) => width(r[j] ?? ''))));
  const line = (r: string[]) => r.map((c, j) => c + ' '.repeat(widths[j] - width(c))).join('  ').trimEnd();
  return [`# ${t.title}`, line(rows[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.slice(1).map(line)].join('\n') + (t.rows.length ? '' : `\n${t.empty ?? '（なし）'}`);
}

async function main(): Promise<void> {
  const cmd = args.shift();
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return void console.log(HELP);

    case 'guide':
      return void console.log(DSL_GUIDE);

    case 'boards': {
      const all = boards.list();
      if (!all.length) return void console.log(`（ボードはありません: ${boards.root}）`);
      const KIND_LABEL: Record<string, string> = { software: 'ソフトウェア構成図', sequence: 'シーケンス図', free: '自由ボード' };
      for (const b of all) console.log(`${b.id}\t${b.project ?? '（案件なし）'}\t${KIND_LABEL[boardKind(b.kind) ?? ''] ?? 'システム図'}\t${b.title}\t${new Date(b.updated).toLocaleString('ja-JP')}`);
      return;
    }

    case 'show': {
      const json = flag('--json');
      // As the app shows it: shared things as the project has them now.
      const { doc: kept } = load(args[0]);
      const doc = pull(kept, catalog(projectBoards(kept)));
      return void process.stdout.write(json ? `${JSON.stringify(doc, null, 2)}\n` : toYaml(doc));
    }

    case 'apply': {
      const relayout = flag('--relayout');
      const { doc, serial } = load(args[0]);
      // Shared things as the project has them now, as the app takes them in on opening: the edit
      // goes on top of those, so a value only this board still had stale is not pushed back out.
      const current = pull(doc, catalog(projectBoards(doc)));
      let next: Doc;
      try {
        next = fitLegends(fromYaml(await input(args[1]), current, relayout));
      } catch (e) {
        fail(`YAML を反映できませんでした: ${e instanceof Error ? e.message : e}`);
      }
      // Shared things edited in the YAML are the newest of them now, and go to the project's other boards.
      next = stamp(current, next, Date.now());
      save(doc, next, serial);
      shareOut(next);
      return;
    }

    case 'new': {
      const kindArg = option('--kind');
      const projectArg = option('--project');
      const title = args[0];
      if (!title) fail('タイトルを指定してください');
      if (kindArg && !['system', 'software', 'sequence', 'free'].includes(kindArg)) fail('種類は system / software / sequence / free のどれかです');
      const blank: Doc = { version: 1, id: randomId(), kind: kindArg && kindArg !== 'system' ? (kindArg as Doc['kind']) : undefined, meta: { ...emptyMeta(title), project: projectArg ?? '' }, nodes: [], edges: [] };
      const src = args[1] !== undefined || !process.stdin.isTTY ? await input(args[1]) : '';
      let doc = blank;
      if (src.trim()) {
        try {
          doc = fitLegends(fromYaml(src, blank));
        } catch (e) {
          fail(`YAML を読めませんでした: ${e instanceof Error ? e.message : e}`);
        }
      }
      // The title (and the kind and project) asked for win over those in the YAML.
      doc = { ...doc, kind: kindArg ? blank.kind : doc.kind, meta: { ...doc.meta, title, ...(projectArg !== undefined ? { project: projectArg } : {}) } };
      // Shared things take what the project's other boards have, and give them what only they have.
      doc = pull(doc, catalog(projectBoards(doc)));
      const done = boards.write(doc as never, undefined);
      process.stderr.write(`作成しました: ${done.folder}\n`);
      shareOut(doc);
      return void console.log(doc.id);
    }

    case 'lists': {
      const csv = flag('--csv');
      const json = flag('--json');
      const { doc } = load(args[0]);
      const make = LISTS[args[1] ?? kindOf(doc).lists[0] ?? 'check'];
      if (!make) fail(`表は ${Object.keys(LISTS).join(' / ')} のどれかです`);
      const t = make(doc);
      if (json) return void console.log(JSON.stringify({ title: t.title, head: t.head, rows: t.rows }, null, 2));
      return void process.stdout.write(csv ? toCsv(t).replace(/^﻿/, '') : `${text(t)}\n`);
    }

    case 'check': {
      const { doc } = load(args[0]);
      const t = checkTable(doc);
      console.log(text(t));
      if (t.rows.some((r) => r[0] === '要修正')) process.exitCode = 1;
      return;
    }

    case 'xlsx': {
      const out = option('-o', '--out');
      const previous = option('--update');
      const { doc } = load(args[0]);
      if (!kindOf(doc).lists.length) fail(`${kindOf(doc).label}には表がないので、Excel には書き出せません`);
      if (previous) {
        const { blob, report } = await updateWorkbook(doc, bytes(previous));
        const file = path.resolve(out ?? previous);
        // Written over the previous file: it is kept beside it first, should the update be unwanted.
        const backup = file === path.resolve(previous) ? `${file.replace(/\.xlsx$/i, '')}.bak.xlsx` : null;
        if (backup) fs.copyFileSync(file, backup);
        fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
        const kept = [report.extra.length && `引き継いだ列: ${report.extra.join('・')}`, report.manual && `手入力の行 ${report.manual}`, report.sheets.length && `残したシート: ${report.sheets.join('・')}`, report.renamed.length && `名前を変えたシート: ${report.renamed.join('・')}`].filter(Boolean);
        return void console.log(`更新しました: ${file}（追加 ${report.added}・変更 ${report.changed}・削除 ${report.removed} 行${kept.length ? `、${kept.join('、')}` : ''}）${backup ? `\n元のファイルは ${backup} に残しました` : ''}`);
      }
      const file = path.resolve(out ?? `${safeName(doc.meta.title)}_${kindOf(doc).listsLabel}.xlsx`);
      fs.writeFileSync(file, Buffer.from(await (await workbook(doc)).arrayBuffer()));
      return void console.log(`書き出しました: ${file}`);
    }

    case 'history': {
      const { doc } = load(args[0]);
      const list = [...(doc.revisions ?? [])].reverse();
      if (!list.length) return void console.log('（履歴はまだありません）');
      const when = (r: Revision) => (r.at ? new Date(r.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
      const what = (r: Revision) => (r.source === 'cli' ? 'CLI で変更する前' : r.source === 'restore' ? '戻す前' : (r.summary ?? ''));
      list.forEach((r, i) => console.log(`${i + 1}\t${r.name ? `★ ${r.name}（${when(r)}）` : when(r)}\t${what(r)}`));
      return;
    }

    case 'restore': {
      const { doc, serial } = load(args[0]);
      const entry = stateOf(doc, args[1]);
      const old = readBoard(boards.readState(doc.id, entry.id));
      if (!old) fail(`「${labelOf(entry)}」の図が見つかりません`);
      save(doc, { ...old, id: doc.id }, serial, { source: 'restore' });
      return void console.log(`「${labelOf(entry)}」に戻しました`);
    }

    case 'name': {
      const { doc, serial } = load(args[0]);
      const name = args.slice(1).join(' ').trim();
      if (!name) fail('名前を指定してください');
      const last = doc.revisions?.at(-1);
      // The state already in the history takes the name; otherwise the board as it is goes in.
      let history: Revision[];
      if (last && last.hash === fingerprint(doc)) history = doc.revisions!.map((r) => (r.id === last.id ? { ...r, name } : r));
      else {
        const entry = entryFor(doc, null, randomId(), { name, summary: undefined });
        boards.writeState(doc.id, entry.id, drawingOf(doc));
        history = [...(doc.revisions ?? []), entry];
      }
      commit({ ...doc, revisions: history }, serial);
      return void console.log(`「${name}」として残しました`);
    }

    case 'url': {
      const info = find(args[0]);
      const at = await serverUrl();
      if (!at) fail(`このフォルダを開いている開発サーバーがありません（npm run dev で起動します）。デスクトップアプリでは、ボード一覧から「${info.title}」を開いてください`, 1);
      return void console.log(`${at}#/b/${info.id}`);
    }

    default:
      fail(`知らないコマンドです: ${cmd}（keito help）`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e), 1));
