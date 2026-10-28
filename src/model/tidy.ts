import { deviceTagRects } from './badges';
import { anchorOf, captionBox, center, frameOf, frameTitles, isTagged, isUnderlay, nodeRect, obstaclesOf, portFronts, routeEdges, simplify, tagChips } from './geometry';
import { placeLabels } from './labels';
import { EDGE_ROOM, JOG, bordersOf, facing, isH, roomAround, routeClear, segmentsOf, trespass, unjog } from './router';
import { kindOf } from './kinds';
import type { Doc, Edge, Node, Port, Pt, Rect } from './types';

const COLUMN = 60; // nodes whose centres are this close in x share a column
const FRAME_GAP = 60; // space between area frames stacked in a column
const PAD = 40; // space between an area frame and what it holds
const EDGE = 120; // frame edges in neighbouring columns this close are made to line up
const ROW_REACH = 200; // loose items further apart than this are not a row
const ROW_EVEN = 40; // gaps this close to each other are made equal
const TRIM = 16; // least space between an area frame and the tags hanging off what it holds

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

/**
 * How far past its box each node's tags reach (the address and load tags above a device, the
 * tags beside ports whose lines are drawn as tags, a picture's caption), measured as laid out now.
 * A frame fitted round its members takes these in, so nothing hangs over its border.
 */
function reach(doc: Doc): Map<string, { l: number; t: number; r: number; b: number }> {
  const out = new Map<string, { l: number; t: number; r: number; b: number }>();
  const chips = tagChips(doc);
  for (const n of doc.nodes) {
    if (n.type === 'frame') continue;
    const box = nodeRect(n);
    const near = { x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 };
    const hung = [...(n.type === 'device' ? deviceTagRects(doc, n) : []), ...chips.filter((c) => overlap(c, near))];
    const caption = captionBox(n);
    if (caption) hung.push(caption);
    if (!hung.length) continue;
    out.set(n.id, {
      l: Math.max(0, box.x - Math.min(...hung.map((r) => r.x))),
      t: Math.max(0, box.y - Math.min(...hung.map((r) => r.y))),
      r: Math.max(0, Math.max(...hung.map((r) => r.x + r.w)) - (box.x + box.w)),
      b: Math.max(0, Math.max(...hung.map((r) => r.y + r.h)) - (box.y + box.h)),
    });
  }
  return out;
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

/**
 * The frames inside each frame, directly: an area within an area (subnets in a network). A frame is
 * within another when the whole of it is, not just its middle: a wide network's middle can fall
 * inside one of its own subnets.
 */
const nestedIn = (doc: Doc): Map<string, string[]> => {
  const frames = doc.nodes.filter((n) => n.type === 'frame');
  const holds = (o: Node, f: Node) => o.x <= f.x && o.y <= f.y && o.x + o.w >= f.x + f.w && o.y + o.h >= f.y + f.h;
  const inner = new Map<string, string[]>();
  for (const f of frames) {
    const outer = frames.filter((o) => o !== f && holds(o, f)).sort((p, q) => p.w * p.h - q.w * q.h)[0];
    if (outer) inner.set(outer.id, [...(inner.get(outer.id) ?? []), f.id]);
  }
  return inner;
};

/** Every frame inside this one, however deep. */
const within = (inner: Map<string, string[]>, id: string, seen = new Set<string>()): string[] => {
  if (seen.has(id)) return [];
  seen.add(id);
  return (inner.get(id) ?? []).flatMap((f) => [f, ...within(inner, f, seen)]);
};

/** The nodes in each frame, directly. */
const membersOf = (doc: Doc): Map<string, string[]> => {
  const members = new Map<string, string[]>();
  for (const n of doc.nodes) {
    if (n.type === 'frame') continue;
    const f = frameOf(doc, n);
    if (f) members.set(f.id, [...(members.get(f.id) ?? []), n.id]);
  }
  return members;
};

/** What each frame holds, its own nodes and those of the frames within it alike. */
const contentsOf = (doc: Doc): Map<string, string[]> => {
  const own = membersOf(doc);
  const inner = nestedIn(doc);
  const contents = new Map<string, string[]>();
  for (const f of doc.nodes) {
    if (f.type !== 'frame') continue;
    const ids = [f.id, ...within(inner, f.id)].flatMap((id) => own.get(id) ?? []);
    if (ids.length) contents.set(f.id, ids);
  }
  return contents;
};

/**
 * Stretch every area frame around its members again, the innermost first, so an area holding
 * others keeps its margin round them. A frame that grew into another one pushes
 * it down, but only if nothing outside is wired into the pushed frame: moving a frame that
 * other nodes line up with would just make them chase it on the next run.
 */
function refit(doc: Doc, nodes: Map<string, Node>): void {
  const members = contentsOf(doc);
  const own = membersOf(doc);
  const inner = nestedIn(doc);
  const frames = doc.nodes.filter((n) => n.type === 'frame');
  for (const f of [...frames].sort((p, q) => p.w * p.h - q.w * q.h)) {
    // What it holds directly, and the frames within it as they have just been fitted.
    const held = [...(own.get(f.id) ?? []), ...(inner.get(f.id) ?? [])];
    if (!members.has(f.id)) continue;
    const was = bounds(held.map((id) => doc.nodes.find((n) => n.id === id)!));
    const now = bounds(held.map((id) => nodes.get(id)!));
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
      // Everything it holds comes along, the frames within it too.
      for (const id of [...(members.get(f.id) ?? []), ...within(inner, f.id)]) nodes.set(id, { ...nodes.get(id)!, y: nodes.get(id)!.y + dy });
    }
    placed.push(f);
  }
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

/** The first pair of things that overlap now but did not before, or null when the layout is clean. */
function collision(doc: Doc, nodes: Map<string, Node>): [Node, Node] | null {
  const now = doc.nodes.map((n) => nodeRect(nodes.get(n.id)!));
  // Swept left to right, so only boxes that reach each other across are compared; the pair given
  // is the first in board order, as a plain loop over every pair would give.
  const order = now.map((_, i) => i).sort((p, q) => now[p].x - now[q].x);
  let first: [number, number] | null = null;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    for (let m = k + 1; m < order.length && now[order[m]].x < now[i].x + now[i].w - 1; m++) {
      const j = order[m];
      if (!overlap(now[i], now[j])) continue;
      const [a, b] = i < j ? [i, j] : [j, i];
      if (first && (a > first[0] || (a === first[0] && b >= first[1]))) continue;
      if (!overlap(nodeRect(doc.nodes[a]), nodeRect(doc.nodes[b]))) first = [a, b];
    }
  }
  return first && [doc.nodes[first[0]], doc.nodes[first[1]]];
}

/**
 * How tangled the wiring is: crossings and lines run through boxes count most, then stretches of
 * two lines lying on top of each other, then bends. Lower is cleaner.
 */
export function tangle(doc: Doc): number {
  let score = 0;
  for (const v of tangles(doc).values()) score += v;
  return score;
}

/** A straight piece of a line: across (`flat`) at y = `at`, or down at x = `at`, from `lo` to `hi`. */
interface Run {
  id: string;
  flat: boolean;
  at: number;
  lo: number;
  hi: number;
}

/** The tangle laid at each line's door: its own bends and boxes, and half of every crossing or overlap it is in. */
function tangles(doc: Doc): Map<string, number> {
  const routes = routeEdges(doc);
  const by = new Map<string, number>();
  const add = (id: string, v: number) => by.set(id, (by.get(id) ?? 0) + v);
  // An area's title is in the way as much as a box is.
  const boxes = [...doc.nodes.filter((n) => n.type !== 'frame' && n.type !== 'junction' && !isUnderlay(n)).map((n) => ({ id: n.id, r: nodeRect(n) })), ...frameTitles(doc).map((r) => ({ id: '', r }))];
  const runs: Run[] = [];
  const away = foreignAreas(doc);
  for (const e of doc.edges) {
    const pts = routes.get(e.id);
    if (!pts || isTagged(doc, e)) continue;
    // A line through an area it has no end in reads as part of what is in there.
    add(e.id, trespass(pts, away(e)) * AREA_COST);
    // A bend costs some of a crossing: a crossing drawn with a hop reads well, a line winding about
    // does not, so a way round trades at most two bends or so for each crossing it saves.
    add(e.id, Math.max(0, pts.length - 2) * BEND_COST);
    // A long way round costs too: some 500 px out of the way and back is worse than a crossing.
    const length = pts.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);
    const direct = Math.abs(pts[pts.length - 1].x - pts[0].x) + Math.abs(pts[pts.length - 1].y - pts[0].y);
    add(e.id, Math.max(0, length - direct - DETOUR_FREE) / 5);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      for (const { id, r } of boxes) {
        if (id === e.from.node || id === e.to.node) continue;
        if (seg.x < r.x + r.w - 2 && r.x + 2 < seg.x + seg.w && seg.y < r.y + r.h - 2 && r.y + 2 < seg.y + seg.h) add(e.id, 150);
        // Grazing a box is nearly as bad: the line reads as its edge.
        else if (seg.x < r.x + r.w + EDGE_ROOM && r.x - EDGE_ROOM < seg.x + seg.w && seg.y < r.y + r.h + EDGE_ROOM && r.y - EDGE_ROOM < seg.y + seg.h) add(e.id, 60);
      }
    }
    for (const seg of segmentsOf(pts)) runs.push({ id: e.id, ...seg });
  }
  const pair = (p: Run, q: Run, v: number) => {
    add(p.id, v / 2);
    add(q.id, v / 2);
  };
  // Runs across and runs down, each in order of where they lie, so only the ones that can meet are
  // compared (a board of a few hundred lines has thousands of runs).
  const flat = runs.filter((r) => r.flat).sort((p, q) => p.at - q.at);
  const tall = runs.filter((r) => !r.flat).sort((p, q) => p.at - q.at);
  const from = (list: Run[], at: number) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m].at < at) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  // A crossing anywhere along both, short of where either line ends or turns.
  for (const w of tall) {
    for (let k = from(flat, w.lo + 1); k < flat.length && flat[k].at < w.hi - 1; k++) {
      const h = flat[k];
      if (h.id !== w.id && h.at > w.lo + 1 && w.at > h.lo + 1 && w.at < h.hi - 1) pair(h, w, 100);
    }
  }
  // Two lines on top of each other for a stretch, or so close beside each other they read as one.
  // On top of each other is worse than a crossing.
  const ends = new Map<string, string[]>();
  for (const [id, pts] of routes) if (pts.length) ends.set(id, [pts[0], pts[pts.length - 1]].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
  const meet = (a: string, b: string) => ends.get(a)?.some((k) => ends.get(b)?.includes(k)) ?? false;
  for (const list of [flat, tall]) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].at - list[i].at < BESIDE; j++) {
        const p = list[i];
        const q = list[j];
        if (p.id === q.id) continue;
        const shared = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo);
        if (shared <= 4) continue;
        // Lines that meet at an end run in (or out) together on purpose: that is no tangle.
        if (meet(p.id, q.id)) continue;
        if (q.at - p.at >= 3) pair(p, q, shared / 10);
        else pair(p, q, 200 + shared * 2);
      }
    }
  }
  return by;
}

/** How far out of its way a line may go (round the back of a box, out of a port and in) at no cost. */
const DETOUR_FREE = 80;

/** What each pixel of a line through an area it has no end in costs, against a crossing's 100. */
const AREA_COST = 1;

/** The areas a line has neither end in, for each line. */
function foreignAreas(doc: Doc): (e: Edge) => Rect[] {
  const frames = doc.nodes.filter((n) => n.type === 'frame').map(nodeRect);
  const at = new Map(doc.nodes.map((n) => [n.id, center(nodeRect(n))]));
  const holds = (f: Rect, p?: { x: number; y: number }) => !!p && p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h;
  return (e) => (e.from.node === e.to.node ? [] : frames.filter((f) => !holds(f, at.get(e.from.node)) && !holds(f, at.get(e.to.node))));
}

/** What a bend in a line costs, against a crossing's 100. */
const BEND_COST = 55;

/** Lines closer side by side than this, running along together, read as one. */
const BESIDE = 9;

/** Lines this many and more are left as levelling makes them, as weighing every move would take too long. */
const WEIGH_UP_TO = 300;
/** The most lines one tidy routes afresh round the others. */
const UNTANGLE_AT_MOST = 12;

/**
 * Take back the moves of levelling that leave the wiring more tangled than they found it, the
 * furthest first, so lining one line up never costs a crossing or a line through a box elsewhere.
 */
function undoTangles(doc: Doc, nodes: Map<string, Node>): void {
  if (doc.edges.length >= WEIGH_UP_TO) return;
  const laid = (m: Map<string, Node>): Doc => ({ ...doc, nodes: doc.nodes.map((n) => m.get(n.id)!), edges: comb(doc, m) });
  const moved = doc.nodes.filter((n) => n.type !== 'frame' && nodes.get(n.id)!.y !== n.y).sort((p, q) => Math.abs(nodes.get(q.id)!.y - q.y) - Math.abs(nodes.get(p.id)!.y - p.y));
  let best = tangle(laid(nodes));
  for (const n of moved) {
    const trial = new Map(nodes);
    trial.set(n.id, { ...nodes.get(n.id)!, y: n.y });
    for (const f of doc.nodes) if (f.type === 'frame') trial.set(f.id, f);
    refit(doc, trial);
    if (collision(doc, trial)) continue;
    const score = tangle(laid(trial));
    if (score >= best) continue;
    best = score;
    nodes.clear();
    for (const [id, m] of trial) nodes.set(id, m);
  }
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
    if (!hit) {
      undoTangles(doc, nodes);
      // Moves that only pay off together are weighed together too: all of them, or none.
      if (doc.edges.length < WEIGH_UP_TO && tangle({ ...doc, nodes: doc.nodes.map((n) => nodes.get(n.id)!), edges: comb(doc, nodes) }) > tangle(doc)) break;
      return nodes;
    }
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

/**
 * Apply a change, and take it back if it puts anything on top of something it was clear of, or
 * (unless told the wiring is no matter) leaves the wiring more tangled than before.
 */
function attempt(doc: Doc, nodes: Map<string, Node>, change: () => void, wiring = true): void {
  const before = new Map(nodes);
  const laid = (m: Map<string, Node>): Doc => ({ ...doc, nodes: doc.nodes.map((n) => m.get(n.id)!), edges: comb(doc, m) });
  const weigh = wiring && doc.edges.length < WEIGH_UP_TO;
  const was = weigh ? tangle(laid(before)) : 0;
  change();
  if (!collision(doc, nodes) && (!weigh || tangle(laid(nodes)) <= was)) return;
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
  const hangs = reach(doc);
  const inner = nestedIn(doc);
  const fit = (f: Node) => {
    const list = [...(members.get(f.id) ?? []), ...(inner.get(f.id) ?? [])].map((id) => nodes.get(id)!);
    const b = bounds(list);
    const title = ((f as { fontSize?: number }).fontSize ?? 13) + 19;
    // The frame keeps its margin round the boxes, and at least a little more round their tags.
    const out = (n: Node) => hangs.get(n.id) ?? { l: 0, t: 0, r: 0, b: 0 };
    const x = Math.min(b.x - PAD, ...list.map((n) => n.x - out(n).l - TRIM));
    const y = Math.min(b.y - (title + PAD - 12), ...list.map((n) => n.y - out(n).t - title - 4));
    const right = Math.max(b.x + b.w + PAD, ...list.map((n) => n.x + nodeRect(n).w + out(n).r + TRIM));
    const bottom = Math.max(b.y + b.h + PAD, ...list.map((n) => n.y + nodeRect(n).h + out(n).b + TRIM));
    nodes.set(f.id, { ...f, x, y, w: right - x, h: bottom - y } as Node);
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
  // Areas within areas (subnets in a network) keep their place, but each is fitted too, the
  // innermost first, round what it holds and the areas within it.
  const contents = contentsOf(doc);
  const nested = doc.nodes.filter((f) => f.type === 'frame' && contents.has(f.id) && !frames.includes(f) && (inner.has(f.id) || frameOf(doc, f)));
  // Only a frame moves, so nothing is weighed but what it would run into: the lines keep off its
  // border wherever it ends up.
  for (const f of nested.sort((p, q) => p.w * p.h - q.w * q.h)) attempt(doc, nodes, () => fit(nodes.get(f.id)!), false);
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
 * Lines whose ends stay put are left as they are. Hand-made bends come along when both ends moved
 * together and otherwise stay where they were drawn. Automatic lines between facing ports lose any
 * label position they had, as their bends are laid side by side afresh.
 */
function comb(doc: Doc, nodes: Map<string, Node>): Edge[] {
  return doc.edges.map((e) => {
    if (isTagged(doc, e) || (!e.route && e.labelAt === undefined)) return e;
    const at = ends(nodes, e);
    if (!at) return e;
    const { pa, pb } = at;
    const { route, labelAt, ...rest } = e;
    const was = (id: string) => doc.nodes.find((n) => n.id === id)!;
    const da = { x: at.a.x - was(at.a.id).x, y: at.a.y - was(at.a.id).y };
    const db = { x: at.b.x - was(at.b.id).x, y: at.b.y - was(at.b.id).y };
    // A line whose ends stay put keeps the way the user drew it.
    if (!da.x && !da.y && !db.x && !db.y) return e;
    if (route && da.x === db.x && da.y === db.y) return { ...e, route: route.map((p) => ({ x: p.x + da.x, y: p.y + da.y })) };
    // Hand-placed bends stay: their outer bends follow the ends as drawn, and the drawing falls back
    // to automatic routing by itself once they no longer line up. Only automatic lines are relaid.
    if (route) return e;
    if (facing(pa, pb) || facing(pb, pa)) return rest;
    return labelAt === undefined ? rest : { ...rest, labelAt };
  });
}


/**
 * Give automatic lines that cross others a way round them: each is routed afresh keeping clear of
 * the lines already there, and the way is kept, as bends of its own, when it leaves the board less
 * tangled. The worst lines go first; the router alone lays every line as if it were the only one.
 * `earlier` holds the bends an earlier tidy laid, each line's tried again beside the new way.
 */
function untangle(doc: Doc, earlier: Map<string, Pt[]> = new Map()): Doc {
  if (doc.edges.length >= WEIGH_UP_TO) return doc;
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const obstacles = [...obstaclesOf(doc), ...tagChips(doc), ...frameTitles(doc)];
  const borders = bordersOf(doc.nodes.filter((n) => n.type === 'frame').map(nodeRect));
  const fronts = portFronts(doc);
  const away = foreignAreas(doc);
  const own = tangles(doc);
  let best = [...own.values()].reduce((sum, v) => sum + v, 0);
  // A crossing is shared between its two lines; the worst few are tried, as each try weighs the board.
  const tried = doc.edges
    .filter((e) => !e.route && !isTagged(doc, e) && nodes.get(e.from.node)?.type !== 'junction' && nodes.get(e.to.node)?.type !== 'junction')
    .map((e) => ({ e, cost: own.get(e.id) ?? 0 }))
    .filter((t) => t.cost >= 40)
    .sort((p, q) => q.cost - p.cost)
    .slice(0, UNTANGLE_AT_MOST);
  for (const { e } of tried) {
    const at = ends(nodes, e);
    if (!at) continue;
    const routes = routeEdges(doc);
    let next = doc;
    // The other lines, and the ways into the other ports: a line kept off those does not leave a
    // neighbour to step round it at the last moment.
    const own = (f: { node: string; port: string }) => (f.node === e.from.node && f.port === e.from.port) || (f.node === e.to.node && f.port === e.to.port);
    const segs = [...doc.edges.filter((x) => x.id !== e.id && !isTagged(doc, x)).flatMap((x) => segmentsOf(routes.get(x.id) ?? [])), ...fronts.filter((f) => !own(f)).map((f) => f.seg)];
    const found = routeClear(at.pa, at.pb, obstacles, segs, borders, away(e));
    // Any small step left in it taken out, keeping off every box but its own ends'.
    const fresh = found && simplify(unjog(found, roomAround(obstacles, [nodeRect(at.a), nodeRect(at.b)]))).slice(1, -1);
    // The way an earlier tidy laid it is tried too: the others laid afresh can leave it the better one.
    const ways = [fresh, earlier.get(e.id)].filter((r): r is Pt[] => !!r && r.length >= 2);
    for (const route of ways) {
      let trial = { ...doc, edges: doc.edges.map((x) => (x.id === e.id ? { ...x, route, tidied: true } : x)) };
      // Lines laid side by side with it are laid afresh without it: those keep the way they had.
      const after = routeEdges(trial);
      const same = (p: { x: number; y: number }[], q: { x: number; y: number }[] = []) => p.length === q.length && p.every((v, i) => v.x === q[i].x && v.y === q[i].y);
      trial = { ...trial, edges: trial.edges.map((x) => {
        const was = routes.get(x.id) ?? [];
        if (x.id === e.id || x.route || isTagged(doc, x) || was.length < 4 || same(was, after.get(x.id))) return x;
        const ends = [nodes.get(x.from.node), nodes.get(x.to.node)].filter((n): n is Node => !!n).map(nodeRect);
        return { ...x, route: simplify(unjog(was, roomAround(obstacles, ends))).slice(1, -1).map((p) => ({ x: p.x, y: p.y })), tidied: true };
      }) };
      const score = tangle(trial);
      if (score >= best) continue;
      best = score;
      next = trial;
    }
    doc = next;
  }
  return doc;
}

/**
 * On a board whose ports may move (software), each box's ports on a side are put in the order the
 * lines come in, top to bottom, so the lines run side by side into a box rather than across each
 * other in front of it. A box's new order is kept only when it leaves the wiring less
 * tangled; ports with nothing on them, or with bends drawn by hand, keep their places.
 */
function orderPorts(doc: Doc, only?: Set<string>): Doc {
  if (!kindOf(doc).freePorts || doc.edges.length >= WEIGH_UP_TO) return doc;
  let best = tangle(doc);
  // A box moved can change the order best for the boxes it leads to: a second sweep sees to those.
  for (let sweep = 0; sweep < 2; sweep++) {
    let changed = false;
    for (const { id } of doc.nodes) {
      const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
      const self = nodes.get(id)!;
      if (self.type !== 'device' || (only && !only.has(id))) continue;
      const routes = routeEdges(doc);
      // Which way a port's lines come in, on average: the height they run at before their last turn
      // into it (a line round the top of the board comes in from above, wherever its far end is).
      // Null for a port left as it is.
      const where = (port: Port): number | null => {
        const ends = doc.edges.flatMap((e) => {
          const far = e.from.node === id && e.from.port === port.id ? e.to : e.to.node === id && e.to.port === port.id ? e.from : null;
          return far ? [{ e, far, out: e.from.node === id }] : [];
        });
        if (!ends.length || ends.some(({ e, far }) => (e.route && !e.tidied) || far.node === id || !nodes.has(far.node))) return null;
        // Lines from one height: the one turning in nearest the box goes nearest that side (from above,
        // on top), so the others turn in round it rather than across it.
        const from = ({ e, out }: (typeof ends)[number]): number => {
          const pts = routes.get(e.id) ?? [];
          const run = out ? pts : [...pts].reverse();
          const level = run[0]?.y ?? 0;
          const turn = run.find((p) => Math.abs(p.y - level) > 0.5);
          if (!turn) return level;
          const near = Math.abs(turn.x - run[0].x) / 10000;
          return turn.y + (turn.y < level ? near : -near);
        };
        return ends.reduce((sum, end) => sum + from(end), 0) / ends.length;
      };
      let ports = self.ports;
      for (const side of ['left', 'right'] as const) {
        const slots = ports.flatMap((p, i) => {
          const y = p.side === side ? where(p) : null;
          return y === null ? [] : [{ p, i, y }];
        });
        const sorted = [...slots].sort((a, b) => a.y - b.y || a.i - b.i);
        if (sorted.every((s, k) => s === slots[k])) continue;
        const next = [...ports];
        for (const [k, s] of slots.entries()) next[s.i] = sorted[k].p;
        ports = next;
      }
      if (ports === self.ports) continue;
      const trial = { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...self, ports } : n)) };
      const score = tangle(trial);
      if (score >= best) continue;
      best = score;
      doc = trial;
      changed = true;
    }
    if (!changed) break;
  }
  return doc;
}

/**
 * On a board whose ports may move (software), a line between two boxes one above the other, out
 * of the right side of one and into the left side of the other, has to wind round in an S. With
 * one of its ports moved to the other side the two face the same way, and the line turns round
 * in a U with half the bends. Either end may move; the move is kept only when it leaves the wiring
 * less tangled. Ports with bends drawn by hand stay where they are.
 */
function turnPorts(doc: Doc): Doc {
  if (!kindOf(doc).freePorts || doc.edges.length >= WEIGH_UP_TO) return doc;
  let best = tangle(doc);
  for (const e of doc.edges) {
    if (isTagged(doc, e) || e.from.node === e.to.node) continue;
    const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
    const a = nodes.get(e.from.node);
    const b = nodes.get(e.to.node);
    if (a?.type !== 'device' || b?.type !== 'device') continue;
    const pa = a.ports.find((p) => p.id === e.from.port);
    const pb = b.ports.find((p) => p.id === e.to.port);
    if (!pa || !pb || pa.side === pb.side) continue;
    // One above the other: the boxes share some of their width.
    const ra = nodeRect(a);
    const rb = nodeRect(b);
    if (Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x) <= 0) continue;
    const handDrawn = (node: string, port: string) => doc.edges.some((x) => x.route && !x.tidied && ((x.from.node === node && x.from.port === port) || (x.to.node === node && x.to.port === port)));
    let pick: Doc | null = null;
    for (const [n, port, side] of [
      [a, pa, pb.side],
      [b, pb, pa.side],
    ] as const) {
      if (handDrawn(n.id, port.id)) continue;
      // The moved port goes last on its new side: ordering the ports afterwards finds it its place.
      const ports = [...n.ports.filter((p) => p.id !== port.id), { ...port, side }];
      // Bends tidying laid for lines on the moved port are laid afresh from its new place.
      const on = (x: Edge) => (x.from.node === n.id && x.from.port === port.id) || (x.to.node === n.id && x.to.port === port.id);
      const edges = doc.edges.map((x) => (on(x) && x.tidied ? (({ route: _r, tidied: _t, ...rest }) => rest)(x) : x));
      const trial = { ...doc, nodes: doc.nodes.map((m) => (m.id === n.id ? { ...n, ports } : m)), edges };
      const score = tangle(trial);
      if (score < best) {
        best = score;
        pick = trial;
      }
    }
    if (pick) doc = pick;
  }
  return doc;
}

/** How far tidying may nudge a box, up or down, to straighten out the lines round it. */
const NUDGES = [-20, -10, 10, 20];
/** The most rounds of nudging, one box moved in each. */
const NUDGE_ROUNDS = 4;

/**
 * Small moves levelling never makes: a box nudged up or down a little, so a line that grazes it,
 * steps round it or winds past it can run clear. Only the boxes at the ends of such lines, or in
 * their way, are tried; each round the one move that leaves the wiring least tangled is kept.
 */
function nudge(doc: Doc): Doc {
  if (doc.edges.length >= WEIGH_UP_TO) return doc;
  // A box moved leaves the bends tidying laid for its lines where they were: any small step that
  // leaves in them reads as a slip of the hand, and counts as much as a crossing.
  const weigh = (d: Doc) => {
    let steps = 0;
    for (const pts of routeEdges(d).values()) for (let i = 2; i < pts.length - 1; i++) if (Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y) < JOG) steps++;
    return tangle(d) + steps * 100;
  };
  let best = weigh(doc);
  for (let round = 0; round < NUDGE_ROUNDS; round++) {
    const routes = routeEdges(doc);
    const awkward = (pts: { x: number; y: number }[]) =>
      pts.length > 4 || pts.slice(2, -1).some((p, i) => Math.abs(p.x - pts[i + 1].x) + Math.abs(p.y - pts[i + 1].y) < JOG);
    const boxes = doc.nodes.filter((n) => n.type === 'device');
    const tried = new Set<string>();
    for (const e of doc.edges) {
      const pts = routes.get(e.id);
      if (!pts || isTagged(doc, e) || (e.route && !e.tidied) || !awkward(pts)) continue;
      tried.add(e.from.node);
      tried.add(e.to.node);
      // And the boxes it passes close by.
      for (const q of segmentsOf(pts)) {
        for (const n of boxes) {
          const r = nodeRect(n);
          const near = q.flat
            ? q.at > r.y - 30 && q.at < r.y + r.h + 30 && q.hi > r.x && q.lo < r.x + r.w
            : q.at > r.x - 30 && q.at < r.x + r.w + 30 && q.hi > r.y && q.lo < r.y + r.h;
          if (near) tried.add(n.id);
        }
      }
    }
    let pick: { doc: Doc; score: number } | null = null;
    for (const id of tried) {
      const n = doc.nodes.find((m) => m.id === id);
      if (!n || n.type !== 'device') continue;
      for (const dy of NUDGES) {
        const nodes = new Map(doc.nodes.map((m) => [m.id, m]));
        nodes.set(id, { ...n, y: n.y + dy });
        refit(doc, nodes);
        if (collision(doc, nodes)) continue;
        // Bends tidying laid for its lines follow it where they run straight in: the last run across
        // into the box moves with it, so no step is left at the port.
        const was = routeEdges(doc);
        const edges = comb(doc, nodes).map((x) => {
          if (!x.tidied || !x.route || (x.from.node !== id && x.to.node !== id)) return x;
          const pts = was.get(x.id) ?? [];
          const level = new Set<number>();
          if (x.from.node === id && pts.length) level.add(pts[0].y);
          if (x.to.node === id && pts.length) level.add(pts[pts.length - 1].y);
          const route = x.route.map((p, i, all) => {
            const end = (x.from.node === id && all.slice(0, i + 1).every((q) => level.has(q.y))) || (x.to.node === id && all.slice(i).every((q) => level.has(q.y)));
            return end ? { x: p.x, y: p.y + dy } : p;
          });
          return { ...x, route };
        });
        const trial = { ...doc, nodes: doc.nodes.map((m) => nodes.get(m.id)!), edges };
        const score = weigh(trial);
        if (score < (pick?.score ?? best)) pick = { doc: trial, score };
      }
    }
    if (!pick) break;
    best = pick.score;
    doc = pick.doc;
  }
  return doc;
}

/** The lines tangled in more than their own bends: crossing, on top of or grazing something, or out of their way. */
function snarled(doc: Doc): Set<string> {
  const routes = routeEdges(doc);
  const out = new Set<string>();
  for (const [id, v] of tangles(doc)) if (v - Math.max(0, (routes.get(id)?.length ?? 2) - 2) * BEND_COST > 0.5) out.add(id);
  return out;
}

/** The most rounds of swapping boxes in a column, one swap kept in each. */
const SWAP_ROUNDS = 2;
/** How many of the swaps that look best are laid out in full each round, as that takes a while. */
const HOPEFUL = 2;

/**
 * Boxes stacked in a column within one area (the servers in an app subnet) are put in the order
 * their lines run, so the lines out of the box on top go to the boxes on top and do not cross the
 * lines from the boxes below on their way. Two boxes trade places at a time, each keeping its own
 * x, and the stack keeps its top and the gaps between its boxes. Each order is weighed with its
 * ports put in order too, and kept only when it leaves the wiring less tangled. Columns whose lines
 * are tangled in nothing but their bends are left alone, and so are boxes with lines bent by hand.
 */
function reorder(doc: Doc): Doc {
  if (doc.edges.length >= WEIGH_UP_TO) return doc;
  const handDrawn = new Set(doc.edges.filter((e) => e.route && !e.tidied).flatMap((e) => [e.from.node, e.to.node]));
  const groups = new Map<string, Node[]>();
  for (const n of doc.nodes) {
    if (n.type !== 'device' || handDrawn.has(n.id)) continue;
    const key = frameOf(doc, n)?.id ?? '';
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const columns: string[][] = [];
  for (const list of groups.values()) {
    const cx = (n: Node) => center(nodeRect(n)).x;
    let start = -Infinity;
    for (const n of [...list].sort((p, q) => cx(p) - cx(q))) {
      if (cx(n) - start > COLUMN) {
        columns.push([]);
        start = cx(n);
      }
      columns[columns.length - 1].push(n.id);
    }
  }
  let ported = orderPorts(doc);
  // An order is weighed as tidying goes on to lay it: ports in order, and lines routed round the
  // others. Laying the ways round takes a while, so only orders that look better without them are.
  const finished = (d: Doc) => tangle(untangle(d));
  let quick = tangle(ported);
  let best: number | null = null;
  for (const ids of columns) {
    if (ids.length < 2) continue;
    for (let round = 0; round < SWAP_ROUNDS; round++) {
      // Only a column with a line tangled in more than its bends is worth the weighing.
      const tangled = snarled(ported);
      if (!doc.edges.some((e) => tangled.has(e.id) && (ids.includes(e.from.node) || ids.includes(e.to.node)))) break;
      const stack = ids.map((id) => doc.nodes.find((n) => n.id === id)!).sort((p, q) => p.y - q.y);
      const gaps = stack.slice(1).map((n, i) => n.y - (stack[i].y + nodeRect(stack[i]).h));
      // A stack whose boxes overlap in height is no stack.
      if (gaps.some((g) => g < 0)) break;
      const hopeful: { doc: Doc; ported: Doc; quick: number }[] = [];
      for (let i = 0; i < stack.length; i++) {
        for (let k = i + 1; k < stack.length; k++) {
          const order = [...stack];
          [order[i], order[k]] = [order[k], order[i]];
          const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
          let y = stack[0].y;
          for (const [j, n] of order.entries()) {
            nodes.set(n.id, { ...n, y });
            y += nodeRect(n).h + (gaps[j] ?? 0);
          }
          refit(doc, nodes);
          if (collision(doc, nodes)) continue;
          const moved = new Set(order.filter((n) => nodes.get(n.id)!.y !== n.y).map((n) => n.id));
          const edges = comb(doc, nodes).map((e) => (e.tidied && (moved.has(e.from.node) || moved.has(e.to.node)) ? (({ route: _r, tidied: _t, ...rest }) => rest)(e) : e));
          const trial = { ...doc, nodes: doc.nodes.map((n) => nodes.get(n.id)!), edges };
          // Only the ports of the moved boxes, and of the boxes they are wired to, can want another order.
          const near = new Set(doc.edges.flatMap((e) => (moved.has(e.from.node) || moved.has(e.to.node) ? [e.from.node, e.to.node] : [])));
          const laid = orderPorts(trial, near);
          const rough = tangle(laid);
          if (rough < quick) hopeful.push({ doc: trial, ported: laid, quick: rough });
        }
      }
      let pick: { doc: Doc; ported: Doc; quick: number; score: number } | null = null;
      for (const h of hopeful.sort((p, q) => p.quick - q.quick).slice(0, HOPEFUL)) {
        best ??= finished(ported);
        const score = finished(h.ported);
        if (score < (pick?.score ?? best)) pick = { ...h, score };
      }
      if (!pick) break;
      best = pick.score;
      quick = pick.quick;
      doc = pick.doc;
      ported = pick.ported;
    }
  }
  return ported;
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
 * straight, lay parallel bends side by side so they neither overlap nor cross, and move the
 * lines' labels clear of each other.
 */
export function tidy(doc: Doc): Doc {
  // Pictures laid under the drawing (floor plans) are not part of it: no area holds them and
  // nothing lines up with them. They are set aside, and come back where they were.
  if (doc.nodes.some(isUnderlay)) {
    const without = { ...doc, nodes: doc.nodes.filter((n) => !isUnderlay(n)) };
    const drawing = tidy(without);
    if (drawing === without) return doc;
    const moved = new Map(drawing.nodes.map((n) => [n.id, n]));
    const next = { ...drawing, nodes: doc.nodes.map((n) => (isUnderlay(n) ? n : moved.get(n.id)!)) };
    return JSON.stringify(next) === JSON.stringify(doc) ? doc : next;
  }
  // Bends an earlier tidy laid are laid afresh; bends drawn by hand stay.
  const unlaid = (e: Edge): Edge => {
    const { route: _route, tidied: _tidied, ...rest } = e;
    return rest;
  };
  const fresh = doc.edges.some((e) => e.tidied) ? { ...doc, edges: doc.edges.map((e) => (e.tidied ? unlaid(e) : e)) } : doc;
  let next = reorder(fresh);
  // One pass can open up room for the next; a handful settles any board.
  for (let i = 0; i < 6; i++) {
    const after = pass(next);
    if (JSON.stringify(after) === JSON.stringify(next)) break;
    next = after;
  }
  // Tidying must not leave the wiring worse than it found it: if it would, only the labels move.
  // (Found without the bends an earlier tidy laid: those are laid afresh, not held up against.)
  if (tangle(next) > tangle(fresh)) next = fresh;
  // Lines routed afresh round the others can come in from another side: the ports follow them.
  const earlier = new Map(doc.edges.flatMap((e) => (e.tidied && e.route ? [[e.id, e.route] as [string, Pt[]]] : [])));
  next = nudge(orderPorts(turnPorts(untangle(orderPorts(next), earlier))));
  // Pressing tidy again never undoes a better wiring an earlier tidy found: if this one comes out
  // more tangled than the board it was given, the board stays as it was (but for the labels).
  if (doc.edges.length < WEIGH_UP_TO && tangle(next) > tangle(doc)) next = doc;
  // Last, with everything where it ends up: each label slid along its line to where it is clear.
  next = placeLabels(next);
  return JSON.stringify(next) === JSON.stringify(doc) ? doc : next;
}

