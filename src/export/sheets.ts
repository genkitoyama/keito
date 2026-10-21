import { TABLES, type Table, equipmentTable } from '../model/lists';
import { kindOf } from '../model/kinds';
import type { Doc } from '../model/types';

/**
 * The lists as the Excel workbook has them, kept apart from the workbook writer so the export
 * panel can show them without loading the spreadsheet library.
 */

/**
 * Purchase status is kept in the spreadsheet, not on the board: it changes daily while the gear
 * is ordered, and two places to keep it would drift apart. The column comes empty, with a list.
 */
export const STATUS = '購入ステータス';

/** The list with an empty column put in after another one. */
function withColumn(t: Table, after: string, head: string): Table {
  const at = t.head.indexOf(after) + 1;
  const put = <T,>(xs: T[], x: T): T[] => [...xs.slice(0, at), x, ...xs.slice(at)];
  return { ...t, head: put(t.head, head), widths: put(t.widths, 10), rows: t.rows.map((r) => put(r, '')) };
}

/** The lists as the workbook's sheets have them: the board's kind's lists, the equipment list with a status column. */
export const sheetTables = (doc: Doc): Table[] => kindOf(doc).lists.map((k) => (k === 'equipment' ? withColumn(equipmentTable(doc), '金額(円)', STATUS) : TABLES[k].make(doc)));
