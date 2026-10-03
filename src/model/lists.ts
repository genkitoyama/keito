import { frameOf } from './geometry';
import { signalOf } from './signals';
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
export function equipmentTable(doc: Doc): Table {
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
  return {
    title: '機材リスト',
    head: ['No', 'カテゴリ', '名称', 'メーカー', '型番', '数量', '設置場所', '備考'],
    widths: [5, 12, 22, 14, 20, 6, 16, 22],
    rows: list.map((g, i) => [
      String(i + 1),
      g.d.category,
      g.d.model ? [...new Set(g.ids.map((id) => doc.nodes.find((n) => n.id === id)!.text))].join(' / ') : g.d.text,
      g.d.maker,
      g.d.model,
      String(g.ids.length),
      [...g.places].join(' / '),
      g.d.note,
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
