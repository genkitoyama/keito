import { frameOf } from './geometry';
import { signalOf } from './signals';
import { safeUrl } from './url';
import type { DeviceNode, Doc, Edge, EdgeEnd } from './types';

const pad2 = (n: number): string => String(n).padStart(2, '0');

const idCache = new WeakMap<Doc, Map<string, string>>();

/** Cable IDs (HDMI-01, LAN-03 …) numbered per signal type in edge order. */
export function cableIds(doc: Doc): Map<string, string> {
  const hit = idCache.get(doc);
  if (hit) return hit;
  const counters = new Map<string, number>();
  const out = new Map<string, string>();
  for (const e of doc.edges) {
    const s = signalOf(e.signal);
    if (!s.cable) continue;
    const n = (counters.get(s.id) ?? 0) + 1;
    counters.set(s.id, n);
    out.set(e.id, `${s.prefix}-${pad2(n)}`);
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
  /** Relative column widths for the drawing sheets. */
  widths: number[];
}

const devices = (doc: Doc): DeviceNode[] => doc.nodes.filter((n): n is DeviceNode => n.type === 'device');

/** One row per distinct (maker, model, name) with a quantity. */
export function equipmentTable(doc: Doc, withUrl = true): Table {
  const groups = new Map<string, { d: DeviceNode; ids: string[]; places: Set<string> }>();
  for (const d of devices(doc)) {
    const key = d.model ? `${d.maker}|${d.model}|${d.category}` : `|${d.text}|${d.category}`;
    const place = frameOf(doc, d)?.text ?? '';
    const g = groups.get(key);
    if (g) {
      g.ids.push(d.id);
      if (place) g.places.add(place);
    } else {
      groups.set(key, { d, ids: [d.id], places: new Set(place ? [place] : []) });
    }
  }
  const list = [...groups.values()].sort((a, b) => a.d.category.localeCompare(b.d.category, 'ja'));
  // The link of a model is whichever of its devices carries one.
  const urlOf = (ids: string[]): string => {
    for (const id of ids) {
      const n = doc.nodes.find((x) => x.id === id);
      const u = n?.type === 'device' ? safeUrl(n.url) : undefined;
      if (u) return u;
    }
    return '';
  };
  return {
    title: '機材リスト',
    head: ['No', 'カテゴリ', '名称', 'メーカー', '型番', '数量', '設置場所', '備考', ...(withUrl ? ['URL'] : [])],
    widths: [5, 12, 22, 14, 20, 6, 16, 22, ...(withUrl ? [24] : [])],
    rows: list.map((g, i) => [
      String(i + 1),
      g.d.category,
      g.d.model ? [...new Set(g.ids.map((id) => doc.nodes.find((n) => n.id === id)!.text))].join(' / ') : g.d.text,
      g.d.maker,
      g.d.model,
      String(g.ids.length),
      [...g.places].join(' / '),
      g.d.note,
      ...(withUrl ? [urlOf(g.ids)] : []),
    ]),
    refs: list.map((g) => g.ids),
  };
}

function endLabel(doc: Doc, end: EdgeEnd): string {
  const n = doc.nodes.find((x) => x.id === end.node);
  if (!n) return '?';
  const name = n.text.split('\n')[0] || n.id;
  const port = n.type === 'device' && end.port ? n.ports.find((p) => p.id === end.port)?.name : undefined;
  return port ? `${name} [${port}]` : name;
}

const cables = (doc: Doc): Edge[] => doc.edges.filter((e) => signalOf(e.signal).cable);

export function cableTable(doc: Doc): Table {
  const ids = cableIds(doc);
  const list = cables(doc);
  return {
    title: 'ケーブルリスト',
    head: ['ケーブルID', '種別', 'From', 'To', '長さ(m)', 'ラベル', '備考'],
    widths: [10, 10, 26, 26, 8, 14, 18],
    rows: list.map((e) => [
      ids.get(e.id) ?? '',
      signalOf(e.signal).label,
      endLabel(doc, e.from),
      endLabel(doc, e.to),
      e.length == null ? '' : String(e.length),
      e.label,
      e.note,
    ]),
    refs: list.map((e) => [e.id]),
  };
}

/** Shopping-list view: how many cables of each type and length. */
export function cableSummaryTable(doc: Doc): Table {
  const groups = new Map<string, { signal: string; length: number | null; ids: string[] }>();
  for (const e of cables(doc)) {
    const key = `${e.signal}|${e.length ?? ''}`;
    const g = groups.get(key);
    if (g) g.ids.push(e.id);
    else groups.set(key, { signal: e.signal, length: e.length, ids: [e.id] });
  }
  const list = [...groups.values()].sort(
    (a, b) => a.signal.localeCompare(b.signal) || (a.length ?? Infinity) - (b.length ?? Infinity),
  );
  return {
    title: 'ケーブル集計',
    head: ['種別', '長さ(m)', '本数', '合計長(m)'],
    widths: [30, 20, 20, 30],
    rows: list.map((g) => [
      signalOf(g.signal).label,
      g.length == null ? '未設定' : String(g.length),
      String(g.ids.length),
      g.length == null ? '' : String(g.length * g.ids.length),
    ]),
    refs: list.map((g) => g.ids),
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
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const name = (id: string): string => byId.get(id)?.text.split('\n')[0] ?? id;
  const rows: string[][] = [];
  const refs: string[][] = [];
  for (const [id, load] of powerLoads(doc)) {
    for (const d of load.ids) {
      const n = byId.get(d);
      rows.push([name(id), name(d), n?.type === 'device' && n.watts != null ? String(n.watts) : '', '', '']);
      refs.push([d]);
    }
    rows.push([name(id), `合計 ${load.ids.length} 台`, String(load.watts), load.capacity == null ? '' : String(load.capacity), load.capacity == null ? '' : load.over ? `超過 ${load.watts - load.capacity}` : `余裕 ${load.capacity - load.watts}`]);
    refs.push([id]);
  }
  return { title: '電源系統', head: ['電源元', '接続機器', '消費電力(W)', '容量(W)', '判定'], widths: [24, 30, 16, 14, 16], rows, refs };
}
