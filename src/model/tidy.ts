import { anchorOf, center, frameOf, isTagged, nodeRect } from './geometry';
import { CLEAR } from './router';
import type { Doc, Edge, Node, Rect } from './types';

const COLUMN = 60; // nodes whose centres are this close in x share a column
const FRAME_GAP = 60; // space between area frames stacked in a column
const PAD = 40; // space between an area frame and what it holds
const EDGE = 120; // frame edges in neighbouring columns this close are made to line up
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
  const members = membersOf(doc);
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
        // Nothing to line up with: inside an area, keep the distance to the neighbour above (the
        // spacing is the author's, never tightened), or, when first in its column there, sit on
        // the nearest row the columns to the left already laid out.
        const mine = frameOf(doc, n);
        if (mine && prev && frameOf(doc, prev.before) === mine) y = prev.after.y + n.y - prev.before.y;
        else if (mine) {
          const tops = (members.get(mine.id) ?? []).filter((id) => column.get(id)! < index).map((id) => nodes.get(id)!.y);
          y = tops.reduce((best, top) => (Math.abs(top - n.y) < Math.abs(best - n.y) ? top : best), tops[0] ?? n.y);
        } else y = n.y;
      }
      if (prev) {
        const { before, after } = prev;
        const space = n.y - (before.y + nodeRect(before).h);
        // Inside an area the spacing between neighbours is the author's: it may grow, never shrink.
        const least = frameOf(doc, before) === frameOf(doc, n) ? space : Math.min(space, 80);
        const floor: number = after.y + nodeRect(after).h + least;
        if (y < floor) {
          // Neighbours in one area make room for each other. Across areas nothing gets shoved:
          // whoever caused the squeeze stays where it was instead.
          const mine = frameOf(doc, n);
          if (mine === frameOf(doc, before) && !frozen.has(n.id)) y = floor;
          // A frame nothing outside is wired to simply gets pushed down as a whole afterwards.
          else if (!(mine && y === n.y && free(doc, members, mine.id))) return { nodes, clash: y !== n.y ? n.id : before.id };
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

/** True when no line crosses the border of this frame, so moving it as a whole bends nothing. */
function free(doc: Doc, members: Map<string, string[]>, frame: string): boolean {
  const ids = new Set(members.get(frame) ?? []);
  return !doc.edges.some((e) => ids.has(e.from.node) !== ids.has(e.to.node));
}

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
  const placed: Node[] = [];
  for (const f of [...frames].sort((p, q) => nodes.get(p.id)!.y - nodes.get(q.id)!.y)) {
    let now = nodes.get(f.id)!;
    for (const g of placed) {
      const other = nodes.get(g.id)!;
      if (!free(doc, members, f.id) || !overlap(nodeRect(now), nodeRect(other)) || overlap(nodeRect(f), nodeRect(g))) continue;
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

/** Area frames that hold something and stand clear of every other frame, the ones we dare reshape. */
function plain(doc: Doc, nodes: Map<string, Node>, members: Map<string, string[]>): Node[] {
  const frames = doc.nodes.filter((n) => n.type === 'frame');
  return frames.filter((f) => members.has(f.id) && !frames.some((g) => g !== f && overlap(nodeRect(nodes.get(f.id)!), nodeRect(nodes.get(g.id)!))));
}

/** Frames that sit above one another, as columns from left to right, each sorted top to bottom. */
function stacks(frames: Node[], nodes: Map<string, Node>): Node[][] {
  const at = (f: Node) => nodeRect(nodes.get(f.id)!);
  const columns: Node[][] = [];
  for (const f of [...frames].sort((p, q) => at(p).x - at(q).x)) {
    const a = at(f);
    const home = columns.find((col) =>
      col.some((g) => {
        const b = at(g);
        return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) >= Math.min(a.w, b.w) / 2;
      }),
    );
    if (home) home.push(f);
    else columns.push([f]);
  }
  return columns.map((col) => col.sort((p, q) => at(p).y - at(q).y));
}

/** Apply a change, and take it back if it puts anything on top of something it was clear of. */
function attempt(doc: Doc, nodes: Map<string, Node>, change: () => void): void {
  const before = new Map(nodes);
  change();
  if (!collision(doc, nodes)) return;
  nodes.clear();
  for (const [id, n] of before) nodes.set(id, n);
}

const shift = (nodes: Map<string, Node>, ids: string[], dx: number, dy: number) => {
  if (!dx && !dy) return;
  for (const id of ids) nodes.set(id, { ...nodes.get(id)!, x: nodes.get(id)!.x + dx, y: nodes.get(id)!.y + dy });
};

/** Inside one area: centre each column of nodes on a common axis, and even out nearly even space between columns. */
function spread(nodes: Map<string, Node>, ids: string[]): void {
  const cx = (id: string) => center(nodeRect(nodes.get(id)!)).x;
  const columns: string[][] = [];
  let start = -Infinity;
  for (const id of [...ids].sort((p, q) => cx(p) - cx(q))) {
    if (cx(id) - start > COLUMN) {
      columns.push([]);
      start = cx(id);
    }
    columns[columns.length - 1].push(id);
  }
  for (const col of columns) {
    const axis = col.map(cx).sort((p, q) => p - q)[Math.floor((col.length - 1) / 2)];
    for (const id of col) shift(nodes, [id], Math.round(axis - cx(id)), 0);
  }
  const left = (col: string[]) => Math.min(...col.map((id) => nodes.get(id)!.x));
  const right = (col: string[]) => Math.max(...col.map((id) => nodes.get(id)!.x + nodeRect(nodes.get(id)!).w));
  // The space between columns is sized by hand for the labels in it: only even it out when it nearly is.
  const gaps = columns.slice(1).map((col, i) => left(col) - right(columns[i]));
  if (gaps.length < 2 || Math.max(...gaps) - Math.min(...gaps) > ROW_EVEN || Math.min(...gaps) <= 0) return;
  const aisle = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length / 10) * 10;
  for (const [i, col] of columns.entries()) if (i) shift(nodes, col, right(columns[i - 1]) + aisle - left(col), 0);
}

/**
 * Balance the area frames: the same margin around the contents of each, and frames stacked in a
 * column share a left edge, a width and the gap between them.
 */
function arrange(doc: Doc): Map<string, Node> {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const members = membersOf(doc);
  const frames = plain(doc, nodes, members);
  const whole = (f: Node) => [f.id, ...members.get(f.id)!];
  const right = (col: Node[]) => Math.max(...col.map((f) => nodes.get(f.id)!.x + nodeRect(nodes.get(f.id)!).w));
  const fit = (f: Node) => {
    const b = bounds(members.get(f.id)!.map((id) => nodes.get(id)!));
    const top = ((f as { fontSize?: number }).fontSize ?? 13) + 19 + PAD - 12;
    nodes.set(f.id, { ...f, x: b.x - PAD, y: b.y - top, w: b.w + PAD * 2, h: b.h + top + PAD } as Node);
  };
  for (const col of stacks(frames, nodes)) {
    for (const f of col) attempt(doc, nodes, () => fit(f));
    attempt(doc, nodes, () => {
      const edge = right(col);
      const beyond = doc.nodes.filter((n) => nodes.get(n.id)!.x >= edge && !col.some((f) => whole(f).includes(n.id))).map((n) => n.id);
      for (const f of col) {
        spread(nodes, members.get(f.id)!);
        fit(f);
      }
      const left = Math.min(...col.map((f) => nodes.get(f.id)!.x));
      for (const f of col) shift(nodes, whole(f), left - nodes.get(f.id)!.x, 0);
      const width = Math.max(...col.map((f) => nodeRect(nodes.get(f.id)!).w));
      for (const f of col) nodes.set(f.id, { ...nodes.get(f.id)!, w: width } as Node);
      // Whatever stood to the right keeps its distance from this column.
      shift(nodes, beyond, right(col) - edge, 0);
    });
    for (const [i, f] of col.entries()) {
      if (!i) continue;
      // Everything below comes along, so a frame that cannot close up still keeps its followers in step.
      const rest = col.slice(i).flatMap(whole);
      const above = nodeRect(nodes.get(col[i - 1].id)!);
      attempt(doc, nodes, () => shift(nodes, rest, 0, above.y + above.h + FRAME_GAP - nodes.get(f.id)!.y));
    }
  }
  return nodes;
}

/**
 * After levelling: frames in neighbouring columns whose tops or bottoms nearly meet are stretched
 * to line up, and frames nothing outside is wired to close up under the one above.
 */
function square(doc: Doc, nodes: Map<string, Node>, before: Doc): void {
  const was = (f: Node) => nodeRect(before.nodes.find((n) => n.id === f.id)!);
  const members = membersOf(doc);
  const frames = plain(doc, nodes, members);
  const columns = stacks(frames, nodes);
  const at = (f: Node) => nodeRect(nodes.get(f.id)!);
  const closeUp = () => {
    for (const col of columns) {
      for (const [i, f] of col.entries()) {
        const ids = members.get(f.id)!;
        if (!i || !free(doc, members, f.id)) continue;
        const above = at(col[i - 1]);
        attempt(doc, nodes, () => shift(nodes, [f.id, ...ids], 0, above.y + above.h + FRAME_GAP - at(f).y));
      }
    }
  };
  closeUp();
  for (const col of columns) {
    const others = columns.filter((c) => c !== col).flat();
    for (const f of col) {
      const r = at(f);
      // Frames that shared an edge before keep sharing it, however far the fitting pulled them apart.
      const tied = (g: Node, edge: (r: Rect) => number) => Math.abs(edge(was(g)) - edge(was(f))) <= 10;
      const tops = others.filter((g) => at(g).y < r.y && (r.y - at(g).y <= EDGE || tied(g, (q) => q.y))).map((g) => at(g).y);
      const bottoms = others
        .filter((g) => at(g).y + at(g).h > r.y + r.h && (at(g).y + at(g).h - (r.y + r.h) <= EDGE || tied(g, (q) => q.y + q.h)))
        .map((g) => at(g).y + at(g).h);
      const top = tops.length ? Math.min(...tops) : r.y;
      const bottom = bottoms.length ? Math.max(...bottoms) : r.y + r.h;
      if (top !== r.y) attempt(doc, nodes, () => nodes.set(f.id, { ...nodes.get(f.id)!, y: top, h: at(f).y + at(f).h - top } as Node));
      if (bottom !== r.y + r.h) attempt(doc, nodes, () => nodes.set(f.id, { ...nodes.get(f.id)!, h: bottom - at(f).y } as Node));
    }
  }
  closeUp();
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

/**
 * Lines between facing ports go back to automatic routing, which lays their bends side by side.
 * Other hand-made bends come along if both ends moved together, and are dropped otherwise.
 */
function comb(doc: Doc, nodes: Map<string, Node>): Edge[] {
  return doc.edges.map((e) => {
    if (isTagged(doc, e) || (!e.route && e.labelAt === undefined)) return e;
    const at = ends(nodes, e);
    if (!at) return e;
    const { pa, pb } = at;
    const facing = (l: typeof pa, r: typeof pa) => l.dir === 'right' && r.dir === 'left' && r.x - l.x >= CLEAR * 2;
    const { route, labelAt, ...rest } = e;
    if (facing(pa, pb) || facing(pb, pa)) return rest;
    const was = (id: string) => doc.nodes.find((n) => n.id === id)!;
    const da = { x: at.a.x - was(at.a.id).x, y: at.a.y - was(at.a.id).y };
    const db = { x: at.b.x - was(at.b.id).x, y: at.b.y - was(at.b.id).y };
    if (!da.x && !da.y && !db.x && !db.y) return e;
    if (route && da.x === db.x && da.y === db.y) return { ...e, route: route.map((p) => ({ x: p.x + da.x, y: p.y + da.y })) };
    return labelAt === undefined ? rest : { ...rest, labelAt };
  });
}

function pass(doc: Doc): Doc {
  const arranged = arrange(doc);
  const balanced = { ...doc, nodes: doc.nodes.map((n) => arranged.get(n.id)!), edges: comb(doc, arranged) };
  const nodes = settle(balanced);
  square(balanced, nodes, doc);
  rows(balanced, nodes);
  return { ...balanced, nodes: balanced.nodes.map((n) => nodes.get(n.id)!), edges: comb(balanced, nodes) };
}

/**
 * Tidy the whole board without rearranging it: balance the area frames, level nodes so lines run
 * straight, and lay parallel bends side by side so they neither overlap nor cross.
 */
export function tidy(doc: Doc): Doc {
  let next = doc;
  // One pass can open up room for the next; a handful settles any board.
  for (let i = 0; i < 6; i++) {
    const after = pass(next);
    if (JSON.stringify(after) === JSON.stringify(next)) break;
    next = after;
  }
  return JSON.stringify(next) === JSON.stringify(doc) ? doc : next;
}
