import { frameOf } from './geometry';
import { allSignals, signalOf } from './signals';
import { safeUrl } from './url';
import type { DeviceNode, Doc, Edge, EdgeEnd, Node } from './types';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Is this cable's ID written in its label on the board? */
export const idShown = (doc: Doc, e: Edge): boolean => e.showId ?? doc.cableIdLabels !== false;

export const lengthShown = (doc: Doc, e: Edge): boolean => e.showLength ?? doc.lengthLabels !== false;
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
  for (const e of doc.edges) {
    const s = signalOf(e.signal);
    if (!s.cable) continue;
    const n = (counters.get(s.id) ?? 0) + 1;
    counters.set(s.id, n);
    // A hand-typed ID replaces the automatic one; the numbering of the others is unaffected.
    out.set(e.id, e.cableId?.trim() || `${s.prefix}-${pad2(n)}`);
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
  return [...out.keys()].filter((c) => used.has(c as never)).length ? out : new Map();
}

/** One row per distinct model (or name, for devices without one) and group, with a quantity. */
export function equipmentTable(doc: Doc, withUrl = true): Table {
  const key = colourKey(boardOf(doc));
  // A supplier typed on the device wins over what its colour stands for.
  const groupOf = (d: DeviceNode): string => d.vendor?.trim() || key.get(d.color ?? 'gray') || '';
  const groups = new Map<string, { d: DeviceNode; ids: string[]; names: Set<string>; places: Set<string>; count: number; watts: number | null }>();
  for (const d of devices(doc)) {
    const q = unitsOf(d);
    const id = `${groupOf(d)}|${d.category}|${d.model ? `${d.maker}|${d.model}` : `|${q.name}`}`;
    const place = placeOf(doc, d);
    const g = groups.get(id) ?? { d, ids: [], names: new Set<string>(), places: new Set<string>(), count: 0, watts: null };
    g.ids.push(d.id);
    g.names.add(q.name);
    if (place) g.places.add(place);
    g.count += q.count;
    if (d.watts != null) g.watts = (g.watts ?? 0) + d.watts * q.count;
    groups.set(id, g);
  }
  const list = [...groups.values()].sort(
    (a, b) => a.d.category.localeCompare(b.d.category, 'ja') || [...a.names][0].localeCompare([...b.names][0], 'ja') || groupOf(a.d).localeCompare(groupOf(b.d), 'ja'),
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
  const cols = ['No', '区分', 'カテゴリ', '名称', 'メーカー', '型番', '数量', '設置場所', '消費電力(W)', '備考', ...(withUrl ? ['URL'] : [])];
  return {
    title: '機材リスト',
    head: cols,
    widths: [4, 11, 10, 20, 12, 16, 5, 13, 8, 18, ...(withUrl ? [20] : [])],
    rows: [
      ...list.map((g, i) => [
        String(i + 1),
        groupOf(g.d),
        g.d.category,
        [...g.names].join(' / '),
        g.d.maker,
        g.d.model,
        String(g.count),
        [...g.places].join(' / '),
        g.watts == null ? '' : String(g.watts),
        notes(g.ids),
        ...(withUrl ? [urlOf(g.ids)] : []),
      ]),
      ...(list.length ? [cols.map((c) => (c === '名称' ? '合計' : c === '数量' ? String(total) : c === '消費電力(W)' && watts ? String(watts) : ''))] : []),
    ],
    refs: [...list.map((g) => g.ids), ...(list.length ? [[]] : [])],
    numeric: ['No', '数量', '消費電力(W)'],
    total: list.length > 0,
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
  const list = [...cables(doc)].sort((a, b) => order.indexOf(a.signal) - order.indexOf(b.signal) || natural(ids.get(a.id) ?? '', ids.get(b.id) ?? ''));
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
  };
}

/** Network settings: one row per device with an IP address or host name. */
export function networkTable(doc: Doc): Table {
  const list = devices(doc)
    .filter((d) => d.ip?.trim() || d.host?.trim())
    .sort((a, b) => (a.ip ?? '\uffff').localeCompare(b.ip ?? '\uffff', 'en', { numeric: true }) || a.text.localeCompare(b.text, 'ja'));
  return {
    title: 'ネットワーク',
    head: ['名称', 'ホスト名', 'IP アドレス', 'メーカー', '型番', '設置場所', '備考'],
    widths: [20, 16, 14, 12, 14, 12, 16],
    rows: list.map((d) => [unitsOf(d).name, d.host ?? '', d.ip ?? '', d.maker, d.model, placeOf(doc, d), d.note]),
    refs: list.map((d) => [d.id]),
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
    (a, b) => a.e.signal.localeCompare(b.e.signal) || (a.e.spec ?? '').localeCompare(b.e.spec ?? '', 'ja') || (a.e.length ?? Infinity) - (b.e.length ?? Infinity),
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
  };
}

/** CSV with BOM so Excel opens Japanese text correctly. */
export function toCsv(t: Table): string {
  const cell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
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
  const out = new Map<string, PowerLoad>();
  for (const e of doc.edges) {
    if (e.signal !== 'power') continue;
    const src = byId.get(e.from.node);
    const dst = byId.get(e.to.node);
    if (src?.type !== 'device' || !dst) continue;
    const load = out.get(src.id) ?? { ids: [], watts: 0, capacity: src.capacity ?? null, over: false };
    if (!load.ids.includes(dst.id)) {
      load.ids.push(dst.id);
      load.watts += dst.type === 'device' ? (dst.watts ?? 0) : 0;
    }
    load.over = load.capacity != null && load.watts > load.capacity;
    out.set(src.id, load);
  }
  loadCache.set(doc, out);
  return out;
}

/** Power distribution: one row per fed device, with a total per source. */
export function powerTable(doc: Doc): Table {
  // Names come from the full board, since a source in a cut-out part may feed devices outside it.
  const byId = new Map((doc.whole ?? doc).nodes.map((n) => [n.id, n]));
  const shown = new Set(doc.nodes.map((n) => n.id));
  const name = (id: string): string => oneLine(byId.get(id)?.text ?? '') || id;
  const rows: string[][] = [];
  const refs: string[][] = [];
  for (const [id, load] of powerLoads(doc)) {
    if (!shown.has(id)) continue;
    for (const d of load.ids) {
      const n = byId.get(d);
      rows.push([name(id), name(d), n?.type === 'device' && n.watts != null ? String(n.watts) : '', '', '']);
      refs.push([d]);
    }
    rows.push([name(id), `合計 ${load.ids.length} 台`, String(load.watts), load.capacity == null ? '' : String(load.capacity), load.capacity == null ? '' : load.over ? `超過 ${load.watts - load.capacity}` : `余裕 ${load.capacity - load.watts}`]);
    refs.push([id]);
  }
  return { title: '電源系統', head: ['電源元', '接続機器', '消費電力(W)', '容量(W)', '判定'], widths: [24, 30, 16, 14, 16], rows, refs, numeric: ['消費電力(W)', '容量(W)'] };
}

/** The table without the columns nothing is written in, for print: an unused "URL" or "備考" only costs width. */
export function compact(t: Table): Table {
  const body = t.total ? t.rows.slice(0, -1) : t.rows;
  const keep = t.head.map((_, i) => body.some((row) => row[i].trim() !== ''));
  if (keep.every(Boolean) || !body.length) return t;
  const pick = <T,>(row: T[]): T[] => row.filter((_, i) => keep[i]);
  return { ...t, head: pick(t.head), widths: pick(t.widths), rows: t.rows.map(pick) };
}
