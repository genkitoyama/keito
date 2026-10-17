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
import { Conflict, boardsRoot, store } from '../server/store';
import { DSL_GUIDE, fromYaml, toYaml } from '../src/model/dsl';
import { fitLegends } from '../src/model/legend';
import { type Table, cableSummaryTable, cableTable, checkTable, equipmentTable, networkTable, powerTable, toCsv } from '../src/model/lists';
import { readBoard } from '../src/model/load';
import { randomId } from '../src/model/presets';
import { registerSignals } from '../src/model/signals';
import { type Doc, emptyMeta } from '../src/model/types';
import { updateWorkbook, workbook } from '../src/export/xlsx';

const HELP = `keito — 系統図ボードをコマンドラインから読み書きする

使い方: keito <コマンド> [引数] [--dir <ボードのフォルダ>]

  boards                         ボードの一覧（id・タイトル・更新日時）
  show <ボード> [--json]          ボードを YAML（--json で JSON）で表示
  apply <ボード> [ファイル|-]      YAML をボードに反映（- または省略で標準入力）。--relayout で位置を捨てて自動配置
  new <タイトル> [ファイル|-]      YAML から新しいボードを作る（YAML なしで空のボード）
  lists <ボード> [表] [--csv|--json]
                                 表を表示。表: equipment / cables / summary / power / network / check（既定 equipment）
  check <ボード>                  チェック表。要修正があれば終了コード 1
  xlsx <ボード> [-o ファイル] [--update 前回.xlsx]
                                 Excel に書き出す。--update で前回のファイルを図の内容に更新（購入ステータスなどは引き継ぐ）
  backups <ボード>                CLI が書き込む前に残した控えの一覧
  restore <ボード> <控え>          控えの内容に戻す（戻す前の状態も控えに残る）
  url <ボード>                    画面で開く URL
  guide                          YAML の書式（AI に渡す用）

<ボード> は id、フォルダ名、またはタイトルの一部。
ボードのフォルダ: --dir、環境変数 KEITO_BOARDS、~/.config/keito/config.json の "boards"、keito の boards/ の順に探します。
書き込みの前には毎回、元の状態を <ボード>/backups/ に残します（30 件まで）。`;

const here = path.dirname(fileURLToPath(import.meta.url));

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
  return { doc, serial: Number(raw?.serial) || 0 };
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

/** Write a changed board, keeping it as it was first; a board changed meanwhile is left alone. */
function save(doc: Doc, serial: number, note: string): number {
  const kept = boards.backup(doc.id, note);
  try {
    const done = boards.write(doc as never, serial);
    process.stderr.write(`保存しました: ${done.folder}（版番号 ${done.serial}${kept ? `、控え ${kept}` : ''}）\n`);
    return done.serial;
  } catch (e) {
    if (e instanceof Conflict) fail(`${e.message}。もう一度 show してから反映してください`);
    throw e;
  }
}

/** A file's bytes as an ArrayBuffer of their own (a Buffer may sit in a larger shared one). */
function bytes(file: string): ArrayBuffer {
  const b = fs.readFileSync(path.resolve(file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const LISTS: Record<string, (doc: Doc) => Table> = {
  equipment: equipmentTable,
  cables: cableTable,
  summary: cableSummaryTable,
  power: powerTable,
  network: networkTable,
  check: checkTable,
};

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
      for (const b of all) console.log(`${b.id}\t${b.title}\t${new Date(b.updated).toLocaleString('ja-JP')}`);
      return;
    }

    case 'show': {
      const json = flag('--json');
      const { doc } = load(args[0]);
      return void process.stdout.write(json ? `${JSON.stringify(doc, null, 2)}\n` : toYaml(doc));
    }

    case 'apply': {
      const relayout = flag('--relayout');
      const { doc, serial } = load(args[0]);
      let next: Doc;
      try {
        next = fitLegends(fromYaml(await input(args[1]), doc, relayout));
      } catch (e) {
        fail(`YAML を反映できませんでした: ${e instanceof Error ? e.message : e}`);
      }
      save(next, serial, 'CLI apply の前');
      return;
    }

    case 'new': {
      const title = args[0];
      if (!title) fail('タイトルを指定してください');
      const blank: Doc = { version: 1, id: randomId(), meta: emptyMeta(title), nodes: [], edges: [] };
      const src = args[1] !== undefined || !process.stdin.isTTY ? await input(args[1]) : '';
      let doc = blank;
      if (src.trim()) {
        try {
          doc = fitLegends(fromYaml(src, blank));
        } catch (e) {
          fail(`YAML を読めませんでした: ${e instanceof Error ? e.message : e}`);
        }
      }
      // The title asked for wins over one in the YAML.
      doc = { ...doc, meta: { ...doc.meta, title } };
      const done = boards.write(doc as never, undefined);
      process.stderr.write(`作成しました: ${done.folder}\n`);
      return void console.log(doc.id);
    }

    case 'lists': {
      const csv = flag('--csv');
      const json = flag('--json');
      const { doc } = load(args[0]);
      const make = LISTS[args[1] ?? 'equipment'];
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
      if (previous) {
        const { blob, report } = await updateWorkbook(doc, bytes(previous));
        const file = path.resolve(out ?? previous);
        fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
        return void console.log(`更新しました: ${file}（追加 ${report.added}・変更 ${report.changed}・削除 ${report.removed} 行${report.extra.length ? `、引き継いだ列: ${report.extra.join('・')}` : ''}）`);
      }
      const file = path.resolve(out ?? `${doc.meta.title.replace(/[\\/:*?"<>|\s]+/g, '_') || 'board'}_機材ケーブル表.xlsx`);
      fs.writeFileSync(file, Buffer.from(await (await workbook(doc)).arrayBuffer()));
      return void console.log(`書き出しました: ${file}`);
    }

    case 'backups': {
      const info = find(args[0]);
      const list = boards.backups(info.id);
      if (!list.length) return void console.log('（控えはありません）');
      for (const b of list) console.log(`${b.name}\t${b.note}`);
      return;
    }

    case 'restore': {
      const { doc, serial } = load(args[0]);
      const name = args[1];
      if (!name) fail('控えの名前を指定してください（keito backups で一覧）');
      const old = readBoard(boards.readBackup(doc.id, name));
      if (!old) fail(`控え「${name}」がありません`);
      save({ ...old, id: doc.id }, serial, `restore ${name} の前`);
      return;
    }

    case 'url': {
      const info = find(args[0]);
      return void console.log(`http://localhost:5183/#/b/${info.id}`);
    }

    default:
      fail(`知らないコマンドです: ${cmd}（keito help）`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e), 1));
