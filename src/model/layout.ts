import { nodeSize } from './geometry';
import type { Edge, Node, Rect } from './types';

const COL_GAP = 180;
const LOOSE = '\u0000loose';
const GAP_Y = 36;
const BAND_GAP = 90;
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
  for (const id of ids) if (!state.has(id)) visit(id);
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
 * Left-to-right layered layout. Nodes sharing an area are kept together in a
 * horizontal band so each area can be wrapped in a frame without overlaps.
 */
export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  areaOf: (id: string) => string,
  origin = { x: 80, y: 80 },
): LayoutResult {
  const ids = nodes.map((n) => n.id);
  const rank = ranks(ids, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map<string, { x: number; y: number }>();
  const areas = new Map<string, Rect>();

  // Unconnected, un-areaed nodes (stickies, sequence diagrams) go in a row of
  // their own instead of crowding the first column of the flow.
  const linked = new Set(edges.flatMap((e) => [e.from.node, e.to.node]));
  const bandOf = (id: string): string => areaOf(id) || (linked.has(id) ? '' : LOOSE);

  // Column x positions follow the widest node of each rank, shared by all bands.
  const colW = new Map<number, number>();
  for (const n of nodes) {
    if (bandOf(n.id) === LOOSE) continue;
    const r = rank.get(n.id)!;
    colW.set(r, Math.max(colW.get(r) ?? 0, nodeSize(n).w));
  }
  const colX = new Map<number, number>();
  let cx = origin.x;
  for (const r of [...colW.keys()].sort((a, b) => a - b)) {
    colX.set(r, cx);
    cx += colW.get(r)! + COL_GAP;
  }

  const bandNames: string[] = [];
  for (const n of nodes) {
    const a = bandOf(n.id);
    if (!bandNames.includes(a)) bandNames.push(a);
  }
  // Un-areaed nodes first, then each area as its own band.
  const order = (a: string): number => (a === '' ? 0 : a === LOOSE ? 2 : 1);
  bandNames.sort((a, b) => order(a) - order(b));

  let top = origin.y;
  for (const band of bandNames) {
    const members = nodes.filter((n) => bandOf(n.id) === band);
    if (band === LOOSE) {
      let x = origin.x;
      for (const n of members) {
        pos.set(n.id, { x, y: top });
        x += nodeSize(n).w + 60;
      }
      top += Math.max(...members.map((n) => nodeSize(n).h)) + BAND_GAP;
      continue;
    }
    const cols = new Map<number, Node[]>();
    for (const n of members) {
      const r = rank.get(n.id)!;
      const list = cols.get(r);
      if (list) list.push(n);
      else cols.set(r, [n]);
    }
    const colKeys = [...cols.keys()].sort((a, b) => a - b);
    const innerTop = top + (band ? FRAME_PAD.top : 0);
    const colHeight = (list: Node[]): number =>
      list.reduce((s, n) => s + nodeSize(n).h, 0) + GAP_Y * (list.length - 1);
    const bandH = Math.max(...colKeys.map((k) => colHeight(cols.get(k)!)));

    for (const k of colKeys) {
      const list = cols.get(k)!;
      // Order by the average y of already-placed neighbours to reduce crossings.
      const bary = (n: Node): number => {
        const ys: number[] = [];
        for (const e of edges) {
          const other = e.to.node === n.id ? e.from.node : e.from.node === n.id ? e.to.node : null;
          const p = other && pos.get(other);
          if (p) ys.push(p.y + nodeSize(byId.get(other)!).h / 2);
        }
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
      };
      const keyed = list.map((n, i) => ({ n, b: bary(n), i }));
      keyed.sort((a, b) => a.b - b.b || a.i - b.i);
      let y = innerTop + (bandH - colHeight(list)) / 2;
      for (const { n } of keyed) {
        pos.set(n.id, { x: colX.get(k)!, y: Math.round(y / 10) * 10 });
        y += nodeSize(n).h + GAP_Y;
      }
    }

    if (band) {
      const xs = members.map((n) => pos.get(n.id)!.x);
      const x1 = Math.max(...members.map((n) => pos.get(n.id)!.x + nodeSize(n).w));
      areas.set(band, {
        x: Math.min(...xs) - FRAME_PAD.x,
        y: top,
        w: x1 - Math.min(...xs) + FRAME_PAD.x * 2,
        h: FRAME_PAD.top + bandH + FRAME_PAD.bottom,
      });
      top += FRAME_PAD.top + bandH + FRAME_PAD.bottom + BAND_GAP;
    } else {
      top += bandH + BAND_GAP;
    }
  }
  return { pos, areas };
}
