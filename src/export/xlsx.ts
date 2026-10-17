import type { Cell, Worksheet } from 'exceljs';
import { type Table, cableSummaryTable, cableTable, checkTable, colourKey, equipmentTable, networkTable, powerTable } from '../model/lists';
import { PRESETS } from '../model/presets';
import { allSignals } from '../model/signals';
import { type Doc, latestRev } from '../model/types';

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
  };
}

/** Which columns of which list take a dropdown. */
const DROPDOWNS: Record<string, string[]> = {
  機材リスト: ['区分', 'カテゴリ'],
  ケーブルリスト: ['種別'],
};

function writeSheet(ws: Worksheet, t: Table, doc: Doc, lists: Map<string, string>): void {
  const cols = t.head.length;
  // Title and the board's particulars above the table, as on the printed sheets.
  ws.getCell(1, 1).value = `${t.title} — ${doc.meta.title || '無題のボード'}`;
  ws.getCell(1, 1).font = { size: 14, bold: true, color: { argb: INK } };
  const rev = latestRev(doc);
  ws.getCell(2, 1).value = [doc.meta.project && `案件名: ${doc.meta.project}`, rev && `REV: ${rev}`, `出力日: ${new Date().toLocaleDateString('ja-JP')}`].filter(Boolean).join('　');
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
  t.rows.forEach((row, r) => {
    const line = ws.getRow(HEAD_ROW + 1 + r);
    const total = t.total && r === t.rows.length - 1;
    const look = (t.rowClass?.[r] ?? '').split(' ');
    row.forEach((v, j) => {
      const c = line.getCell(j + 1);
      const numeric = t.numeric?.includes(t.head[j]) && v !== '' && Number.isFinite(Number(v));
      if (j === urlCol && /^https?:\/\//.test(v)) c.value = { text: v.replace(/^https?:\/\/(www\.)?/, ''), hyperlink: v };
      else c.value = numeric ? Number(v) : v;
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
  const body = t.rows.length - (t.total ? 1 : 0);
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
  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW, showGridLines: false }];
  if (body > 0) ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: HEAD_ROW + body, column: cols } };
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEAD_ROW}:${HEAD_ROW}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
}

export async function workbook(doc: Doc): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'keito';
  wb.created = new Date();
  const tables = [equipmentTable(doc), cableTable(doc), cableSummaryTable(doc), powerTable(doc), networkTable(doc), checkTable(doc)];
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
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
