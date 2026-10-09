import { anchorOf, center, frameOf, isTagged, nodeRect } from './geometry';
import { collides } from './router';
import type { Doc, Edge, Node, Pt, Rect } from './types';

const COLUMN = 60; // nodes whose centres are this close in x share a column
const GAP = 24; // least space kept between neighbours in a column
const FRAME_GAP = 30; // space left between area frames pushed apart
const TRACK = 30; // distance between parallel bends
const CLEAR = 20; // straight run kept next to a port before a bend
const ROW_REACH = 200; // loose items further apart than this are not a row
const ROW_EVEN = 40; // gaps this close to each other are made equal

const isH = (dir: string) => dir === 'left' || dir === 'right';

/** Both ends of a line as they attach right now, or null when an end is missing. */
function ends(nodes: Map<string, Node>, e: Edge) {
  const a = nodes.get(e.from.node);
  const b = nodes.get(e.to.node);
  if (!a || !b || a === b) return null;
  const pa = anchorOf(a, e.from, center(nodeRect(b)));
  const pb = anchorOf(b, e.to, center(nodeRect(a)));
  return { a, b, pa, pb };
}

/**
 * Move each node up or down to the nearest spot where one of its lines runs straight.
 * Columns are settled left to right, so a node lines up with what feeds it from the left.
 */
function level(doc: Doc, frozen: Set<string>): { nodes: Map<string, Node>; clash: string | null } {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const items = doc.nodes.filter((n) => n.type !== 'frame');
  const lines = doc.edges.filter((e) => !isTagged(doc, e));
  const cx = (n: Node) => center(nodeRect(n)).x;

  const column = new Map<string, number>();
  const columns: Node[][] = [];
  let start = -Infinity;
  for (const n of [...items].sort((p, q) => cx(p) - cx(q))) {
    if (cx(n) - start > COLUMN) {
      columns.push([]);
      start = cx(n);
    }
    columns[columns.length - 1].push(n);
    column.set(n.id, columns.length - 1);
  }

  for (const [index, col] of columns.entries()) {
    const want = new Map<string, number>();
    for (const n of col) {
      if (frozen.has(n.id)) continue;
      const spots: number[] = [];
      for (const e of lines) {
        const other = e.from.node === n.id ? e.to.node : e.to.node === n.id ? e.from.node : null;
        if (!other || (column.get(other) ?? index) >= index) continue;
        const at = ends(nodes, e);
        if (!at || !isH(at.pa.dir) || !isH(at.pb.dir)) continue;
        const mine = e.from.node === n.id ? at.pa : at.pb;
        const theirs = e.from.node === n.id ? at.pb : at.pa;
        spots.push(n.y + theirs.y - mine.y);
      }
      if (!spots.length) continue;
      spots.sort((p, q) => p - q);
      // Already straight, or sitting evenly between an even number of lines: leave it.
      const settled =
        spots.some((s) => Math.abs(s - n.y) < 0.5) ||
        (spots.length % 2 === 0 && n.y >= spots[spots.length / 2 - 1] && n.y <= spots[spots.length / 2]);
      want.set(n.id, settled ? n.y : spots.reduce((best, s) => (Math.abs(s - n.y) < Math.abs(best - n.y) ? s : best)));
    }

    // Keep the order within the column and never squeeze neighbours closer than they were.
    const order = [...col].sort((p, q) => p.y - q.y);
    let prev: { before: Node; after: Node } | null = null;
    for (const n of order) {
      let y = want.get(n.id);
      if (y === undefined && frozen.has(n.id)) y = n.y;
      if (y === undefined) {
        // A node with nothing to line up with follows the one it is wired to in its own column.
        const partner = lines
          .map((e) => (e.from.node === n.id ? e.to.node : e.to.node === n.id ? e.from.node : ''))
          .find((id) => id !== n.id && column.get(id) === index && nodes.get(id)!.y !== doc.nodes.find((m) => m.id === id)!.y);
        const was = partner ? doc.nodes.find((m) => m.id === partner)! : null;
        y = n.y + (was ? nodes.get(was.id)!.y - was.y : 0);
      }
      if (prev) {
        const { before, after } = prev;
        const space = n.y - (before.y + nodeRect(before).h);
        const least = Math.min(space, frameOf(doc, before) === frameOf(doc, n) ? GAP : 80);
        const floor: number = after.y + nodeRect(after).h + least;
        if (y < floor) {
          // Neighbours in one area make room for each other. Across areas nothing gets shoved:
          // whoever caused the squeeze stays where it was instead.
          if (frameOf(doc, before) !== frameOf(doc, n) || frozen.has(n.id)) return { nodes, clash: y !== n.y ? n.id : before.id };
          y = floor;
        }
      }
      const moved: Node = y === n.y ? n : { ...n, y };
      nodes.set(n.id, moved);
      prev = { before: n, after: moved };
    }
  }
  return { nodes, clash: null };
}

const bounds = (list: Node[]): Rect => {
  const rects = list.map(nodeRect);
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
};

const membersOf = (doc: Doc): Map<string, string[]> => {
  const members = new Map<string, string[]>();
  for (const n of doc.nodes) {
    if (n.type === 'frame') continue;
    const f = frameOf(doc, n);
    if (f) members.set(f.id, [...(members.get(f.id) ?? []), n.id]);
  }
  return members;
};

/**
 * Stretch every area frame around its members again. A frame that grew into another one pushes
 * it down, but only if nothing outside is wired into the pushed frame: moving a frame that
 * other nodes line up with would just make them chase it on the next run.
 */
function refit(doc: Doc, nodes: Map<string, Node>): void {
  const members = membersOf(doc);
  const frames = doc.nodes.filter((n) => n.type === 'frame');
  for (const f of frames) {
    const ids = members.get(f.id);
    if (!ids) continue;
    const was = bounds(ids.map((id) => doc.nodes.find((n) => n.id === id)!));
    const now = bounds(ids.map((id) => nodes.get(id)!));
    const next = { ...f, x: f.x + now.x - was.x, y: f.y + now.y - was.y, w: f.w + now.w - was.w, h: f.h + now.h - was.h };
    if (next.x !== f.x || next.y !== f.y || next.w !== f.w || next.h !== f.h) nodes.set(f.id, next as Node);
  }
  const free = (f: Node) => {
    const ids = new Set(members.get(f.id) ?? []);
    return !doc.edges.some((e) => ids.has(e.from.node) !== ids.has(e.to.node));
  };
  const placed: Node[] = [];
  for (const f of [...frames].sort((p, q) => nodes.get(p.id)!.y - nodes.get(q.id)!.y)) {
    let now = nodes.get(f.id)!;
    for (const g of placed) {
      const other = nodes.get(g.id)!;
      if (!free(f) || !overlap(nodeRect(now), nodeRect(other)) || overlap(nodeRect(f), nodeRect(g))) continue;
      const dy = other.y + nodeRect(other).h + FRAME_GAP - now.y;
      now = { ...now, y: now.y + dy };
      nodes.set(f.id, now);
      for (const id of members.get(f.id) ?? []) nodes.set(id, { ...nodes.get(id)!, y: nodes.get(id)!.y + dy });
    }
    placed.push(f);
  }
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

/** The first pair of things that overlap now but did not before, or null when the layout is clean. */
function collision(doc: Doc, nodes: Map<string, Node>): [Node, Node] | null {
  for (const [i, a] of doc.nodes.entries()) {
    for (const b of doc.nodes.slice(i + 1)) {
      if (overlap(nodeRect(nodes.get(a.id)!), nodeRect(nodes.get(b.id)!)) && !overlap(nodeRect(a), nodeRect(b))) return [a, b];
    }
  }
  return null;
}

/** Level the nodes, giving up on one move at a time until nothing ends up on top of anything else. */
function settle(doc: Doc): Map<string, Node> {
  const members = membersOf(doc);
  const frozen = new Set<string>();
  for (let round = 0; round <= doc.nodes.length; round++) {
    const { nodes, clash } = level(doc, frozen);
    if (clash && !frozen.has(clash)) {
      frozen.add(clash);
      continue;
    }
    if (clash) break;
    const shift = (id: string) => Math.abs(nodes.get(id)!.y - doc.nodes.find((n) => n.id === id)!.y);
    const levelled = doc.nodes.filter((n) => n.type !== 'frame' && shift(n.id) > 0).map((n) => n.id);
    refit(doc, nodes);
    const hit = collision(doc, nodes);
    if (!hit) return nodes;
    // Blame the node that travelled furthest among those involved, or overall if none of them moved.
    const involved = hit.flatMap((n) => [n.id, ...(members.get(n.id) ?? [])]).filter((id) => levelled.includes(id));
    const culprit = (involved.length ? involved : levelled).sort((p, q) => shift(q) - shift(p))[0];
    if (!culprit) break;
    frozen.add(culprit);
  }
  return new Map(doc.nodes.map((n) => [n.id, n]));
}

/**
 * Loose items (notes, pictures, sequence diagrams, anything without a line) that sit roughly in a
 * row get a common top edge, and even gaps when the gaps were nearly even already.
 */
function rows(doc: Doc, nodes: Map<string, Node>): void {
  const wired = new Set(doc.edges.flatMap((e) => [e.from.node, e.to.node]));
  const loose = doc.nodes
    .filter((n) => n.type !== 'frame' && !wired.has(n.id) && !frameOf(doc, n))
    .map((n) => nodes.get(n.id)!)
    .sort((p, q) => p.x - q.x);
  const used = new Set<string>();
  for (const first of loose) {
    if (used.has(first.id)) continue;
    const row = [first];
    for (const n of loose) {
      if (n === first || used.has(n.id)) continue;
      const a = nodeRect(row[row.length - 1]);
      const b = nodeRect(n);
      const shared = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (b.x >= a.x + a.w && b.x - (a.x + a.w) <= ROW_REACH && shared >= Math.min(a.h, b.h) / 2) row.push(n);
    }
    if (row.length < 2) continue;
    for (const n of row) used.add(n.id);
    const top = Math.min(...row.map((n) => n.y));
    const gaps = row.slice(1).map((n, i) => n.x - (row[i].x + nodeRect(row[i]).w));
    const even = row.length > 2 && Math.max(...gaps) - Math.min(...gaps) <= ROW_EVEN;
    const gap = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length / 10) * 10;
    const before = new Map(nodes);
    let x = row[0].x;
    for (const n of row) {
      nodes.set(n.id, { ...n, x: even ? x : n.x, y: top });
      x += nodeRect(n).w + gap;
    }
    // Lining up must never put something on top of something else.
    if (collision({ ...doc, nodes: doc.nodes.map((n) => before.get(n.id)!) }, nodes)) for (const n of row) nodes.set(n.id, before.get(n.id)!);
  }
}

/** Roughly where the tag chip next to a port lands (the exact size depends on the font). */
function chip(at: Pt & { dir: string }, text: string): Rect {
  const w = 20 + [...text.split('\n')[0]].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 10 : 6), 0);
  if (at.dir === 'left') return { x: at.x - w, y: at.y - 8, w, h: 16 };
  if (at.dir === 'right') return { x: at.x, y: at.y - 8, w, h: 16 };
  return { x: at.x - w / 2, y: at.dir === 'top' ? at.y - 26 : at.y, w, h: 26 };
}

interface Run {
  e: Edge;
  /** The end on the left and the end on the right. */
  l: Pt;
  r: Pt;
  fromLeft: boolean;
}

const span = (u: Run): [number, number] => [Math.min(u.l.y, u.r.y), Math.max(u.l.y, u.r.y)];
const inside = (y: number, [lo, hi]: [number, number]) => y > lo + 0.5 && y < hi - 0.5;
/** Crossings between two runs when `u` bends to the left of `v`. */
const crossed = (u: Run, v: Run) => (inside(v.l.y, span(u)) ? 1 : 0) + (inside(u.r.y, span(v)) ? 1 : 0);

function permutations<T>(list: T[]): T[][] {
  if (list.length < 2) return [list];
  return list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
}

function ordered(group: Run[]): Run[] {
  const cost = (list: Run[]) => list.reduce((sum, u, i) => sum + list.slice(i + 1).reduce((s, v) => s + crossed(u, v), 0), 0);
  // Top to bottom is the tie-break, so equal layouts always come out the same.
  const base = [...group].sort((p, q) => p.r.y - q.r.y || p.l.y - q.l.y);
  if (base.length <= 6) return permutations(base).reduce((best, list) => (cost(list) < cost(best) ? list : best));
  const wins = (u: Run) => base.reduce((s, v) => s + (v === u ? 0 : crossed(v, u) - crossed(u, v)), 0);
  return base.sort((p, q) => wins(q) - wins(p));
}

/** Give lines that jog between two facing ports their own bend positions, side by side. */
function comb(doc: Doc, nodes: Map<string, Node>): Edge[] {
  const frames = doc.nodes.filter((n) => n.type === 'frame').map((n) => nodeRect(nodes.get(n.id)!));
  const obstacles = doc.nodes.filter((n) => n.type !== 'frame' && n.type !== 'text').map((n) => nodeRect(nodes.get(n.id)!));
  const routes = new Map<string, Pt[] | null>();
  const runs: Run[] = [];
  for (const e of doc.edges) {
    const at = ends(nodes, e);
    if (!at) continue;
    if (isTagged(doc, e)) {
      // A line drawn as tags leaves a chip beside each port; keep bends off those too.
      obstacles.push(chip(at.pa, `XXX-00 → ${at.b.text}`), chip(at.pb, `⚡ ${at.a.text} ${e.label}`));
      continue;
    }
    const { pa, pb } = at;
    const facing = (l: typeof pa, r: typeof pa) => l.dir === 'right' && r.dir === 'left' && r.x - l.x >= CLEAR * 2;
    if (!facing(pa, pb) && !facing(pb, pa)) {
      // Not ours to place: carry hand-made bends along if both ends moved together, else let it re-route.
      const was = (id: string) => doc.nodes.find((n) => n.id === id)!;
      const da = { x: at.a.x - was(at.a.id).x, y: at.a.y - was(at.a.id).y };
      const db = { x: at.b.x - was(at.b.id).x, y: at.b.y - was(at.b.id).y };
      if (!e.route || (!da.x && !da.y && !db.x && !db.y)) continue;
      routes.set(e.id, da.x === db.x && da.y === db.y ? e.route.map((p) => ({ x: p.x + da.x, y: p.y + da.y })) : null);
      continue;
    }
    routes.set(e.id, null);
    const fromLeft = facing(pa, pb);
    const run: Run = { e, l: fromLeft ? pa : pb, r: fromLeft ? pb : pa, fromLeft };
    if (Math.abs(run.l.y - run.r.y) >= 0.5) runs.push(run);
  }

  // Runs that could sit on top of each other are placed together.
  const group = runs.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (const [i, u] of runs.entries()) {
    for (const [j, v] of runs.entries()) {
      if (j <= i) continue;
      const [a0, a1] = span(u);
      const [b0, b1] = span(v);
      if (a0 < b1 && b0 < a1 && u.l.x + CLEAR < v.r.x - CLEAR && v.l.x + CLEAR < u.r.x - CLEAR) group[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Run[]>();
  for (const [i, u] of runs.entries()) groups.set(find(i), [...(groups.get(find(i)) ?? []), u]);

  for (const list of groups.values()) {
    const lo = Math.max(...list.map((u) => u.l.x)) + CLEAR;
    const hi = Math.min(...list.map((u) => u.r.x)) - CLEAR;
    const step = list.length > 1 ? Math.min(TRACK, (hi - lo) / (list.length - 1)) : 0;
    if (hi < lo || (list.length > 1 && step < 8)) continue;
    const order = ordered(list);
    const width = step * (list.length - 1);
    const mid = (lo + hi) / 2;
    const path = (u: Run, x: number): Pt[] => [u.l, { x, y: u.l.y }, { x, y: u.r.y }, u.r];
    let best: { score: number[]; first: number } | null = null;
    for (let c = Math.ceil((lo + width / 2) / 10) * 10; c <= hi - width / 2; c += 10) {
      const first = c - width / 2;
      const blocked = order.some((u, k) => collides(path(u, first + k * step), obstacles));
      // Bends read best in the open corridor between areas rather than inside one.
      const framed = order.reduce((sum, u, k) => {
        const p = { x: first + k * step, y: (u.l.y + u.r.y) / 2 };
        return sum + frames.filter((f) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h).length;
      }, 0);
      const score = [blocked ? 1 : 0, framed, Math.abs(c - mid)];
      const at = best ? score.findIndex((v, i) => v !== best!.score[i]) : 0;
      if (!best || (at >= 0 && score[at] < best.score[at])) best = { score, first };
    }
    if (!best || best.score[0]) continue;
    for (const [k, u] of order.entries()) {
      const x = best.first + k * step;
      const bends = [{ x, y: u.l.y }, { x, y: u.r.y }];
      routes.set(u.e.id, u.fromLeft ? bends : bends.reverse());
    }
  }

  return doc.edges.map((e) => {
    if (!routes.has(e.id)) return e;
    const { route: _route, labelAt: _labelAt, ...rest } = e;
    const route = routes.get(e.id);
    return route ? { ...rest, route } : rest;
  });
}

/**
 * Tidy the whole board without rearranging it: level nodes so lines run straight, refit the
 * area frames, and lay parallel bends side by side so they neither overlap nor cross.
 */
export function tidy(doc: Doc): Doc {
  const nodes = settle(doc);
  rows(doc, nodes);
  const edges = comb(doc, nodes);
  const next = { ...doc, nodes: doc.nodes.map((n) => nodes.get(n.id)!), edges };
  return JSON.stringify(next) === JSON.stringify(doc) ? doc : next;
}
