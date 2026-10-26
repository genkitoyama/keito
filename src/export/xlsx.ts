import type { Cell, Worksheet } from 'exceljs';
import { type Table, colourKey } from '../model/lists';
import { PRESETS } from '../model/presets';
import { STATUS, sheetTables } from './sheets';
import { allSignals } from '../model/signals';
import type { Doc } from '../model/types';

/**
 * The lists as one Excel workbook: a sheet per list with the board's title over it, a dark
 * header row that stays in view and filters, widths that fit, totals set apart, links that open,
 * and dropdowns for the columns that take a fixed set of words. Google Sheets opens it as well.
 */

const HEAD_ROW = 4;
const INK = 'FF1E293B';
const LINE = 'FFE2E8F0';
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const thin = { style: 'thin' as const, color: { argb: LINE } };

/** Text width in Excel's units (about one latin character): full-width characters count double. */
const textWidth = (s: string): number => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);

/** The words offered in dropdowns, by column heading. Anything else may still be typed. */
function choices(doc: Doc): Record<string, string[]> {
  const devices = doc.nodes.flatMap((n) => (n.type === 'device' ? [n] : []));
  const uniq = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  return {
    種別: allSignals()
      .filter((s) => s.cable)
      .map((s) => s.label),
    プロトコル: allSignals()
      .filter((s) => s.protocol)
      .map((s) => s.label),
    カテゴリ: [...uniq([...devices.map((d) => d.category), ...PRESETS.map((p) => p.category)]).filter((c) => c !== 'その他').sort((a, b) => a.localeCompare(b, 'ja')), 'その他'],
    区分: uniq([...colourKey(doc).values(), ...devices.map((d) => d.vendor ?? '')]),
    [STATUS]: STATUSES,
  };
}

/** Which columns of which list take a dropdown. */
const DROPDOWNS: Record<string, string[]> = {
  機材リスト: ['区分', 'カテゴリ', '購入ステータス'],
  ケーブルリスト: ['種別'],
  通信一覧: ['プロトコル'],
};

const STATUSES = ['未定', '見積中', '発注済', '納品済', '既存', 'レンタル'];

/** In the hidden key column: a row keito wrote that stands for nothing on the board (a total …). */
const OWN_ROW = '-';

/** Columns summed in a total row with a formula, so totals follow edits made in the sheet. */
const SUMMED = ['数量', '金額(円)', '消費電力(W)', '長さ(m)', '本数', '合計長(m)'];
const YEN = ['単価(円)', '金額(円)'];

function writeSheet(ws: Worksheet, t: Table, doc: Doc, lists: Map<string, string>): void {
  const cols = t.head.length;
  // Title and the board's particulars above the table, as on the printed sheets.
  ws.getCell(1, 1).value = `${t.title} — ${doc.meta.title || '無題のボード'}`;
  ws.getCell(1, 1).font = { size: 14, bold: true, color: { argb: INK } };
  ws.getCell(2, 1).value = [doc.meta.project && `案件名: ${doc.meta.project}`, `出力日: ${new Date().toLocaleDateString('ja-JP')}`].filter(Boolean).join('　');
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };

  const head = ws.getRow(HEAD_ROW);
  t.head.forEach((h, j) => {
    const c = head.getCell(j + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill('FF334155');
    c.alignment = { vertical: 'middle', horizontal: t.numeric?.includes(h) ? 'right' : 'left' };
  });
  head.height = 20;

  const urlCol = t.head.indexOf('URL');
  const col = (h: string): string => (t.head.includes(h) ? ws.getColumn(t.head.indexOf(h) + 1).letter : '');
  const qty = col('数量');
  const unit = col('単価(円)');
  const first = HEAD_ROW + 1;
  const body = t.rows.length - (t.total ? 1 : 0);
  t.rows.forEach((row, r) => {
    const line = ws.getRow(HEAD_ROW + 1 + r);
    const total = t.total && r === t.rows.length - 1;
    const look = (t.rowClass?.[r] ?? '').split(' ');
    row.forEach((v, j) => {
      const c = line.getCell(j + 1);
      const numeric = t.numeric?.includes(t.head[j]) && v !== '' && Number.isFinite(Number(v));
      const at = HEAD_ROW + 1 + r;
      if (j === urlCol && /^https?:\/\//.test(v)) c.value = { text: v.replace(/^https?:\/\/(www\.)?/, ''), hyperlink: v };
      // Amounts and totals as formulas, so a price or quantity changed in the sheet carries through.
      else if (!total && t.head[j] === '金額(円)' && qty && unit && row[t.head.indexOf('単価(円)')] !== '') c.value = { formula: `${qty}${at}*${unit}${at}`, result: Number(v) };
      else if (total && SUMMED.includes(t.head[j]) && v !== '' && body > 0) c.value = { formula: `SUM(${col(t.head[j])}${first}:${col(t.head[j])}${first + body - 1})`, result: Number(v) };
      else c.value = numeric ? Number(v) : v;
      if (YEN.includes(t.head[j])) c.numFmt = '#,##0';
      if (j === urlCol && v) c.font = { color: { argb: 'FF2563EB' }, underline: true };
      if (t.numeric?.includes(t.head[j])) c.alignment = { horizontal: 'right' };
      c.border = { bottom: thin };
      // Light bands make long lists easier to follow across.
      if (!total && r % 2 === 1) c.fill = fill('FFF8FAFC');
    });
    if (total || look.includes('subtotal')) {
      for (let j = 1; j <= cols; j++) {
        const c = line.getCell(j);
        c.font = { ...c.font, bold: true };
        c.fill = fill(look.includes('over') ? 'FFFDECEC' : 'FFEEF2F6');
        c.border = total ? { top: { style: 'medium', color: { argb: 'FF334155' } } } : { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
      }
      // The verdict of a power source in its colour: green with headroom, red when over.
      if (look.includes('subtotal')) line.getCell(cols).font = { bold: !look.includes('unknown'), color: { argb: look.includes('over') ? 'FFB91C1C' : look.includes('unknown') ? 'FF64748B' : 'FF15803D' } };
    }
    if (look.includes('member')) line.getCell(1).font = { color: { argb: 'FF94A3B8' } };
    if (look.includes('warn')) line.getCell(1).font = { bold: true, color: { argb: 'FFDC2626' } };
    if (look.includes('note')) line.getCell(1).font = { color: { argb: 'FFB45309' } };
  });
  if (!t.rows.length) ws.getCell(HEAD_ROW + 1, 1).value = t.empty ?? '（なし）';

  // Dropdowns on the data rows of the columns that take a fixed set of words. Other words may
  // still be typed (a new supplier, a type of its own): the list only offers.
  for (const h of DROPDOWNS[t.title] ?? []) {
    const j = t.head.indexOf(h);
    const range = lists.get(h);
    if (j < 0 || !range) continue;
    for (let r = 0; r < body; r++) {
      const c: Cell = ws.getCell(HEAD_ROW + 1 + r, j + 1);
      c.dataValidation = { type: 'list', allowBlank: true, formulae: [range], showErrorMessage: false };
    }
  }

  // Widths to fit what is in each column, within reason.
  t.head.forEach((h, j) => {
    const longest = Math.max(textWidth(h), ...t.rows.map((row) => textWidth(row[j] ?? '')));
    ws.getColumn(j + 1).width = Math.min(48, Math.max(6, longest + 2));
  });
  // What each row stands for on the board, out of sight: the key for bringing a sheet up to date.
  const key = ws.getColumn(cols + 1);
  key.hidden = true;
  ws.getCell(HEAD_ROW, cols + 1).value = 'keito ID';
  // Rows of keito's own that stand for nothing (totals, subtotals) are marked, so that a row typed
  // into the sheet by hand (with no key) is told apart from them when the sheet is brought up to date.
  t.refs.forEach((ids, r) => (ws.getCell(HEAD_ROW + 1 + r, cols + 1).value = ids.length ? ids.join(' ') : OWN_ROW));
  if (!t.rows.length) ws.getCell(HEAD_ROW + 1, cols + 1).value = OWN_ROW;
  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW, showGridLines: false }];
  // The filter takes in the hidden key: sorting from it moves each row's key with the row.
  if (body > 0) ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: HEAD_ROW + body, column: cols + 1 } };
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEAD_ROW}:${HEAD_ROW}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
}

async function build(doc: Doc) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'keito';
  wb.created = new Date();
  const tables = sheetTables(doc);
  // The dropdowns' words live on a hidden last sheet, one column per list: too many for a formula.
  const words = Object.entries(choices(doc)).filter(([, w]) => w.length);
  const letter = (k: number): string => String.fromCharCode(65 + k);
  const lists = new Map(words.map(([h, w], k) => [h, `'選択肢'!$${letter(k)}$2:$${letter(k)}$${w.length + 1}`]));
  for (const t of tables) writeSheet(wb.addWorksheet(t.title), t, doc, lists);
  const sheet = wb.addWorksheet(CHOICES, { state: 'hidden' });
  words.forEach(([h, w], k) => {
    sheet.getCell(1, k + 1).value = h;
    w.forEach((x, i) => (sheet.getCell(i + 2, k + 1).value = x));
  });
  return { ExcelJS, wb };
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function workbook(doc: Doc): Promise<Blob> {
  const { wb } = await build(doc);
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE });
}

/** The lists whose rows carry over when a workbook is brought up to date; the others are made afresh. */
const KEPT = ['機材リスト', 'ケーブルリスト', 'ケーブル集計', 'ネットワーク', '通信一覧'];
/** Columns the board never fills: what the sheet says in them is the sheet's to keep. */
const SHEET_OWNED = [STATUS];
const KEY = 'keito ID';
/** The hidden sheet of the dropdowns' words. */
const CHOICES = '選択肢';
/** In the key column of the heading over the rows typed by hand. */
const MANUAL_HEAD = '+';
const REMOVED = '削除された行';

export interface UpdateReport {
  added: number;
  changed: number;
  removed: number;
  /** Columns added in the sheet by hand, carried over as they were. */
  extra: string[];
  /** Rows typed into the lists by hand (standing for nothing on the board), carried over. */
  manual: number;
  /** Sheets added to the workbook by hand, carried over. */
  sheets: string[];
  /** Lists whose sheets were renamed by hand, matched by their columns: the name they keep. */
  renamed: string[];
}

/** Columns that only say where a row stands: a new place is no change to report. */
const POSITIONAL = ['No'];

/** Copy a cell's look along with its value (a date stays a date, a figure keeps its format). */
function carry(from: Cell, to: Cell): void {
  to.value = plain(from.value) as never;
  if (from.numFmt) to.numFmt = from.numFmt;
  if (from.font) to.font = from.font;
  if (from.alignment) to.alignment = from.alignment;
}

/** A whole sheet into another workbook: values, looks, widths, heights and merged cells. */
function copySheet(from: Worksheet, to: Worksheet): void {
  from.columns?.forEach((c, i) => {
    if (c.width) to.getColumn(i + 1).width = c.width;
    if (c.hidden) to.getColumn(i + 1).hidden = true;
  });
  from.eachRow({ includeEmpty: false }, (row, r) => {
    const line = to.getRow(r);
    if (row.height) line.height = row.height;
    row.eachCell({ includeEmpty: false }, (c, j) => {
      const d = line.getCell(j);
      d.value = c.value;
      d.style = JSON.parse(JSON.stringify(c.style ?? {}));
      if (c.note) d.note = c.note;
    });
  });
  for (const range of (from.model as { merges?: string[] }).merges ?? []) to.mergeCells(range);
}

/** What a cell reads as, whatever form its value takes (a formula's result, a link's text …). */
function shown(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('ja-JP');
  if (typeof v !== 'object') return String(v);
  const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; error?: string };
  if ('result' in o) return shown(o.result);
  if (o.richText) return o.richText.map((r) => r.text).join('');
  if ('text' in o) return shown(o.text);
  return o.error ?? '';
}

/** A value fit to copy into another row: a formula would point at the wrong cells, so its result goes instead. */
const plain = (v: unknown): unknown => (v && typeof v === 'object' && 'formula' in (v as object) ? ((v as { result?: unknown }).result ?? null) : v);

interface OldRow {
  sheet: string;
  values: Map<string, unknown>;
  /** The cells themselves, for their looks. */
  cells: Map<string, Cell>;
  ids: string[];
  used: boolean;
}

/** Header row and columns of a sheet keito wrote, found by its hidden key column. */
function layout(ws: Worksheet): { row: number; cols: Map<string, number> } | null {
  for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
    const cols = new Map<string, number>();
    ws.getRow(r).eachCell((c, j) => {
      const h = shown(c.value).trim();
      if (h) cols.set(h, j);
    });
    if (cols.has(KEY)) return { row: r, cols };
  }
  return null;
}

/**
 * A workbook written before, brought up to date with the board. What the board owns (names,
 * models, quantities, prices, cables) is written afresh; what was added in the sheet (purchase
 * status, columns of its own such as order dates) is carried over row by row, matched by the
 * hidden keito IDs. New rows are green, changed cells yellow, and rows whose devices or cables
 * have left the board move to a sheet of their own, status and all.
 */
export async function updateWorkbook(doc: Doc, previous: ArrayBuffer): Promise<{ blob: Blob; report: UpdateReport }> {
  const { ExcelJS, wb } = await build(doc);
  const old = new ExcelJS.Workbook();
  await old.xlsx.load(previous);
  const report: UpdateReport = { added: 0, changed: 0, removed: 0, extra: [], manual: 0, sheets: [], renamed: [] };
  const leftover: OldRow[] = [];
  let found = false;

  // Each list's sheet in the earlier workbook: by its name, or, renamed by hand, by its columns.
  const claimed = new Set<string>();
  const earlier = (name: string): Worksheet | undefined => {
    const named = old.getWorksheet(name);
    if (named && layout(named)) return named;
    const now = wb.getWorksheet(name);
    const after = now && layout(now);
    if (!after) return undefined;
    const heads = [...after.cols.keys()].filter((h) => h !== KEY);
    let best: { ws: Worksheet; shared: number } | undefined;
    for (const ws of old.worksheets) {
      const l = ws.name !== REMOVED && !KEPT.includes(ws.name) && !claimed.has(ws.name) ? layout(ws) : null;
      if (!l) continue;
      const shared = heads.filter((h) => l.cols.has(h)).length;
      if (shared > heads.length / 2 && (!best || shared > best.shared)) best = { ws, shared };
    }
    return best?.ws;
  };

  for (const name of KEPT) {
    const was = earlier(name);
    const now = wb.getWorksheet(name);
    const before = was && layout(was);
    const after = now && layout(now);
    if (!was || !before) continue;
    found = true;
    claimed.add(was.name);
    // A sheet renamed by hand keeps the name it was given.
    if (now && was.name !== name) {
      now.name = was.name;
      report.renamed.push(`${name} → ${was.name}`);
    }
    // Rows of the earlier sheet, by every id they stand for.
    const rows: OldRow[] = [];
    const byId = new Map<string, OldRow>();
    // Rows typed into the sheet by hand: no key, and not one of keito's own (marked, or in bold
    // as totals were before they were marked).
    const manual: OldRow[] = [];
    for (let r = before.row + 1; r <= was.rowCount; r++) {
      const key = shown(was.getCell(r, before.cols.get(KEY)!).value).trim();
      if (key === OWN_ROW || key === MANUAL_HEAD) continue;
      const ids = key.split(/\s+/).filter(Boolean);
      const values = new Map<string, unknown>();
      const cells = new Map<string, Cell>();
      for (const [h, j] of before.cols) {
        if (h === KEY) continue;
        values.set(h, was.getCell(r, j).value);
        cells.set(h, was.getCell(r, j));
      }
      const row: OldRow = { sheet: name, values, cells, ids, used: false };
      if (!ids.length) {
        const filled = [...values.values()].some((v) => shown(v).trim() !== '');
        if (filled && !was.getCell(r, 1).font?.bold) manual.push(row);
        continue;
      }
      rows.push(row);
      for (const id of ids) if (!byId.has(id)) byId.set(id, row);
    }
    // A list the board no longer has (its kind changed): every row of it is kept aside, status and all.
    if (!now || !after) {
      leftover.push(...rows, ...manual);
      continue;
    }
    // Columns made in the sheet by hand go after the board's, beyond the hidden key.
    const extra = [...before.cols.keys()].filter((h) => h !== KEY && !after.cols.has(h));
    const keyCol = after.cols.get(KEY)!;
    extra.forEach((h, k) => {
      const c = now.getCell(after.row, keyCol + 1 + k);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = fill('FF475569');
      now.getColumn(keyCol + 1 + k).width = Math.min(40, Math.max(10, textWidth(h) + 4));
      if (!report.extra.includes(h)) report.extra.push(h);
    });
    // The filter takes in those columns too, so sorting keeps them with their rows.
    if (extra.length && now.autoFilter && typeof now.autoFilter === 'object' && 'from' in now.autoFilter) {
      const f = now.autoFilter as { from: { row: number; column: number }; to: { row: number; column: number } };
      now.autoFilter = { from: f.from, to: { row: f.to.row, column: keyCol + extra.length } };
    }

    for (let r = after.row + 1; r <= now.rowCount; r++) {
      const key = shown(now.getCell(r, keyCol).value).trim();
      // keito's own rows (totals) stand for nothing: never "added".
      if (key === OWN_ROW || key === MANUAL_HEAD) continue;
      const ids = key.split(/\s+/).filter(Boolean);
      if (!ids.length) continue;
      const match = ids.map((id) => byId.get(id)).find((x) => x && !x.used) ?? ids.map((id) => byId.get(id)).find(Boolean);
      // Rows now made one (two devices given the same name) are all in this row: none has left the board.
      for (const id of ids) {
        const merged = byId.get(id);
        if (merged) merged.used = true;
      }
      if (!match) {
        report.added++;
        for (let j = 1; j < keyCol; j++) now.getCell(r, j).fill = fill('FFDCFCE7');
        continue;
      }
      match.used = true;
      let touched = false;
      for (const [h, j] of after.cols) {
        if (h === KEY || !match.values.has(h)) continue;
        const cell = now.getCell(r, j);
        const prev = match.values.get(h);
        if (SHEET_OWNED.includes(h)) {
          if (shown(cell.value) === '' && shown(prev) !== '') carry(match.cells.get(h)!, cell);
        } else if (!POSITIONAL.includes(h) && shown(prev) !== shown(cell.value)) {
          cell.fill = fill('FFFEF9C3');
          cell.note = `前回: ${shown(prev) || '（空）'}`;
          touched = true;
        }
      }
      if (touched) report.changed++;
      extra.forEach((h, k) => carry(match.cells.get(h)!, now.getCell(r, keyCol + 1 + k)));
    }
    leftover.push(...rows.filter((x) => !x.used));
    // Rows typed by hand go on below the list, under a heading of their own, as they were.
    if (manual.length) {
      let r = now.rowCount + 2;
      const head = now.getCell(r, 1);
      head.value = '手入力の行（図にはない行。更新しても残ります）';
      head.font = { bold: true, color: { argb: 'FF475569' } };
      now.getCell(r, keyCol).value = MANUAL_HEAD;
      for (const row of manual) {
        r++;
        for (const [h, j] of after.cols) if (h !== KEY && row.cells.has(h)) carry(row.cells.get(h)!, now.getCell(r, j));
        extra.forEach((h, k) => row.cells.has(h) && carry(row.cells.get(h)!, now.getCell(r, keyCol + 1 + k)));
      }
      report.manual += manual.length;
    }
  }
  if (!found) throw new Error('keito で書き出した Excel ファイルではありません（keito ID の列が見つかりません）');

  // Sheets added to the workbook by hand (meeting notes …) come along as they were; keito's own
  // sheets are written afresh (a list the board no longer has is kept aside above).
  const ours = new Set(wb.worksheets.map((ws) => ws.name));
  for (const ws of old.worksheets) {
    // A list's sheet taken up above is written afresh; one of keito's not matched to any list now
    // (renamed past recognition) comes along as it was rather than be lost.
    if (ours.has(ws.name) || claimed.has(ws.name) || ws.name === REMOVED || ws.name === CHOICES) continue;
    copySheet(ws, wb.addWorksheet(ws.name, { state: ws.state, properties: { tabColor: ws.properties?.tabColor } }));
    report.sheets.push(ws.name);
  }

  // Rows that left the board, kept with what the sheet said about them (an order already placed …).
  // Those that left at earlier updates stay where they were, these going on below them.
  report.removed = leftover.length;
  const before = old.getWorksheet(REMOVED);
  if (leftover.length || before) {
    const ws = wb.addWorksheet(REMOVED, { properties: { tabColor: { argb: 'FFDC2626' } } });
    if (before) copySheet(before, ws);
    else {
      ws.getCell(1, 1).value = '図から消えた行（前回のファイルにあったもの）';
      ws.getCell(1, 1).font = { size: 14, bold: true, color: { argb: INK } };
    }
    let r = before ? ws.rowCount + 2 : 3;
    if (before && leftover.length) {
      ws.getCell(r, 1).value = `${new Date().toLocaleDateString('ja-JP')} の更新で消えた行`;
      ws.getCell(r, 1).font = { bold: true, color: { argb: 'FFB91C1C' } };
      r += 2;
    }
    for (const name of KEPT) {
      const rows = leftover.filter((x) => x.sheet === name);
      if (!rows.length) continue;
      ws.getCell(r, 1).value = name;
      ws.getCell(r, 1).font = { bold: true };
      r++;
      const heads = [...rows[0].values.keys()];
      heads.forEach((h, j) => {
        const c = ws.getCell(r, j + 1);
        c.value = h;
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = fill('FF334155');
        ws.getColumn(j + 1).width = Math.max(ws.getColumn(j + 1).width ?? 8, Math.min(40, textWidth(h) + 4));
      });
      r++;
      for (const row of rows) {
        heads.forEach((h, j) => carry(row.cells.get(h)!, ws.getCell(r, j + 1)));
        r++;
      }
      r++;
    }
    // It lands after the hidden sheet of choices, which leaves it last among the visible tabs.
  }
  return { blob: new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), report };
}
