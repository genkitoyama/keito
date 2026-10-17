import type { Cell, Worksheet } from 'exceljs';
import { type Table, cableSummaryTable, cableTable, checkTable, colourKey, equipmentTable, networkTable, powerTable } from '../model/lists';
import { PRESETS } from '../model/presets';
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
    カテゴリ: [...uniq([...devices.map((d) => d.category), ...PRESETS.map((p) => p.category)]).filter((c) => c !== 'その他').sort((a, b) => a.localeCompare(b, 'ja')), 'その他'],
    区分: uniq([...colourKey(doc).values(), ...devices.map((d) => d.vendor ?? '')]),
    [STATUS]: STATUSES,
  };
}

/** Which columns of which list take a dropdown. */
const DROPDOWNS: Record<string, string[]> = {
  機材リスト: ['区分', 'カテゴリ', '購入ステータス'],
  ケーブルリスト: ['種別'],
};

/**
 * Purchase status is kept in the spreadsheet, not on the board: it changes daily while the gear
 * is ordered, and two places to keep it would drift apart. The column comes empty, with a list.
 */
const STATUS = '購入ステータス';
const STATUSES = ['未定', '見積中', '発注済', '納品済', '既存', 'レンタル'];

/** Columns summed in a total row with a formula, so totals follow edits made in the sheet. */
const SUMMED = ['数量', '金額(円)', '消費電力(W)', '長さ(m)', '本数', '合計長(m)'];
const YEN = ['単価(円)', '金額(円)'];

/** The list with an empty column put in after another one. */
function withColumn(t: Table, after: string, head: string): Table {
  const at = t.head.indexOf(after) + 1;
  const put = <T,>(xs: T[], x: T): T[] => [...xs.slice(0, at), x, ...xs.slice(at)];
  return { ...t, head: put(t.head, head), widths: put(t.widths, 10), rows: t.rows.map((r) => put(r, '')) };
}

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
  t.refs.forEach((ids, r) => ids.length && (ws.getCell(HEAD_ROW + 1 + r, cols + 1).value = ids.join(' ')));
  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW, showGridLines: false }];
  if (body > 0) ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: HEAD_ROW + body, column: cols } };
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEAD_ROW}:${HEAD_ROW}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
}

/** The lists as the workbook's sheets have them, in its order (the equipment list with a status column). */
export const sheetTables = (doc: Doc): Table[] => [withColumn(equipmentTable(doc), '金額(円)', STATUS), cableTable(doc), cableSummaryTable(doc), powerTable(doc), networkTable(doc), checkTable(doc)];

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
  const sheet = wb.addWorksheet('選択肢', { state: 'hidden' });
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
const KEPT = ['機材リスト', 'ケーブルリスト', 'ケーブル集計', 'ネットワーク'];
/** Columns the board never fills: what the sheet says in them is the sheet's to keep. */
const SHEET_OWNED = [STATUS];
const KEY = 'keito ID';
const REMOVED = '削除された行';

export interface UpdateReport {
  added: number;
  changed: number;
  removed: number;
  /** Columns added in the sheet by hand, carried over as they were. */
  extra: string[];
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
  const report: UpdateReport = { added: 0, changed: 0, removed: 0, extra: [] };
  const leftover: OldRow[] = [];
  let found = false;

  for (const name of KEPT) {
    const was = old.getWorksheet(name);
    const now = wb.getWorksheet(name);
    const before = was && layout(was);
    const after = now && layout(now);
    if (!was || !now || !before || !after) continue;
    found = true;
    // Rows of the earlier sheet, by every id they stand for.
    const rows: OldRow[] = [];
    const byId = new Map<string, OldRow>();
    for (let r = before.row + 1; r <= was.rowCount; r++) {
      const ids = shown(was.getCell(r, before.cols.get(KEY)!).value).split(/\s+/).filter(Boolean);
      if (!ids.length) continue;
      const values = new Map<string, unknown>();
      for (const [h, j] of before.cols) if (h !== KEY) values.set(h, was.getCell(r, j).value);
      const row: OldRow = { sheet: name, values, ids, used: false };
      rows.push(row);
      for (const id of ids) if (!byId.has(id)) byId.set(id, row);
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

    for (let r = after.row + 1; r <= now.rowCount; r++) {
      const ids = shown(now.getCell(r, keyCol).value).split(/\s+/).filter(Boolean);
      if (!ids.length) continue;
      const match = ids.map((id) => byId.get(id)).find((x) => x && !x.used) ?? ids.map((id) => byId.get(id)).find(Boolean);
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
          if (shown(cell.value) === '' && shown(prev) !== '') cell.value = plain(prev) as never;
        } else if (shown(prev) !== shown(cell.value)) {
          cell.fill = fill('FFFEF9C3');
          cell.note = `前回: ${shown(prev) || '（空）'}`;
          touched = true;
        }
      }
      if (touched) report.changed++;
      extra.forEach((h, k) => (now.getCell(r, keyCol + 1 + k).value = plain(match.values.get(h)) as never));
    }
    leftover.push(...rows.filter((x) => !x.used));
  }
  if (!found) throw new Error('keito で書き出した Excel ファイルではありません（keito ID の列が見つかりません）');

  // Rows that left the board, kept with what the sheet said about them (an order already placed …).
  report.removed = leftover.length;
  if (leftover.length) {
    const ws = wb.addWorksheet(REMOVED, { properties: { tabColor: { argb: 'FFDC2626' } } });
    ws.getCell(1, 1).value = '図から消えた行（前回のファイルにあったもの）';
    ws.getCell(1, 1).font = { size: 14, bold: true, color: { argb: INK } };
    let r = 3;
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
        heads.forEach((h, j) => (ws.getCell(r, j + 1).value = plain(row.values.get(h)) as never));
        r++;
      }
      r++;
    }
    // It lands after the hidden sheet of choices, which leaves it last among the visible tabs.
  }
  return { blob: new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), report };
}
