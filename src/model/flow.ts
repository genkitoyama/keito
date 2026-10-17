import { freshId } from './presets';
import type { Doc, FlowSpec, Node, ShapeNode } from './types';

/**
 * Experience flow boards: the states an installation goes through (待機 → 検知 → 再生 → 終了) and
 * what moves it from one to the next. States are shapes marked with their part in the flow; the
 * arrows between them are the transitions, their labels the triggers ("人を検知", "60 秒経過").
 */

export type FlowNode = ShapeNode & { flow: FlowSpec };
export const isFlow = (n: Node): n is FlowNode => n.type === 'shape' && !!n.flow;

export const FLOW_LABEL: Record<FlowSpec['role'], string> = { start: '開始', state: '状態', branch: '判断', end: '終了' };

export interface FlowPart {
  key: string;
  name: string;
  role: FlowSpec['role'];
  hint: string;
}

export const FLOW_PARTS: FlowPart[] = [
  { key: 'start', name: '開始', role: 'start', hint: '起動したところ。ひとつだけ' },
  { key: 'idle', name: '待機', role: 'state', hint: '人を待っている状態' },
  { key: 'state', name: '状態', role: 'state', hint: '体験のひとつの段階' },
  { key: 'branch', name: '判断', role: 'branch', hint: '条件で行き先が分かれるところ' },
  { key: 'end', name: '終了', role: 'end', hint: '体験の終わり（待機に戻すなら矢印で）' },
];

/** A part of the flow as a shape at (x, y). */
export function makeFlowPart(p: FlowPart, x: number, y: number, taken: Set<string>): ShapeNode {
  const size = p.role === 'start' || p.role === 'end' ? [36, 36] : p.role === 'branch' ? [140, 80] : [160, 64];
  return {
    id: freshId(taken, p.role === 'start' ? 'start' : p.role === 'end' ? 'end' : p.role === 'branch' ? 'if' : 'st'),
    type: 'shape',
    shape: p.role === 'branch' ? 'diamond' : p.role === 'state' ? 'round' : 'ellipse',
    x,
    y,
    w: size[0],
    h: size[1],
    text: p.role === 'start' || p.role === 'end' ? '' : p.name,
    color: p.role === 'state' ? 'blue' : p.role === 'branch' ? 'yellow' : 'gray',
    fill: p.role === 'start' ? 'solid' : undefined,
    flow: { role: p.role },
  };
}

const nameOf = (n: FlowNode): string => (n.text.split('\n')[0].trim() || FLOW_LABEL[n.flow.role]);

export interface Transition {
  from: FlowNode;
  to: FlowNode;
  trigger: string;
  id: string;
}

export function transitions(doc: Doc): Transition[] {
  const byId = new Map(doc.nodes.filter(isFlow).map((n) => [n.id, n]));
  return doc.edges.flatMap((e) => {
    const from = byId.get(e.from.node);
    const to = byId.get(e.to.node);
    if (!from || !to) return [];
    const trigger = e.label.replace(/\n/g, ' ').trim();
    // An arrow with heads at both ends goes both ways.
    return e.arrow === 'both' ? [{ from, to, trigger, id: e.id }, { from: to, to: from, trigger, id: e.id }] : [{ from, to, trigger, id: e.id }];
  });
}

export interface FlowIssue {
  level: 0 | 1;
  what: string;
  target: string;
  detail: string;
  ref: string[];
}

/** What a flow is missing: a start, a way to reach every state, a way out of every state but the end. */
export function flowIssues(doc: Doc): FlowIssue[] {
  const parts = doc.nodes.filter(isFlow);
  if (!parts.length) return [];
  const out: FlowIssue[] = [];
  const moves = transitions(doc);
  const starts = parts.filter((n) => n.flow.role === 'start');
  if (!starts.length) out.push({ level: 0, what: '開始がない', target: '体験フロー', detail: '「開始」を置いて、最初の状態へ矢印を引いてください', ref: [] });
  if (starts.length > 1) out.push({ level: 1, what: '開始が複数', target: `${starts.length} か所`, detail: '起動したところはひとつにするのがふつうです', ref: starts.map((n) => n.id) });
  // Everything reachable from a start, following the arrows.
  const reached = new Set(starts.map((n) => n.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of moves)
      if (reached.has(m.from.id) && !reached.has(m.to.id)) {
        reached.add(m.to.id);
        grew = true;
      }
  }
  for (const n of parts) {
    if (n.flow.role === 'start') continue;
    if (starts.length && !reached.has(n.id)) out.push({ level: 0, what: 'たどり着けない状態', target: nameOf(n), detail: '開始から矢印をたどってもここに来ません', ref: [n.id] });
    if (n.flow.role !== 'end' && !moves.some((m) => m.from.id === n.id)) out.push({ level: 1, what: '出口のない状態', target: nameOf(n), detail: 'ここから次へ進む矢印がありません（止まったままになります）', ref: [n.id] });
    if (n.flow.role === 'branch' && moves.filter((m) => m.from.id === n.id).length < 2) out.push({ level: 1, what: '分かれない判断', target: nameOf(n), detail: '判断からの矢印が 1 本以下です', ref: [n.id] });
  }
  for (const m of moves) if (!m.trigger && m.from.flow.role !== 'start') out.push({ level: 1, what: 'きっかけが空', target: `${nameOf(m.from)} → ${nameOf(m.to)}`, detail: '矢印のラベルに、切り替わる条件を書いてください', ref: [m.id] });
  return out;
}

export { nameOf as flowName };
