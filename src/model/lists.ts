import { openComments } from './comments';
import { frameOf } from './geometry';
import { allSignals, signalOf } from './signals';
import { safeUrl } from './url';
import { cableKind } from './standards';
import type { ListKey } from './kinds';
import type { DeviceNode, Doc, Edge, EdgeEnd, Node } from './types';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Is this cable's ID written in its label on the board? */
export const idShown = (doc: Doc, e: Edge): boolean => e.showId ?? doc.cableIdLabels !== false;

export const lengthShown = (doc: Doc, e: Edge): boolean => e.showLength ?? doc.lengthLabels !== false;
/** Is a protocol line's type and port ("HTTP 443/tcp") written in its label? The colour says the type, the comms list the port. */
export const protocolShown = (doc: Doc, e: Edge): boolean => e.showProtocol ?? doc.protocolLabels !== false;
/** Are the label's items stacked one per line rather than joined on one? */
export const labelStacked = (doc: Doc, e: Edge): boolean => e.stacked ?? doc.stackedLabels === true;

const idCache = new WeakMap<Doc, Map<string, string>>();

/** Cable IDs (HDMI-01, LAN-03 …) numbered per signal type in edge order. */
export function cableIds(doc: Doc): Map<string, string> {
  // A cut-out part keeps the numbers its cables have on the full board.
  if (doc.whole) return cableIds(doc.whole);
  const hit = idCache.get(doc);
  if (hit) return hit;
  const counters = new Map<string, number>();
  const out = new Map<string, string>();
  // IDs typed by hand are never handed out again by the numbering.
  const typed = new Set(doc.edges.filter((e) => signalOf(e.signal).cable && e.cableId?.trim()).map((e) => e.cableId!.trim()));
  for (const e of doc.edges) {
    const s = signalOf(e.signal);
    if (!s.cable) continue;
    // Video and audio cables are numbered by their kind (HDMI-01, XLR-01), VID / AUD when none is told.
    const prefix = cableKind(doc.nodes, e) ?? s.prefix;
    let n = (counters.get(prefix) ?? 0) + 1;
    // A hand-typed ID replaces the automatic one and keeps its place in the numbering, so the
    // others' numbers do not move; a number it took is passed over.
    if (!e.cableId?.trim()) while (typed.has(`${prefix}-${pad2(n)}`)) n++;
    counters.set(prefix, n);
    out.set(e.id, e.cableId?.trim() || `${prefix}-${pad2(n)}`);
  }
  idCache.set(doc, out);
  return out;
}

export interface Table {
  title: string;
  head: string[];
  rows: string[][];
  /** Node/edge id behind each row (for click-to-select); empty when aggregated. */
  refs: string[][];
  /** Relative column widths for the printed sheets. */
  widths: number[];
  /** Columns set right-aligned. */
  numeric?: string[];
  /** The last row is a total. */
  total?: boolean;
  /** What the panel says when the table has no rows. */
  empty?: string;
  /** Extra look per row, as class names: `subtotal` for a group's sum, `over` for one past its limit. */
  rowClass?: (string | undefined)[];
  /** Columns that can be edited in place, by heading, and what each writes to on the board. */
  edit?: Record<string, CellEdit>;
  /** Rows can be put in order by hand, kept under this name in `Doc.listOrder` (see `moveRow`). */
  reorder?: string;
}

/**
 * The board with one list row moved: the ids behind every row are stored in the new order, so the
 * list keeps it (and so do its CSV and PDF). Things added later go to the end.
 */
export function moveRow(doc: Doc, t: Table, from: number, to: number): Doc {
  const body = t.total ? t.refs.slice(0, -1) : t.refs;
  if (!t.reorder || from === to || from < 0 || to < 0 || from >= body.length || to >= body.length) return doc;
  const order = body.map((_, i) => i);
  order.splice(to, 0, ...order.splice(from, 1));
  return { ...doc, listOrder: { ...doc.listOrder, [t.reorder]: order.flatMap((row) => body[row]) } };
}

/** The board with one list's hand-made order dropped. */
export function clearOrder(doc: Doc, list: string): Doc {
  const { [list]: _, ...rest } = doc.listOrder ?? {};
  return { ...doc, listOrder: Object.keys(rest).length ? rest : undefined };
}

/**
 * Sorting by a list's hand-made order: a row stands where the first of its ids does; rows the
 * order does not name come after, in the list's own order (`fallback`).
 */
function byHand<T>(doc: Doc, list: string, idsOf: (row: T) => string[], fallback: (a: T, b: T) => number): (a: T, b: T) => number {
  const at = new Map((boardOf(doc).listOrder?.[list] ?? []).map((id, i) => [id, i]));
  const rank = (row: T): number => Math.min(...idsOf(row).map((id) => at.get(id) ?? Infinity));
  return (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra !== rb ? (ra < rb ? -1 : 1) : fallback(a, b);
  };
}

/** A board saved when the equipment order was kept on each device, with it moved to `listOrder`. */
export function upgradeOrder(doc: Doc): Doc {
  const ranked = doc.nodes.filter((n): n is DeviceNode => n.type === 'device' && n.listOrder != null);
  if (!ranked.length) return doc;
  const equipment = doc.listOrder?.equipment ?? [...ranked].sort((a, b) => a.listOrder! - b.listOrder!).map((n) => n.id);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.type === 'device' && n.listOrder != null ? { ...n, listOrder: undefined } : n)),
    listOrder: { ...doc.listOrder, equipment },
  };
}

/**
 * How a list cell writes back: the field of the devices or cables behind its row. A row that
 * stands for several (one model in five places) changes all of them, unless `single` says the
 * value only makes sense for one (a quantity).
 */
export interface CellEdit {
  on: 'node' | 'edge';
  field: string;
  kind?: 'text' | 'number' | 'signal';
  single?: boolean;
}

/** Fields left out of the board when emptied, rather than kept as an empty string. */
const OPTIONAL = new Set(['vendor', 'url', 'ip', 'host', 'spec', 'cableId', 'qty', 'watts', 'price']);

/** Whether a cell of this table can be edited: never in a total row, and `single` columns on one-item rows only. */
export function editable(t: Table, row: number, col: number): CellEdit | null {
  const edit = t.edit?.[t.head[col]];
  if (!edit || (t.total && row === t.rows.length - 1) || !t.refs[row]?.length) return null;
  return edit.single && t.refs[row].length > 1 ? null : edit;
}

/** The board with one list cell's new value written to everything behind its row. */
export function editCell(doc: Doc, edit: CellEdit, ids: string[], raw: string): Doc {
  const text = raw.trim();
  let value: unknown = text;
  if (edit.kind === 'number') {
    // Figures as they are typed in Japanese: full-width, "120,000", "¥3,500", "3,500円", "10m".
    const plainNum = text.normalize('NFKC').replace(/[,¥￥\s]|円$|m$|W$/gi, '');
    let n = Number(plainNum);
    if (text && (!plainNum || !Number.isFinite(n))) return doc;
    // A quantity is a whole number of units, one at least; none typed means the name's own.
    if (edit.field === 'qty' && text) {
      n = Math.round(n);
      if (n < 1) return doc;
    }
    // Lengths, prices and power are never below zero.
    if (text && n < 0) return doc;
    value = text ? n : edit.field === 'length' ? null : undefined;
  } else if (!text && OPTIONAL.has(edit.field)) value = undefined;
  const hit = new Set(ids);
  if (edit.on === 'edge') {
    return {
      ...doc,
      edges: doc.edges.map((e) => {
        if (!hit.has(e.id)) return e;
        // Typing the automatic number back in leaves the cable on automatic numbering.
        if (edit.field === 'cableId' && value === cableIds(doc).get(e.id) && !e.cableId) return e;
        return { ...e, [edit.field]: value };
      }),
    };
  }
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (!hit.has(n.id)) return n;
      // Other nodes take only a new name from a list.
      if (n.type !== 'device') return edit.field === 'text' && text && 'text' in n ? ({ ...n, text } as Node) : n;
      if (edit.field === 'text') {
        // The list shows the name without its "x2": a quantity that came from the name stays.
        const units = unitsOf(n);
        if (!text || text === units.name) return n;
        return { ...n, text, qty: n.qty ?? (units.count > 1 ? units.count : undefined) };
      }
      // Power is listed for all the units a device stands for; it is kept per unit.
      if (edit.field === 'watts' && typeof value === 'number') return { ...n, watts: value / unitsOf(n).count };
      return { ...n, [edit.field]: value };
    }),
  };
}

/**
 * The full board behind a list. A part cut out for export keeps neither the areas around its
 * devices nor the colour key, so locations and groups are read from the board it came from.
 */
const boardOf = (doc: Doc): Doc => doc.whole ?? doc;
const placeOf = (doc: Doc, n: Node): string => frameOf(boardOf(doc), n)?.text ?? '';

const devices = (doc: Doc): DeviceNode[] => doc.nodes.filter((n): n is DeviceNode => n.type === 'device');

/** Text as one line: line breaks become spaces. */
const oneLine = (text: string): string => text.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');

/** "Speaker x2" on the board is two speakers in the list: the name without its multiplier, and the count. */
const issueCache = new WeakMap<Doc, Map<string, 'dup' | 'bad'>>();
/**
 * IP addresses worth a second look: one given to two devices on the board, or something typed as
 * an IPv4 address that cannot be one (192.168.0.256, a missing part). Anything else typed there
 * (an IPv6 address, "DHCP") is taken as it stands.
 */
export function ipIssues(doc: Doc): Map<string, 'dup' | 'bad'> {
  const hit = issueCache.get(doc);
  if (hit) return hit;
  const out = new Map<string, 'dup' | 'bad'>();
  const owners = new Map<string, string[]>();
  for (const n of (doc.whole ?? doc).nodes) {
    const ip = n.type === 'device' ? n.ip?.trim() : '';
    if (!ip) continue;
    const v4 = /^(\d+(?:\.\d+)*)(?:\/(\d+))?$/.exec(ip);
    if (v4) {
      const parts = v4[1].split('.');
      const ok = parts.length === 4 && parts.every((p) => Number(p) <= 255 && p.length <= 3) && (v4[2] == null || Number(v4[2]) <= 32);
      if (!ok) out.set(n.id, 'bad');
    }
    // Only addresses can clash: words written in their place ("DHCP", "自動", "未定") never do.
    if (!v4 && !ip.includes(':')) continue;
    // A prefix length does not make it another address: 10.0.0.5/24 and 10.0.0.5 clash.
    const key = ip.replace(/\/\d+$/, '').toLowerCase();
    owners.set(key, [...(owners.get(key) ?? []), n.id]);
  }
  // Pieces of software on one machine share its address: on a software board an address clashes
  // only between different hosts (or where no host is named).
  const soft = (doc.whole ?? doc).kind === 'software';
  const hostOf = (id: string): string => {
    const n = (doc.whole ?? doc).nodes.find((x) => x.id === id);
    return n?.type === 'device' ? (n.host?.trim().toLowerCase() ?? '') : '';
  };
  for (const ids of owners.values()) {
    if (ids.length < 2) continue;
    const hosts = new Set(ids.map(hostOf));
    if (soft && hosts.size === 1 && !hosts.has('')) continue;
    for (const id of ids) if (!out.has(id)) out.set(id, 'dup');
  }
  issueCache.set(doc, out);
  return out;
}

export function quantityOf(name: string): { name: string; count: number } {
  // A name broken over several lines on the board reads as one line in a list.
  const first = oneLine(name);
  // A latin x only counts when it stands apart ("Speaker x2"), so "Xbox 360", "DMX 512" and
  // "Matrix 4x4" keep their names; the multiplication sign may sit right after the name ("スピーカー×2").
  const m = /^(.*?)(?:\s+[xX]|\s*[×✕])\s*(\d{1,3})$/.exec(first.trim());
  return m && m[1] ? { name: m[1].trim(), count: Math.max(1, Number(m[2])) } : { name: first.trim(), count: 1 };
}

/** The device's name for the lists and how many units it stands for: its quantity if set, else the name's "x2". */
export function unitsOf(d: DeviceNode): { name: string; count: number } {
  const q = quantityOf(d.text);
  return d.qty ? { name: q.name, count: d.qty } : q;
}

/**
 * What a device colour stands for on this board, read off its hand-made key: a free-standing
 * shape (not wired, outside every area) in that colour whose text names the group, like
 * "既存機材" in white next to "新規購入機材" in red.
 */
export function colourKey(doc: Doc): Map<string, string> {
  const wired = new Set(doc.edges.flatMap((e) => [e.from.node, e.to.node]));
  const out = new Map<string, string>();
  const twice = new Set<string>();
  for (const n of doc.nodes) {
    if (n.type !== 'shape' || n.shape === 'cloud' || wired.has(n.id) || !n.text.trim() || frameOf(doc, n)) continue;
    if (out.has(n.color)) twice.add(n.color);
    out.set(n.color, n.text.split('\n')[0].trim());
  }
  // Two keys in one colour say nothing: better no group than a wrong one.
  for (const c of twice) out.delete(c);
  // A key only means something when devices actually use more than one of its colours.
  const used = new Set(devices(doc).map((d) => d.color ?? 'gray'));
  // One stray note in a colour the devices happen to share is not a key.
  return [...out.keys()].filter((c) => used.has(c as never)).length >= 2 ? out : new Map();
}

/** One row per distinct device (same name, maker and model) and group, with a quantity. */
export function equipmentTable(doc: Doc, withUrl = true): Table {
  const key = colourKey(boardOf(doc));
  // A supplier typed on the device wins over what its colour stands for.
  const groupOf = (d: DeviceNode): string => d.vendor?.trim() || key.get(d.color ?? 'gray') || '';
  const groups = new Map<string, { d: DeviceNode; ids: string[]; names: Set<string>; places: Set<string>; count: number; watts: number | null; prices: Set<number | null>; amount: number | null }>();
  // What the venue already has is not brought: it is on the drawing, not on the list.
  for (const d of devices(doc).filter((x) => !x.venue)) {
    const q = unitsOf(d);
    // Devices share a row only when they are the same thing under the same name: PC1 and PC2 of
    // one model stay apart, so each can be edited (and counted) on its own row.
    const id = `${groupOf(d)}|${d.category}|${q.name}|${d.maker}|${d.model}`;
    const place = placeOf(doc, d);
    const g = groups.get(id) ?? { d, ids: [], names: new Set<string>(), places: new Set<string>(), count: 0, watts: null, prices: new Set<number | null>(), amount: null };
    g.ids.push(d.id);
    g.names.add(q.name);
    if (place) g.places.add(place);
    g.count += q.count;
    if (d.watts != null) g.watts = (g.watts ?? 0) + d.watts * q.count;
    g.prices.add(d.price ?? null);
    if (d.price != null) g.amount = (g.amount ?? 0) + d.price * q.count;
    groups.set(id, g);
  }
  // Rows put in order by hand come first, in that order; the rest by category and name.
  const list = [...groups.values()].sort(
    byHand(
      doc,
      'equipment',
      (g) => g.ids,
      (a, b) => a.d.category.localeCompare(b.d.category, 'ja') || [...a.names][0].localeCompare([...b.names][0], 'ja') || groupOf(a.d).localeCompare(groupOf(b.d), 'ja'),
    ),
  );
  // The link of a model is whichever of its devices carries one.
  const urlOf = (ids: string[]): string => {
    for (const id of ids) {
      const n = doc.nodes.find((x) => x.id === id);
      const u = n?.type === 'device' ? safeUrl(n.url) : undefined;
      if (u) return u;
    }
    return '';
  };
  const notes = (ids: string[]): string => [...new Set(ids.map((id) => (doc.nodes.find((n) => n.id === id) as DeviceNode).note.trim()).filter(Boolean))].join(' / ');
  const total = list.reduce((sum, g) => sum + g.count, 0);
  const watts = list.reduce((sum, g) => sum + (g.watts ?? 0), 0);
  const amount = list.reduce((sum, g) => sum + (g.amount ?? 0), 0);
  // A unit price shows when every device on the row has the same one; the amount adds up what is known.
  const unit = (g: { prices: Set<number | null> }): string => (g.prices.size === 1 && [...g.prices][0] != null ? String([...g.prices][0]) : '');
  const cols = ['No', '区分', 'カテゴリ', '名称', 'メーカー', '型番', '数量', '単価(円)', '金額(円)', '設置場所', '消費電力(W)', '備考', ...(withUrl ? ['URL'] : [])];
  return {
    title: '機材リスト',
    head: cols,
    widths: [4, 10, 9, 18, 11, 14, 5, 9, 10, 12, 8, 16, ...(withUrl ? [18] : [])],
    rows: [
      ...list.map((g, i) => [
        String(i + 1),
        groupOf(g.d),
        g.d.category,
        [...g.names].join(' / '),
        g.d.maker,
        g.d.model,
        String(g.count),
        unit(g),
        g.amount == null ? '' : String(g.amount),
        [...g.places].join(' / '),
        g.watts == null ? '' : String(g.watts),
        notes(g.ids),
        ...(withUrl ? [urlOf(g.ids)] : []),
      ]),
      ...(list.length ? [cols.map((c) => (c === '名称' ? '合計' : c === '数量' ? String(total) : c === '金額(円)' && amount ? String(amount) : c === '消費電力(W)' && watts ? String(watts) : ''))] : []),
    ],
    refs: [...list.map((g) => g.ids), ...(list.length ? [[]] : [])],
    numeric: ['No', '数量', '単価(円)', '金額(円)', '消費電力(W)'],
    total: list.length > 0,
    reorder: 'equipment',
    edit: {
      区分: { on: 'node', field: 'vendor' },
      カテゴリ: { on: 'node', field: 'category' },
      名称: { on: 'node', field: 'text' },
      メーカー: { on: 'node', field: 'maker' },
      型番: { on: 'node', field: 'model' },
      数量: { on: 'node', field: 'qty', kind: 'number', single: true },
      '単価(円)': { on: 'node', field: 'price', kind: 'number' },
      '消費電力(W)': { on: 'node', field: 'watts', kind: 'number', single: true },
      備考: { on: 'node', field: 'note' },
      URL: { on: 'node', field: 'url' },
    },
  };
}

/** The node and the port at one end of a line, as they should read in a list. */
function endOf(doc: Doc, end: EdgeEnd): { name: string; port: string; place: string } {
  const n = doc.nodes.find((x) => x.id === end.node);
  if (!n) return { name: '?', port: '', place: '' };
  // Junction dots all carry the same word: their id tells them apart.
  const name = n.type === 'junction' ? `分岐点 ${n.id}` : oneLine(n.text) || n.id;
  const port = n.type === 'device' && end.port ? (n.ports.find((p) => p.id === end.port)?.name ?? '') : '';
  return { name, port, place: placeOf(doc, n) };
}

const cables = (doc: Doc): Edge[] => doc.edges.filter((e) => signalOf(e.signal).cable);

/** Cable IDs sort the way people read them: HDMI-2 before HDMI-10. */
const natural = (a: string, b: string): number => a.localeCompare(b, 'ja', { numeric: true });

export function cableTable(doc: Doc, withUrl = true): Table {
  const ids = cableIds(doc);
  const order = allSignals().map((s) => s.id);
  const list = [...cables(doc)].sort(byHand(doc, 'cables', (e) => [e.id], (a, b) => order.indexOf(a.signal) - order.indexOf(b.signal) || natural(ids.get(a.id) ?? '', ids.get(b.id) ?? '')));
  const total = list.reduce((sum, e) => sum + (e.length ?? 0), 0);
  const cols = ['ケーブルID', '種別', '品名・規格', 'From 機材', 'From ポート', 'To 機材', 'To ポート', '経路', '長さ(m)', 'ラベル', 'メーカー', '型番', '備考', ...(withUrl ? ['URL'] : [])];
  return {
    title: 'ケーブルリスト',
    head: cols,
    widths: [8, 7, 13, 16, 9, 16, 9, 12, 6, 9, 9, 10, 12, ...(withUrl ? [16] : [])],
    rows: [
      ...list.map((e) => {
        const from = endOf(doc, e.from);
        const to = endOf(doc, e.to);
        return [
          ids.get(e.id) ?? '',
          signalOf(e.signal).label,
          e.spec ?? '',
          from.name,
          from.port,
          to.name,
          to.port,
          // Where the cable runs: one area, or from one to another.
          from.place === to.place ? from.place : `${from.place || '（枠の外）'} → ${to.place || '（枠の外）'}`,
          e.length == null ? '' : String(e.length),
          e.label.replace(/\n/g, ' '),
          e.maker ?? '',
          e.model ?? '',
          e.note,
          ...(withUrl ? [safeUrl(e.url) ?? ''] : []),
        ];
      }),
      ...(list.length ? [cols.map((c) => (c === 'From 機材' ? `合計 ${list.length} 本` : c === '長さ(m)' && total ? String(total) : ''))] : []),
    ],
    refs: [...list.map((e) => [e.id]), ...(list.length ? [[]] : [])],
    numeric: ['長さ(m)'],
    total: list.length > 0,
    reorder: 'cables',
    edit: {
      ケーブルID: { on: 'edge', field: 'cableId' },
      種別: { on: 'edge', field: 'signal', kind: 'signal' },
      '品名・規格': { on: 'edge', field: 'spec' },
      '長さ(m)': { on: 'edge', field: 'length', kind: 'number' },
      ラベル: { on: 'edge', field: 'label' },
      メーカー: { on: 'edge', field: 'maker' },
      型番: { on: 'edge', field: 'model' },
      備考: { on: 'edge', field: 'note' },
      URL: { on: 'edge', field: 'url' },
    },
  };
}

/** Network settings: one row per device with an IP address or host name. */
export function networkTable(doc: Doc): Table {
  const list = devices(doc)
    .filter((d) => d.ip?.trim() || d.host?.trim())
    .sort(byHand(doc, 'network', (d) => [d.id], (a, b) => (a.ip ?? '\uffff').localeCompare(b.ip ?? '\uffff', 'en', { numeric: true }) || a.text.localeCompare(b.text, 'ja')));
  return {
    title: 'ネットワーク',
    head: ['名称', 'ホスト名', 'IP アドレス', 'メーカー', '型番', '設置場所', '備考'],
    widths: [20, 16, 14, 12, 14, 12, 16],
    rows: list.map((d) => [unitsOf(d).name, d.host ?? '', d.ip ?? '', d.maker, d.model, placeOf(doc, d), d.note]),
    refs: list.map((d) => [d.id]),
    reorder: 'network',
    edit: {
      名称: { on: 'node', field: 'text' },
      ホスト名: { on: 'node', field: 'host' },
      'IP アドレス': { on: 'node', field: 'ip' },
      メーカー: { on: 'node', field: 'maker' },
      型番: { on: 'node', field: 'model' },
      備考: { on: 'node', field: 'note' },
    },
  };
}

/** Shopping-list view: how many cables of each type, kind and length. */
export function cableSummaryTable(doc: Doc): Table {
  const groups = new Map<string, { e: Edge; ids: string[] }>();
  for (const e of cables(doc)) {
    const key = `${e.signal}|${e.spec ?? ''}|${e.maker ?? ''}|${e.model ?? ''}|${e.length ?? ''}`;
    const g = groups.get(key);
    if (g) g.ids.push(e.id);
    else groups.set(key, { e, ids: [e.id] });
  }
  const list = [...groups.values()].sort(
    byHand(
      doc,
      'summary',
      (g) => g.ids,
      (a, b) => a.e.signal.localeCompare(b.e.signal) || (a.e.spec ?? '').localeCompare(b.e.spec ?? '', 'ja') || (a.e.length ?? Infinity) - (b.e.length ?? Infinity),
    ),
  );
  return {
    title: 'ケーブル集計',
    head: ['種別', '品名・規格', 'メーカー', '型番', '長さ(m)', '本数', '合計長(m)'],
    widths: [14, 22, 14, 16, 10, 8, 12],
    rows: [
      ...list.map(({ e, ids }) => [
        signalOf(e.signal).label,
        e.spec ?? '',
        e.maker ?? '',
        e.model ?? '',
        e.length == null ? '未設定' : String(e.length),
        String(ids.length),
        e.length == null ? '' : String(e.length * ids.length),
      ]),
      ...(list.length ? [['合計', '', '', '', '', String(list.reduce((sum, g) => sum + g.ids.length, 0)), String(list.reduce((sum, g) => sum + (g.e.length ?? 0) * g.ids.length, 0))]] : []),
    ],
    refs: [...list.map((g) => g.ids), ...(list.length ? [[]] : [])],
    numeric: ['長さ(m)', '本数', '合計長(m)'],
    total: list.length > 0,
    reorder: 'summary',
    edit: {
      '品名・規格': { on: 'edge', field: 'spec' },
      メーカー: { on: 'edge', field: 'maker' },
      型番: { on: 'edge', field: 'model' },
      '長さ(m)': { on: 'edge', field: 'length', kind: 'number' },
    },
  };
}

/** CSV with BOM so Excel opens Japanese text correctly. */
export function toCsv(t: Table): string {
  // Text starting like a formula (+4dBu, -10dBV, =A1, @x) would be run by a spreadsheet: it is
  // kept as text with a leading apostrophe. Plain numbers stay numbers.
  const safe = (s: string): string => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
  const cell = (raw: string): string => {
    const s = safe(raw);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [t.head, ...t.rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export interface PowerLoad {
  /** Devices fed from this one. */
  ids: string[];
  watts: number;
  capacity: number | null;
  over: boolean;
}

const loadCache = new WeakMap<Doc, Map<string, PowerLoad>>();

/** What each power source (UPS, power strip …) feeds: device id → its load. */
export function powerLoads(doc: Doc): Map<string, PowerLoad> {
  // A UPS in a cut-out part still carries everything it feeds on the full board.
  if (doc.whole) return powerLoads(doc.whole);
  const hit = loadCache.get(doc);
  if (hit) return hit;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const power = doc.edges.filter((e) => e.signal === 'power');
  // A line into a junction dot goes on to everything the dot's lines lead to.
  const beyond = (id: string, seen: Set<string>): string[] => {
    if (byId.get(id)?.type !== 'junction') return byId.has(id) ? [id] : [];
    if (seen.has(id)) return [];
    seen.add(id);
    return power.filter((e) => e.from.node === id || e.to.node === id).flatMap((e) => beyond(e.from.node === id ? e.to.node : e.from.node, seen));
  };
  // What each device feeds directly, in the order the lines were drawn.
  const feeds = new Map<string, string[]>();
  for (const e of power) {
    if (byId.get(e.from.node)?.type !== 'device') continue;
    const list = feeds.get(e.from.node) ?? [];
    for (const to of beyond(e.to.node, new Set())) if (to !== e.from.node && !list.includes(to)) list.push(to);
    if (list.length) feeds.set(e.from.node, list);
  }
  const out = new Map<string, PowerLoad>();
  for (const [id, ids] of feeds) {
    const src = byId.get(id) as DeviceNode;
    const watts = ids.reduce((sum, d) => sum + powerDraw(byId, d, feeds, new Set([id])), 0);
    const capacity = src.capacity ?? null;
    out.set(id, { ids, watts, capacity, over: capacity != null && watts > capacity });
  }
  loadCache.set(doc, out);
  return out;
}

/**
 * What a device draws from the source it is plugged into: its own power for every unit it stands
 * for ("スピーカー x2"), and all that it feeds in turn (a power strip passes on its projectors').
 * A loop of power lines is followed once round.
 */
function powerDraw(byId: Map<string, Node>, id: string, feeds: Map<string, string[]>, seen: Set<string>): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const n = byId.get(id);
  const own = n?.type === 'device' && n.watts != null ? n.watts * unitsOf(n).count : 0;
  return own + (feeds.get(id) ?? []).reduce((sum, d) => sum + powerDraw(byId, d, feeds, seen), 0);
}

/** What a device draws, as shown on its row of the power table (its units and what it feeds included). */
export function drawOf(doc: Doc, id: string): number | null {
  const whole = doc.whole ?? doc;
  const n = whole.nodes.find((x) => x.id === id);
  const passes = powerLoads(whole).get(id);
  if (n?.type !== 'device' || (n.watts == null && !passes)) return null;
  return (n.watts ?? 0) * unitsOf(n).count + (passes?.watts ?? 0);
}

/** Power distribution: one row per fed device, with a total per source. */
export function powerTable(doc: Doc): Table {
  // Names come from the full board, since a source in a cut-out part may feed devices outside it.
  const byId = new Map((doc.whole ?? doc).nodes.map((n) => [n.id, n]));
  const shown = new Set(doc.nodes.map((n) => n.id));
  const name = (id: string): string => oneLine(byId.get(id)?.text ?? '') || id;
  const loads = powerLoads(doc);
  // Two sources of one name (an outlet in each room, two power strips) are told apart by where they are.
  const named = new Map<string, number>();
  for (const id of loads.keys()) named.set(name(id), (named.get(name(id)) ?? 0) + 1);
  const source = (id: string): string => {
    const n = byId.get(id);
    const place = n ? placeOf(doc, n) : '';
    return (named.get(name(id)) ?? 0) > 1 && place ? `${name(id)}（${place}）` : name(id);
  };
  const rows: string[][] = [];
  const refs: string[][] = [];
  const rowClass: (string | undefined)[] = [];
  for (const [id, load] of loads) {
    if (!shown.has(id)) continue;
    for (const d of load.ids) {
      const n = byId.get(d);
      const draw = n?.type === 'device' ? drawOf(doc, d) : null;
      rows.push([source(id), name(d), draw == null ? '' : String(draw), '', '']);
      refs.push([d]);
      rowClass.push('member');
    }
    // The sum closes each source's group, with how much of its capacity the load takes.
    const use = load.capacity ? ` · 使用率 ${Math.round((load.watts / load.capacity) * 100)}%` : '';
    const verdict = load.capacity == null ? '容量未設定' : load.over ? `超過 ${load.watts - load.capacity}W${use}` : `余裕 ${load.capacity - load.watts}W${use}`;
    rows.push([source(id), `合計 ${load.ids.length} 台`, String(load.watts), load.capacity == null ? '' : String(load.capacity), verdict]);
    refs.push([id]);
    rowClass.push(load.over ? 'subtotal over' : load.capacity == null ? 'subtotal unknown' : 'subtotal');
  }
  return { title: '電源系統', head: ['電源元', '接続機器', '消費電力(W)', '容量(W)', '判定'], widths: [22, 28, 14, 12, 24], rows, refs, rowClass, numeric: ['消費電力(W)', '容量(W)'] };
}

/**
 * The rows shaded to help the eye along a wide row, in the order they are shown: every other
 * row, or every other group where rows come in groups closed by a sum (the power list), so a
 * group reads as one. The total row stands apart on its own.
 */
export function bands(t: Table, order: number[] = t.rows.map((_, i) => i)): Set<number> {
  const grouped = !!t.rowClass?.some((c) => c?.startsWith('subtotal'));
  const out = new Set<number>();
  let n = 0;
  for (const i of order) {
    if (t.total && i === t.rows.length - 1) continue;
    if (n % 2 === 1) out.add(i);
    if (!grouped || t.rowClass?.[i]?.startsWith('subtotal')) n++;
  }
  return out;
}

/** The table without the columns nothing is written in, for print: an unused "URL" or "備考" only costs width. */
export function compact(t: Table): Table {
  const body = t.total ? t.rows.slice(0, -1) : t.rows;
  const keep = t.head.map((_, i) => body.some((row) => row[i].trim() !== ''));
  if (keep.every(Boolean) || !body.length) return t;
  const pick = <T,>(row: T[]): T[] => row.filter((_, i) => keep[i]);
  return { ...t, head: pick(t.head), widths: pick(t.widths), rows: t.rows.map(pick) };
}

/** Problems worth fixing before the drawing goes out, most serious first; each row selects what it is about. */
export function checkTable(doc: Doc): Table {
  const found: { level: 0 | 1; what: string; target: string; detail: string; ref: string[] }[] = [];
  const name = (id: string): string => {
    const n = doc.nodes.find((x) => x.id === id);
    return n ? (n.type === 'device' ? unitsOf(n).name : oneLine(n.text)) || id : id;
  };
  const ids = cableIds(doc);
  const portOf = (end: EdgeEnd) => {
    const n = doc.nodes.find((x) => x.id === end.node);
    return n?.type === 'device' ? n.ports.find((p) => p.id === end.port) : undefined;
  };
  const touches = (d: DeviceNode) => doc.edges.filter((e) => e.from.node === d.id || e.to.node === d.id);

  for (const [id, issue] of ipIssues(doc)) {
    const n = doc.nodes.find((x) => x.id === id) as DeviceNode | undefined;
    if (n) found.push({ level: 0, what: issue === 'dup' ? 'IP アドレスの重複' : 'IP アドレスの形式', target: name(id), detail: issue === 'dup' ? `${n.ip} がほかの機材と同じです` : `${n.ip} は IPv4 アドレスとして読めません`, ref: [id] });
  }
  for (const [id, load] of powerLoads(doc)) {
    if (load.over) found.push({ level: 0, what: '給電容量の超過', target: name(id), detail: `${load.watts}W / 容量 ${load.capacity}W（${load.watts - (load.capacity ?? 0)}W 超過）`, ref: [id, ...load.ids] });
  }
  // The same cable ID on two cables, which can only come from IDs typed by hand.
  const byId = new Map<string, string[]>();
  for (const [edge, cid] of ids) byId.set(cid, [...(byId.get(cid) ?? []), edge]);
  for (const [cid, edges] of byId) if (edges.length > 1) found.push({ level: 0, what: 'ケーブル ID の重複', target: cid, detail: `${edges.length} 本に同じ ID が付いています`, ref: edges });
  for (const e of doc.edges) {
    if (e.signal === 'flow') continue;
    // A generic "data" port (a new piece of software) takes any protocol, and any protocol line may meet it.
    const generic = (x: string) => x === 'data' && !!signalOf(e.signal).protocol;
    // WebSocket begins as an HTTP request and is upgraded on the same port: one listener on 443
    // takes both (a load balancer, a web server), so neither is a mismatch on the other's port.
    const upgrade = (x: string) => (x === 'http' && e.signal === 'websocket') || (x === 'websocket' && e.signal === 'http');
    const mismatch = [portOf(e.from), portOf(e.to)].filter((p) => p && p.signal !== e.signal && !generic(p.signal) && !upgrade(p.signal) && !(e.signal === 'data' && signalOf(p.signal).protocol));
    if (mismatch.length)
      found.push({ level: 0, what: '種別の不一致', target: ids.get(e.id) ?? `${name(e.from.node)} → ${name(e.to.node)}`, detail: `${signalOf(e.signal).label} のケーブルが ${mismatch.map((p) => (p!.name === signalOf(p!.signal).label ? p!.name : `${p!.name}（${signalOf(p!.signal).label}）`)).join('・')} につながっています`, ref: [e.id] });
  }
  for (const d of devices(doc)) {
    const powerIn = d.ports.filter((p) => p.side === 'left' && p.signal === 'power');
    const fed = touches(d).some((e) => e.signal === 'power' && (e.to.node === d.id || e.from.node === d.id));
    if (powerIn.length && !fed && touches(d).length) found.push({ level: 1, what: '電源が未接続', target: name(d.id), detail: `${powerIn.map((p) => p.name).join('・')} に電源がつながっていません`, ref: [d.id] });
    if (!touches(d).length) found.push({ level: 1, what: '接続のない機材', target: name(d.id), detail: 'どこにもつながっていません', ref: [d.id] });
    const feeding = [...powerLoads(doc)].find(([, l]) => l.ids.includes(d.id));
    // A power strip or supply passes on what it feeds: its draw is known without a figure of its own.
    if (feeding && d.watts == null && !powerLoads(doc).has(d.id)) found.push({ level: 1, what: '消費電力が未入力', target: name(d.id), detail: `${name(feeding[0])} の負荷の合計に入りません`, ref: [d.id] });
  }
  for (const [id, load] of powerLoads(doc)) {
    if (load.capacity == null) found.push({ level: 1, what: '給電容量が未入力', target: name(id), detail: `${load.ids.length} 台に給電していますが、容量がわからないため超過を判定できません`, ref: [id] });
  }
  // Once prices are being entered, the devices still without one, in one row.
  const all = devices(doc).filter((d) => !d.venue);
  const unpriced = all.filter((d) => d.price == null);
  if (unpriced.length && unpriced.length < all.length) {
    const names = [...new Set(unpriced.map((d) => unitsOf(d).name))];
    found.push({ level: 1, what: '単価が未入力', target: `${unpriced.length} 台`, detail: names.length > 6 ? `${names.slice(0, 6).join('、')} ほか ${names.length - 6} 件` : names.join('、'), ref: unpriced.map((d) => d.id) });
  }
  // Lengths are often filled in late, so the cables without one make a single row, not dozens.
  const unmeasured = cables(doc).filter((e) => e.length == null);
  if (unmeasured.length) {
    const list = unmeasured.map((e) => ids.get(e.id) ?? '').sort(natural);
    found.push({ level: 1, what: '長さが未入力', target: `${unmeasured.length} 本`, detail: list.length > 8 ? `${list.slice(0, 8).join('、')} ほか ${list.length - 8} 本` : list.join('、'), ref: unmeasured.map((e) => e.id) });
  }
  // Comments not settled yet: one row, the list of them is in the comments panel.
  const open = openComments(doc);
  if (open.length) found.push({ level: 1, what: '未解決のコメント', target: `${open.length} 件`, detail: open.slice(0, 4).map((n) => n.text.split('\n')[0].trim() || '（空の付箋）').join('、') + (open.length > 4 ? ` ほか ${open.length - 4} 件` : ''), ref: open.map((n) => n.id) });
  found.sort((a, b) => a.level - b.level);
  return {
    title: 'チェック',
    head: ['重要度', '項目', '対象', '内容'],
    widths: [8, 16, 20, 40],
    rows: found.map((f) => [f.level === 0 ? '要修正' : '確認', f.what, f.target, f.detail]),
    refs: found.map((f) => f.ref),
    rowClass: found.map((f) => (f.level === 0 ? 'warn' : 'note')),
    empty: '問題は見つかりませんでした。',
  };
}

/** "td-main（192.168.10.11）": where a piece of software runs, as far as the board says. */
function hostOf(doc: Doc, id: string): string {
  const n = doc.nodes.find((x) => x.id === id);
  if (n?.type !== 'device') return '';
  const host = n.host?.trim();
  const ip = n.ip?.trim();
  return host && ip ? `${host}（${ip}）` : host || ip || '';
}

/**
 * Communication on a software board, one row per line: who talks to whom, over what, on which
 * port. With the hosts and addresses beside each end, it is what a venue's network people ask
 * for before opening their firewall.
 */
export function commsTable(doc: Doc): Table {
  const order = allSignals().map((s) => s.id);
  const list = doc.edges
    .filter((e) => signalOf(e.signal).protocol)
    .sort(byHand(doc, 'comms', (e) => [e.id], (a, b) => order.indexOf(a.signal) - order.indexOf(b.signal) || endOf(doc, a.from).name.localeCompare(endOf(doc, b.from).name, 'ja')));
  return {
    title: '通信一覧',
    head: ['送信元', '送信元ホスト', '送信先', '送信先ホスト', 'プロトコル', 'ポート', '内容', '備考'],
    widths: [16, 16, 16, 16, 10, 10, 18, 16],
    rows: list.map((e) => {
      const from = endOf(doc, e.from);
      const to = endOf(doc, e.to);
      return [from.port ? `${from.name}（${from.port}）` : from.name, hostOf(doc, e.from.node), to.port ? `${to.name}（${to.port}）` : to.name, hostOf(doc, e.to.node), signalOf(e.signal).label, e.spec ?? '', e.label.replace(/\n/g, ' '), e.note];
    }),
    refs: list.map((e) => [e.id]),
    reorder: 'comms',
    empty: 'ソフト部品同士を線で結び、線の種別（HTTP・OSC …）とポートを入れるとここに並びます。',
    edit: {
      プロトコル: { on: 'edge', field: 'signal', kind: 'signal' },
      ポート: { on: 'edge', field: 'spec' },
      内容: { on: 'edge', field: 'label' },
      備考: { on: 'edge', field: 'note' },
    },
  };
}

/** Every list there is, by the key boards name them by (see kinds.ts). */
export const TABLES: Record<ListKey, { label: string; make: (doc: Doc) => Table }> = {
  equipment: { label: '機材リスト', make: (doc) => equipmentTable(doc) },
  cables: { label: 'ケーブルリスト', make: (doc) => cableTable(doc) },
  summary: { label: 'ケーブル集計', make: cableSummaryTable },
  power: { label: '電源系統', make: powerTable },
  network: { label: 'ネットワーク', make: networkTable },
  comms: { label: '通信一覧', make: commsTable },
  check: { label: 'チェック', make: checkTable },
};
