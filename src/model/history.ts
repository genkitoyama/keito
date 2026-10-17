import { cableIds, unitsOf } from './lists';
import { signalOf } from './signals';
import type { DeviceNode, Doc, Edge, Node, Revision } from './types';

/**
 * A board's history: states of the drawing kept beside it (the list in `Doc.revisions`, the
 * drawings themselves in the board's revisions folder). Most are taken on their own while the
 * board is worked on and thinned out as they age; a few carry a name given by hand ("先方提出")
 * and stay for good. Shared by the app and the command line.
 */

/** Unnamed states kept as they are; older ones are thinned to one a day. */
const RECENT_KEPT = 20;
const DAILY_DAYS = 30;

/** The drawing alone, as compared and kept: no history list, no write counter. */
export const drawingOf = (doc: Doc): Doc => ({ ...doc, revisions: undefined, serial: undefined });

/** A short fingerprint of a drawing, to tell whether two states are the same. */
export function fingerprint(doc: Doc): string {
  const s = JSON.stringify(drawingOf(doc));
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = (Math.imul(h2, 31) + c) | 0;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${s.length.toString(36)}`;
}

/** Entries recorded before history was automatic (A, B … with a note) become named states. */
export function upgradeHistory(list: Revision[] | undefined): Revision[] | undefined {
  if (!list?.some((r) => r.rev !== undefined)) return list;
  return list.map(({ rev, date, note, ...r }) => (rev === undefined ? r : { ...r, at: r.at ?? `${date ?? '1970-01-01'}T12:00:00`, name: r.name ?? (note ? `${rev}: ${note}` : `版 ${rev}`) }));
}

export interface Change {
  kind: '追加' | '削除' | '変更';
  what: string;
  /** For a change: which fields, before → after. */
  detail?: string;
}

export interface Diff {
  devices: Change[];
  cables: Change[];
  /** Shapes, notes, text, areas … counted only. */
  others: { added: number; removed: number; changed: number };
}

const DEVICE_FIELDS: [keyof DeviceNode, string][] = [
  ['text', '名称'],
  ['maker', 'メーカー'],
  ['model', '型番'],
  ['category', 'カテゴリ'],
  ['qty', '数量'],
  ['price', '単価'],
  ['watts', '消費電力'],
  ['capacity', '給電容量'],
  ['vendor', '手配先'],
  ['ip', 'IP'],
  ['host', 'ホスト名'],
  ['note', '備考'],
];
const CABLE_FIELDS: [keyof Edge, string][] = [
  ['signal', '種別'],
  ['spec', '品名・規格'],
  ['length', '長さ'],
  ['label', 'ラベル'],
  ['maker', 'メーカー'],
  ['model', '型番'],
  ['note', '備考'],
];

const shown = (v: unknown): string => (v === undefined || v === null || v === '' ? '（なし）' : String(v).replace(/\n/g, ' '));

/**
 * A node as compared: its place left out (moving is not a change worth listing), and values that
 * only spell out the default dropped, so a board read back from YAML ("tint" → unset) is the same.
 */
function plain(n: Node): string {
  const defaults: Record<string, unknown[]> = { fill: ['tint'], dash: [false], bold: [false], color: n.type === 'frame' ? ['gray'] : [] };
  const kept = Object.entries(n).filter(([k, v]) => k !== 'x' && k !== 'y' && v !== undefined && v !== '' && !(defaults[k] ?? []).includes(v));
  return JSON.stringify(Object.fromEntries(kept.sort(([a], [b]) => a.localeCompare(b))));
}

/** A device's ports as compared: by name, side and type (their ids may be renumbered). */
const portsOf = (d: DeviceNode): string => JSON.stringify(d.ports.map((p) => [p.name, p.side, p.signal]));

/** What changed from one state of a board to another, device by device and cable by cable. */
export function diff(before: Doc, after: Doc): Diff {
  const out: Diff = { devices: [], cables: [], others: { added: 0, removed: 0, changed: 0 } };
  const portName = (doc: Doc, x: Edge['from']): string => {
    const n = doc.nodes.find((y) => y.id === x.node);
    return n?.type === 'device' ? (n.ports.find((p) => p.id === x.port)?.name ?? '') : '';
  };
  const nameOf = (doc: Doc, id: string): string => {
    const n = doc.nodes.find((x) => x.id === id);
    return n ? (n.type === 'device' ? unitsOf(n).name : n.text.split('\n')[0]) || id : id;
  };
  const oldNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const newNodes = new Map(after.nodes.map((n) => [n.id, n]));
  for (const n of after.nodes) {
    const was = oldNodes.get(n.id);
    if (n.type === 'device') {
      if (was?.type !== 'device') out.devices.push({ kind: '追加', what: unitsOf(n).name });
      else {
        const fields = DEVICE_FIELDS.filter(([k]) => shown(was[k]) !== shown(n[k]));
        const ports = portsOf(was) !== portsOf(n);
        if (fields.length || ports)
          out.devices.push({ kind: '変更', what: unitsOf(n).name, detail: [...fields.map(([k, label]) => `${label}: ${shown(was[k])} → ${shown(n[k])}`), ...(ports ? ['ポート構成'] : [])].join('、') });
      }
    } else if (!was) out.others.added++;
    else if (plain(was) !== plain(n)) out.others.changed++;
  }
  for (const n of before.nodes) {
    if (newNodes.has(n.id)) continue;
    if (n.type === 'device') out.devices.push({ kind: '削除', what: unitsOf(n).name });
    else out.others.removed++;
  }
  // Cables by their IDs as numbered on each side, and the devices at their ends.
  const oldIds = cableIds(before);
  const newIds = cableIds(after);
  const label = (doc: Doc, ids: Map<string, string>, e: Edge): string => `${ids.get(e.id) ?? signalOf(e.signal).label}（${nameOf(doc, e.from.node)} → ${nameOf(doc, e.to.node)}）`;
  // Lines are matched by id, else by what they join (an id may change when YAML is applied).
  const end = (doc: Doc, x: Edge['from']) => `${x.node}.${portName(doc, x)}`;
  const key = (doc: Doc, e: Edge) => `${end(doc, e.from)}>${end(doc, e.to)}|${e.signal}`;
  const oldList = before.edges.filter((e) => e.signal !== 'flow');
  const newList = after.edges.filter((e) => e.signal !== 'flow');
  const pairs = new Map<Edge, Edge>();
  const used = new Set<Edge>();
  for (const e of newList) {
    const was = oldList.find((o) => o.id === e.id && !used.has(o) && key(before, o) === key(after, e));
    if (was) {
      pairs.set(e, was);
      used.add(was);
    }
  }
  for (const e of newList) {
    if (pairs.has(e)) continue;
    const was = oldList.find((o) => !used.has(o) && key(before, o) === key(after, e)) ?? oldList.find((o) => !used.has(o) && o.id === e.id);
    if (was) {
      pairs.set(e, was);
      used.add(was);
    }
  }
  for (const e of newList) {
    const was = pairs.get(e);
    if (!was) {
      out.cables.push({ kind: '追加', what: label(after, newIds, e) });
      continue;
    }
    const fields = CABLE_FIELDS.filter(([k]) => shown(was[k]) !== shown(e[k])).map(([k, l]) => `${l}: ${k === 'signal' ? signalOf(String(was[k])).label : shown(was[k])} → ${k === 'signal' ? signalOf(String(e[k])).label : shown(e[k])}`);
    const moved = end(before, was.from) !== end(after, e.from) || end(before, was.to) !== end(after, e.to);
    if (fields.length || moved) out.cables.push({ kind: '変更', what: label(after, newIds, e), detail: [...fields, ...(moved ? ['つなぎ先'] : [])].join('、') });
  }
  for (const e of oldList) if (!used.has(e)) out.cables.push({ kind: '削除', what: label(before, oldIds, e) });
  const flows = (doc: Doc) => doc.edges.filter((e) => e.signal === 'flow').map((e) => key(doc, e));
  const oldFlows = flows(before);
  const newFlows = flows(after);
  out.others.added += newFlows.filter((k) => !oldFlows.includes(k)).length;
  out.others.removed += oldFlows.filter((k) => !newFlows.includes(k)).length;
  return out;
}

/** A diff in a few words for the history list: "機材 追加2 変更1・ケーブル 変更3". */
export function summarize(d: Diff): string {
  const part = (label: string, list: Change[]): string => {
    const bits = (['追加', '削除', '変更'] as const).map((k) => [k, list.filter((c) => c.kind === k).length] as const).filter(([, n]) => n);
    return bits.length ? `${label} ${bits.map(([k, n]) => `${k}${n}`).join(' ')}` : '';
  };
  const other = d.others.added + d.others.removed + d.others.changed;
  const parts = [part('機材', d.devices), part('ケーブル', d.cables), other ? `図形など ${other}` : ''].filter(Boolean);
  return parts.join('・') || '配置の調整';
}

/** A diff written out for a message ("前回からの変更点"). */
export function describe(d: Diff): string {
  const lines: string[] = [];
  const section = (title: string, list: Change[]) => {
    if (!list.length) return;
    lines.push(`■ ${title}`);
    for (const c of list) lines.push(`・${c.kind}: ${c.what}${c.detail ? `（${c.detail}）` : ''}`);
  };
  section('機材', d.devices);
  section('ケーブル', d.cables);
  const o = d.others;
  if (o.added + o.removed + o.changed) lines.push(`■ そのほか（図形・メモ・矢印など）: 追加 ${o.added}・削除 ${o.removed}・変更 ${o.changed}`);
  return lines.join('\n') || '機材とケーブルに違いはありません（配置の調整だけ）。';
}

/**
 * Which unnamed states to keep: the most recent ones as they are, then the last of each day for a
 * month. Named states always stay. Returns the list to keep and the ids whose drawings can go.
 */
export function thin(list: Revision[], now = Date.now()): { keep: Revision[]; drop: string[] } {
  const auto = list.filter((r) => !r.name).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const recent = new Set(auto.slice(-RECENT_KEPT).map((r) => r.id));
  const daily = new Map<string, string>();
  for (const r of auto) {
    if (recent.has(r.id) || !r.at) continue;
    if (now - Date.parse(r.at) > DAILY_DAYS * 86400000) continue;
    daily.set(r.at.slice(0, 10), r.id);
  }
  const kept = new Set([...recent, ...daily.values()]);
  const keep = list.filter((r) => r.name || kept.has(r.id));
  return { keep, drop: list.filter((r) => !keep.includes(r)).map((r) => r.id) };
}

/** A new entry for the state `doc` is in, after `previous` (the state of the entry before). */
export function entryFor(doc: Doc, previous: Doc | null, id: string, extra: Partial<Revision> = {}): Revision {
  return { id, at: new Date().toISOString(), hash: fingerprint(doc), summary: previous ? summarize(diff(previous, doc)) : '記録を始めた時点', ...extra };
}

/** How a state is called in lists and headings: its name, else when it was taken ("10/17 14:32"). */
export function labelOf(r: Revision): string {
  if (r.name) return r.name;
  if (!r.at) return '日時不明';
  const t = new Date(r.at);
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}
