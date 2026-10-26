import { nodeSize } from './geometry';
import type { Edge, Node, Rect } from './types';

const COL_GAP = 180;
const LOOSE = '\u0000loose';
const GAP_Y = 36;
const BAND_GAP = 90;
/** Space between one area's block and the next. */
const AREA_GAP = 80;
const FRAME_PAD = { x: 40, top: 60, bottom: 40 };

/** Longest-path rank per node, ignoring back edges so cycles can't blow up. */
function ranks(ids: string[], edges: Edge[]): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from.node === e.to.node) continue;
    const list = out.get(e.from.node);
    if (list) list.push(e.to.node);
    else out.set(e.from.node, [e.to.node]);
  }
  const rank = new Map(ids.map((id) => [id, 0]));
  const state = new Map<string, 1 | 2>();
  const order: string[] = [];
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of out.get(id) ?? []) {
      if (!rank.has(next)) continue;
      if (state.get(next) === 1) back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
    order.push(id);
  };
  // Start where nothing leads in, so a loop is broken at its far end rather than where it was listed.
  const fed = new Set(edges.map((e) => e.to.node));
  for (const id of [...ids.filter((id) => !fed.has(id)), ...ids]) if (!state.has(id)) visit(id);
  // Reverse post-order is a topological order once back edges are dropped.
  for (const id of order.reverse()) {
    for (const next of out.get(id) ?? []) {
      if (!rank.has(next) || back.has(`${id}>${next}`)) continue;
      rank.set(next, Math.max(rank.get(next)!, rank.get(id)! + 1));
    }
  }
  return rank;
}

export interface LayoutResult {
  pos: Map<string, { x: number; y: number }>;
  /** Bounding frame per area name. */
  areas: Map<string, Rect>;
}

/**
 * Left-to-right layered layout. Each area is a column block, the areas set out left to right in the
 * order the flow passes through them (the lines between them taken the way most of them go), so a layered system —
 * clients, edge, servers, data, outside services — reads across as it is built. Within an area its
 * nodes keep their own ranks as sub-columns, each stacked top to bottom in the order of what they
 * connect to, to cross as little as can be. Nodes in no area form a column block of their own
 * where the flow puts them; loose ones (notes, sequence diagrams) go in a row underneath.
 */
export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  areaOf: (id: string) => string,
  origin = { x: 80, y: 80 },
): LayoutResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map<string, { x: number; y: number }>();
  const areas = new Map<string, Rect>();

  // Unconnected, un-areaed nodes (stickies, sequence diagrams) go in a row of
  // their own instead of crowding the first column of the flow.
  const linked = new Set(edges.flatMap((e) => [e.from.node, e.to.node]));
  const blockOf = (id: string): string => areaOf(id) || (linked.has(id) ? '' : LOOSE);

  const blocks = new Map<string, Node[]>();
  for (const n of nodes) {
    const b = blockOf(n.id);
    blocks.set(b, [...(blocks.get(b) ?? []), n]);
  }
  const loose = blocks.get(LOOSE) ?? [];
  blocks.delete(LOOSE);
  // Areas in the order the flow passes through them: each area one step, a line between two areas
  // an edge (a loop between them broken as listed), ties as listed.
  const names = [...blocks.keys()];
  // Between two areas the way most lines go is the flow: a reply the other way (a worker taking
  // jobs off a queue, a webhook coming back) does not turn the two around.
  const count = new Map<string, number>();
  const pairs = edges.map((e) => [blockOf(e.from.node), blockOf(e.to.node)] as const).filter(([a, b]) => a !== b);
  for (const [a, b] of pairs) count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
  const between = pairs.filter(([a, b]) => count.get(`${a}>${b}`)! >= (count.get(`${b}>${a}`) ?? 0)).map(([a, b]) => ({ from: { node: a }, to: { node: b } }) as Edge);
  const areaRank = ranks(names, between);
  const order = names.map((b, i) => ({ b, r: areaRank.get(b)!, i })).sort((p, q) => p.r - q.r || p.i - q.i).map((x) => x.b);

  const colHeight = (list: Node[]): number => list.reduce((s, n) => s + nodeSize(n).h, 0) + GAP_Y * Math.max(0, list.length - 1);
  // Where a node's neighbours already placed sit, on average: its place in its column.
  const bary = (n: Node): number => {
    const ys: number[] = [];
    for (const e of edges) {
      const other = e.to.node === n.id ? e.from.node : e.from.node === n.id ? e.to.node : null;
      const p = other && pos.get(other);
      if (p) ys.push(p.y + nodeSize(byId.get(other)!).h / 2);
    }
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
  };

  let left = origin.x;
  let bottom = origin.y;
  for (const block of order) {
    const members = blocks.get(block)!;
    // The block's own columns: what follows what within it, so parts that only meet across areas
    // stand in one column rather than spread out.
    const inner = new Set(members.map((n) => n.id));
    const local = ranks([...inner], edges.filter((e) => inner.has(e.from.node) && inner.has(e.to.node)));
    const own = [...new Set(members.map((n) => local.get(n.id)!))].sort((p, q) => p - q);
    const cols = own.map((r) => members.filter((n) => local.get(n.id) === r));
    const pad = block ? FRAME_PAD : { x: 0, top: 0, bottom: 0 };
    const innerTop = origin.y + pad.top;
    let x = left + pad.x;
    let tallest = 0;
    for (const list of cols) {
      const keyed = list.map((n, i) => ({ n, b: bary(n), i })).sort((p, q) => p.b - q.b || p.i - q.i);
      let y = innerTop;
      for (const { n } of keyed) {
        pos.set(n.id, { x, y: Math.round(y / 10) * 10 });
        y += nodeSize(n).h + GAP_Y;
      }
      tallest = Math.max(tallest, colHeight(list));
      x += Math.max(...list.map((n) => nodeSize(n).w)) + COL_GAP;
    }
    const right = x - COL_GAP + pad.x;
    if (block) areas.set(block, { x: left, y: origin.y, w: right - left, h: pad.top + tallest + pad.bottom });
    bottom = Math.max(bottom, origin.y + pad.top + tallest + pad.bottom);
    left = right + AREA_GAP;
  }

  let x = origin.x;
  const top = bottom + BAND_GAP;
  for (const n of loose) {
    pos.set(n.id, { x, y: top });
    x += nodeSize(n).w + 60;
  }
  return { pos, areas };
}
