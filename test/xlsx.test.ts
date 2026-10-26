import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { updateWorkbook, workbook } from '../src/export/xlsx';
import type { DeviceNode, Doc } from '../src/model/types';
import { sample } from './helpers';

const load = async (blob: Blob) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
};
const rowsOf = (ws: ExcelJS.Worksheet) => {
  const out: string[][] = [];
  ws.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))));
  return out;
};

/** A workbook written for the sample board, then edited in Excel: a note sheet, a spare row typed in, a dated column. */
async function edited(doc: Doc) {
  const wb = await load(await workbook(doc));
  const ws = wb.getWorksheet('機材リスト')!;
  wb.addWorksheet('打合せメモ').getCell('A1').value = '搬入は 9 時';
  // A column of the sheet's own, with a date in it for the first device.
  const head = ws.getRow(4);
  let last = 0;
  head.eachCell((_, j) => (last = Math.max(last, j)));
  head.getCell(last + 1).value = '発注日';
  const date = ws.getCell(5, last + 1);
  date.value = new Date(Date.UTC(2026, 9, 1));
  date.numFmt = 'yyyy/mm/dd';
  // A spare unit typed in below the list.
  const spare = ws.getRow(ws.rowCount + 2);
  spare.getCell(4).value = '予備ケーブル一式';
  spare.getCell(7).value = 1;
  return Buffer.from(await wb.xlsx.writeBuffer()).buffer as ArrayBuffer;
}

describe('bringing a workbook up to date', () => {
  it('keeps sheets, rows and formats added in Excel', async () => {
    const doc = sample();
    const { blob, report } = await updateWorkbook(doc, await edited(doc));
    const wb = await load(blob);
    expect(report.sheets).toEqual(['打合せメモ']);
    expect(wb.getWorksheet('打合せメモ')!.getCell('A1').value).toBe('搬入は 9 時');
    expect(report.manual).toBe(1);
    expect(rowsOf(wb.getWorksheet('機材リスト')!).some((r) => r.includes('予備ケーブル一式'))).toBe(true);
    expect(report.extra).toEqual(['発注日']);
    const ws = wb.getWorksheet('機材リスト')!;
    let col = 0;
    ws.getRow(4).eachCell((c, j) => c.value === '発注日' && (col = j));
    expect(ws.getCell(5, col).numFmt).toBe('yyyy/mm/dd');
    // Nothing changed on the board: nothing is reported changed.
    expect(report.changed).toBe(0);
  });

  it('carries the rows typed in, the removed rows and the notes through a second update', async () => {
    const doc = sample();
    const first = await updateWorkbook(doc, await edited(doc));
    // A device leaves the board.
    const gone = doc.nodes.find((n): n is DeviceNode => n.type === 'device')!;
    const less: Doc = { ...doc, nodes: doc.nodes.filter((n) => n !== gone), edges: doc.edges.filter((e) => e.from.node !== gone.id && e.to.node !== gone.id) };
    const second = await updateWorkbook(less, await first.blob.arrayBuffer());
    expect(second.report.removed).toBeGreaterThan(0);
    expect(second.report.manual).toBe(1);
    // Rows after the removed device move up a place in the equipment list: their number is no change.
    const notes: string[] = [];
    (await load(second.blob)).getWorksheet('機材リスト')!.eachRow((row) => row.eachCell((c) => c.note && notes.push(String(c.value))));
    expect(notes).toEqual([]);
    // A third update keeps what the second set aside.
    const third = await updateWorkbook(less, await second.blob.arrayBuffer());
    const wb = await load(third.blob);
    expect(wb.getWorksheet('削除された行')).toBeDefined();
    expect(rowsOf(wb.getWorksheet('削除された行')!).some((r) => r.join(' ').includes(gone.text.split('\n')[0]))).toBe(true);
    expect(third.report.manual).toBe(1);
    expect(wb.getWorksheet('打合せメモ')).toBeDefined();
  });
});

describe('a workbook sorted or renamed in Excel', () => {
  const columns = (ws: ExcelJS.Worksheet) => {
    const cols = new Map<string, number>();
    ws.getRow(4).eachCell((c, j) => cols.set(String(c.value), j));
    return cols;
  };
  /** The rows standing for devices (not the total): a key in the hidden column. */
  const deviceRows = (ws: ExcelJS.Worksheet) => {
    const key = columns(ws).get('keito ID')!;
    const out: number[] = [];
    for (let r = 5; r <= ws.rowCount; r++) {
      const k = String(ws.getCell(r, key).value ?? '');
      if (k && k !== '-') out.push(r);
    }
    return out;
  };
  /** The equipment sheet with a purchase status typed for every device: its name, as the status. */
  async function withStatus(doc: Doc) {
    const wb = await load(await workbook(doc));
    const ws = wb.getWorksheet('機材リスト')!;
    const cols = columns(ws);
    for (const r of deviceRows(ws)) ws.getCell(r, cols.get('購入ステータス')!).value = `済:${ws.getCell(r, cols.get('名称')!).value}`;
    return { wb, ws };
  }
  const statuses = async (blob: Blob, sheet = '機材リスト') => {
    const ws = (await load(blob)).getWorksheet(sheet)!;
    const cols = columns(ws);
    return deviceRows(ws).map((r) => [String(ws.getCell(r, cols.get('名称')!).value), String(ws.getCell(r, cols.get('購入ステータス')!).value ?? '')]);
  };

  it('sorts the hidden key with the rows, so each status stays with its device', async () => {
    const doc = sample();
    const { wb, ws } = await withStatus(doc);
    // The filter Excel sorts by reaches the hidden key.
    const ref = String(ws.autoFilter);
    const last = (ref.match(/:([A-Z]+)\d+$/) ?? ['', 'A'])[1];
    const lastCol = [...last].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    expect(lastCol).toBeGreaterThanOrEqual(columns(ws).get('keito ID')!);
    // Sort as Excel's filter does: whole rows within the filter, here in reverse.
    const rows = deviceRows(ws);
    const values = rows.map((r) => Array.from({ length: lastCol }, (_, j) => ws.getCell(r, j + 1).value));
    values.reverse().forEach((row, i) => row.forEach((v, j) => (ws.getCell(rows[i], j + 1).value = v)));
    const { blob } = await updateWorkbook(doc, (await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const kept = await statuses(blob);
    expect(kept.length).toBeGreaterThan(3);
    for (const [name, status] of kept) expect(status).toBe(`済:${name}`);
  });

  it('finds a list sheet renamed by hand, and keeps its name and statuses', async () => {
    const doc = sample();
    const { wb, ws } = await withStatus(doc);
    ws.name = '機材';
    const { blob, report } = await updateWorkbook(doc, (await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(report.renamed).toEqual(['機材リスト → 機材']);
    const kept = await statuses(blob, '機材');
    expect(kept.length).toBeGreaterThan(3);
    for (const [name, status] of kept) expect(status).toBe(`済:${name}`);
  });
});
