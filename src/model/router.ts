import type { Anchor, Dir } from './geometry';
import type { Pt, Rect } from './types';

/**
 * Obstacle-avoiding orthogonal routing. The plain router draws the shortest
 * elbow between two anchors; when that elbow would run through a node, the
 * line is re-routed here around every node with A* over the grid formed by the
 * nodes' (inflated) edges, paying for each bend so the result stays tidy.
 */
/** How far a line runs straight out of a port before it may turn. */
export const STUB = 18;
/** Whether a side faces left or right (a line leaves it across, not up or down). */
export const isH = (d: Dir): boolean => d === 'left' || d === 'right';
/** Two ends facing each other across a gap wide enough for a line to jog between them. */
export const facing = (l: Anchor, r: Anchor): boolean => l.dir === 'right' && r.dir === 'left' && r.x - l.x >= CLEAR * 2;
const BEND = 36;
/** Size of the cells obstacles are filed under for quick look-up (px). */
const CELL = 160;
const STEP: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const INDEX: Record<Dir, number> = { right: 0, bottom: 1, left: 2, top: 3 };

/** Does the polyline pass through the inside of any of the rectangles? Touching an edge is fine. */
export function collides(pts: Pt[], obstacles: Rect[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    for (const r of obstacles) {
      if (x1 > r.x + 1 && x0 < r.x + r.w - 1 && y1 > r.y + 1 && y0 < r.y + r.h - 1) return true;
    }
  }
  return false;
}

/** Min-heap of (priority, value) pairs. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const top: [number, number] = [keys[0], vals[0]];
    const key = keys.pop()!;
    const val = vals.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

/** What a search needs to know of the obstacles at one margin, made once for all the lines routed among them. */
interface Prepared {
  inside(x: number, y: number): boolean;
  /** The boxes' edges across and down, sorted, each once. */
  xb: number[];
  yb: number[];
}
const preparedFor = new WeakMap<Rect[], Map<number, Prepared>>();

function prepared(obstacles: Rect[], margin: number): Prepared {
  let byMargin = preparedFor.get(obstacles);
  if (!byMargin) preparedFor.set(obstacles, (byMargin = new Map()));
  const hit = byMargin.get(margin);
  if (hit) return hit;
  const boxes = obstacles.map((r) => [r.x - margin, r.y - margin, r.x + r.w + margin, r.y + r.h + margin]);
  // The boxes by the cells of a coarse grid they cover, so a point is checked against its
  // neighbours only: the search asks this for every grid edge it tries, and a large board has
  // hundreds of boxes.
  const cells = new Map<number, number[][]>();
  const cellOf = (v: number) => Math.floor(v / CELL);
  const key = (cx: number, cy: number) => cx * 65536 + cy;
  for (const k of boxes) {
    for (let cx = cellOf(k[0]); cx <= cellOf(k[2]); cx++) {
      for (let cy = cellOf(k[1]); cy <= cellOf(k[3]); cy++) {
        const list = cells.get(key(cx, cy));
        if (list) list.push(k);
        else cells.set(key(cx, cy), [k]);
      }
    }
  }
  const inside = (x: number, y: number): boolean => {
    const near = cells.get(key(cellOf(x), cellOf(y)));
    if (near) for (const k of near) if (x > k[0] + 0.01 && x < k[2] - 0.01 && y > k[1] + 0.01 && y < k[3] - 0.01) return true;
    return false;
  };
  const sorted = (v: number[]) => [...new Set(v)].sort((p, q) => p - q);
  const made = { inside, xb: sorted(boxes.flatMap((k) => [k[0], k[2]])), yb: sorted(boxes.flatMap((k) => [k[1], k[3]])) };
  byMargin.set(margin, made);
  return made;
}

/** The sorted lines `base` with the two ends added, and a lane 24 px outside all of them. */
function withLines(base: number[], s: number, t: number): number[] {
  const lo = Math.min(s, t, base.length ? base[0] : Infinity) - 24;
  const hi = Math.max(s, t, base.length ? base[base.length - 1] : -Infinity) + 24;
  const extra = [...new Set([lo, s, t, hi])].sort((p, q) => p - q);
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < base.length || j < extra.length) {
    const v = j >= extra.length || (i < base.length && base[i] <= extra[j]) ? base[i++] : extra[j++];
    if (out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

/** A straight piece of another line: across (`flat`) at y = `at`, or down at x = `at`, from `lo` to `hi`. */
export interface Seg {
  flat: boolean;
  at: number;
  lo: number;
  hi: number;
}
/** The straight pieces of a polyline, across or down (a slanted piece, never drawn, is left out). */
export function segmentsOf(pts: Pt[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.abs(a.y - b.y) < 0.5) out.push({ flat: true, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    else if (Math.abs(a.x - b.x) < 0.5) out.push({ flat: false, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
  }
  return out;
}

/** What crossing another line costs a search that is told to keep clear of lines, against a bend's. */
const CROSS = 400;
/** A line this close to the border of a box or an area, and running along it, reads as part of it. */
const HUG = 14;

/** The four sides of each area frame, for keeping lines from running along them. */
export function bordersOf(frames: Rect[]): Seg[] {
  return frames.flatMap((f) => [
    { flat: true, at: f.y, lo: f.x, hi: f.x + f.w },
    { flat: true, at: f.y + f.h, lo: f.x, hi: f.x + f.w },
    { flat: false, at: f.x, lo: f.y, hi: f.y + f.h },
    { flat: false, at: f.x + f.w, lo: f.y, hi: f.y + f.h },
  ]);
}

/**
 * The cost of running alongside the borders in `borders`; crossing one is free, as a line into an
 * area must. Right on a border, where the line is lost in it, costs a crossing every 40 px.
 */
export function alongBorders(borders: Seg[], flat: boolean, at: number, lo: number, hi: number): number {
  let cost = 0;
  for (const q of borders) {
    if (q.flat !== flat || Math.abs(q.at - at) >= HUG) continue;
    const shared = Math.min(hi, q.hi) - Math.max(lo, q.lo);
    if (shared > 0) cost += shared * (Math.abs(q.at - at) < 6 ? 10 : 4);
  }
  return cost;
}

/** What a whole polyline costs for running alongside the borders. */
export function hugCost(pts: Pt[], borders: Seg[]): number {
  return segmentsOf(pts).reduce((sum, q) => sum + alongBorders(borders, q.flat, q.at, q.lo, q.hi), 0);
}

/** A piece of a line given its bend, and that line's two ends. */
interface Laid extends Seg {
  ends: Pt[];
}

/**
 * How far run `u`'s piece `q` runs right on top of the pieces in `laid` (within a few pixels, the
 * same way). Lines with an end in common meet on purpose, and are let be.
 */
function overLaid(laid: Laid[], u: Run, q: Seg): number {
  const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  let sum = 0;
  for (const w of laid) {
    if (w.flat !== q.flat || Math.abs(w.at - q.at) >= 3 || w.ends.some((p) => same(p, u.l) || same(p, u.r))) continue;
    sum += Math.max(0, Math.min(w.hi, q.hi) - Math.max(w.lo, q.lo));
  }
  return sum;
}

/** The boxes a little larger than drawn, except those of the line's own two ends, which it must meet. */
export function roomAround(obstacles: Rect[], ends: Rect[]): Rect[] {
  const own = (r: Rect) => ends.some((e) => e.x === r.x && e.y === r.y && e.w === r.w && e.h === r.h);
  return obstacles.filter((r) => !own(r)).map((r) => ({ x: r.x - EDGE_ROOM, y: r.y - EDGE_ROOM, w: r.w + EDGE_ROOM * 2, h: r.h + EDGE_ROOM * 2 }));
}

/** The cost of running from (x0, y) to (x1, y), or (x, y0) to (x, y1), over the lines in `segs`. */
function overLines(segs: Seg[], flat: boolean, at: number, lo: number, hi: number): number {
  let cost = 0;
  for (const q of segs) {
    if (q.flat !== flat) {
      // A line through the grid point at the near end counts on this edge, so none slips between two.
      if (q.at > lo - 0.5 && q.at < hi - 0.5 && at > q.lo + 1 && at < q.hi - 1) cost += CROSS;
    } else if (Math.abs(q.at - at) < 14) {
      // Running on top of another line, or so close beside it that the two read as one.
      const shared = Math.min(hi, q.hi) - Math.max(lo, q.lo);
      // On top of it is worse than a crossing even for a short way: it reads as the same line.
      if (shared > 0) cost += shared * (Math.abs(q.at - at) < 3 ? 40 : 4);
    }
  }
  return cost;
}

function search(a: Anchor, b: Anchor, obstacles: Rect[], margin: number, segs: Seg[] = [], reach = Infinity, borders: Seg[] = []): Pt[] | null {
  const out = (p: Anchor): Pt => ({ x: p.x + STEP[INDEX[p.dir]][0] * STUB, y: p.y + STEP[INDEX[p.dir]][1] * STUB });
  const s = out(a);
  const t = out(b);
  const { inside, xb, yb } = prepared(obstacles, margin);
  // An end hemmed in by a neighbour leaves no room at this margin.
  if (inside(s.x, s.y) || inside(t.x, t.y)) return null;

  // Grid lines: every inflated node edge within `reach` of the two ends, the ends themselves, and a
  // lane around the outside. Kept clear of other lines, it may also run halfway between two box
  // edges, out of their way. (Boxes beyond the reach still block: only fewer lines are tried.)
  const near = (v: number[], p: number, q: number) => (reach === Infinity ? v : v.filter((x) => x >= Math.min(p, q) - reach && x <= Math.max(p, q) + reach));
  const halves = (v: number[]) => (segs.length ? [...v, ...v.slice(1).map((x, i) => (x + v[i]) / 2)].sort((p, q) => p - q) : v);
  // Lanes either side of each area border, clear of it, so a way along an area need not hug its edge.
  const off = (flat: boolean) => borders.filter((q) => q.flat === flat).flatMap((q) => [q.at - HUG - 6, q.at + HUG + 6]);
  const sorted = (v: number[]) => [...new Set(v)].sort((p, q) => p - q);
  const xs = withLines(halves(near(borders.length ? sorted([...xb, ...off(false)]) : xb, s.x, t.x)), s.x, t.x);
  const ys = withLines(halves(near(borders.length ? sorted([...yb, ...off(true)]) : yb, s.y, t.y)), s.y, t.y);
  const W = xs.length;
  const H = ys.length;
  if (W * H > 40000) return null;

  // Whether the grid edge leaving (i, j) to the right / downwards is clear, worked out on demand.
  const right = new Int8Array(W * H);
  const down = new Int8Array(W * H);
  const clearRight = (i: number, j: number): boolean => {
    const c = j * W + i;
    if (!right[c]) right[c] = inside((xs[i] + xs[i + 1]) / 2, ys[j]) ? -1 : 1;
    return right[c] === 1;
  };
  const clearDown = (i: number, j: number): boolean => {
    const c = j * W + i;
    if (!down[c]) down[c] = inside(xs[i], (ys[j] + ys[j + 1]) / 2) ? -1 : 1;
    return down[c] === 1;
  };
  // What running over other lines, or along an area's border, costs on the grid edge leaving (i, j)
  // to the right / downwards.
  const costly = segs.length > 0 || borders.length > 0;
  const linesRight = costly ? new Float64Array(W * H).fill(-1) : null;
  const linesDown = costly ? new Float64Array(W * H).fill(-1) : null;
  const over = (nd: number, i: number, j: number, ni: number, nj: number): number => {
    if (!linesRight || !linesDown) return 0;
    const flat = nd === 0 || nd === 2;
    const ci = Math.min(i, ni);
    const cj = Math.min(j, nj);
    const c = cj * W + ci;
    const cache = flat ? linesRight : linesDown;
    if (cache[c] < 0) cache[c] = flat ? overLines(segs, true, ys[cj], xs[ci], xs[ci + 1]) + alongBorders(borders, true, ys[cj], xs[ci], xs[ci + 1]) : overLines(segs, false, xs[ci], ys[cj], ys[cj + 1]) + alongBorders(borders, false, xs[ci], ys[cj], ys[cj + 1]);
    return cache[c];
  };

  const ti = xs.indexOf(t.x);
  const tj = ys.indexOf(t.y);
  const h = (i: number, j: number): number => Math.abs(xs[i] - t.x) + Math.abs(ys[j] - t.y);
  // A state is a grid point plus the direction of travel, so that bends can be charged for.
  const g = new Float64Array(W * H * 4).fill(Infinity);
  const prev = new Int32Array(W * H * 4).fill(-1);
  const start = (ys.indexOf(s.y) * W + xs.indexOf(s.x)) * 4 + INDEX[a.dir];
  const arrive = (INDEX[b.dir] + 2) % 4;
  const heap = new Heap();
  g[start] = 0;
  heap.push(h(xs.indexOf(s.x), ys.indexOf(s.y)), start);
  let best = Infinity;
  let goal = -1;
  while (heap.size) {
    const [f, cur] = heap.pop();
    if (f >= best) break;
    const d = cur & 3;
    const cell = cur >> 2;
    const i = cell % W;
    const j = (cell - i) / W;
    if (f > g[cur] + h(i, j) + 1e-6) continue;
    if (i === ti && j === tj) {
      const total = g[cur] + (d === arrive ? 0 : BEND);
      if (total < best) {
        best = total;
        goal = cur;
      }
      continue;
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      const ni = i + STEP[nd][0];
      const nj = j + STEP[nd][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      if (nd === 0 ? !clearRight(i, j) : nd === 2 ? !clearRight(ni, j) : nd === 1 ? !clearDown(i, j) : !clearDown(i, nj)) continue;
      const cost = g[cur] + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nd === d ? 0 : BEND) + over(nd, i, j, ni, nj);
      const next = (nj * W + ni) * 4 + nd;
      if (cost < g[next] - 1e-9) {
        g[next] = cost;
        prev[next] = cur;
        heap.push(cost + h(ni, nj), next);
      }
    }
  }
  if (goal < 0) return null;
  const path: Pt[] = [];
  for (let c = goal; c >= 0; c = prev[c]) {
    const cell = c >> 2;
    const i = cell % W;
    path.push({ x: xs[i], y: ys[(cell - i) / W] });
  }
  path.reverse();
  return [{ x: a.x, y: a.y }, ...path, { x: b.x, y: b.y }];
}

/**
 * Route from a to b keeping `margin` clear of every obstacle; in tight spots
 * the margin is reduced before giving up (null = no way through).
 */
export function routeAround(a: Anchor, b: Anchor, obstacles: Rect[], margin: number, borders: Seg[] = []): Pt[] | null {
  for (const m of [margin, 6, 2]) {
    for (const reach of REACHES) {
      const pts = search(a, b, obstacles, m, [], reach, borders);
      if (pts) return pts;
    }
  }
  return null;
}

/**
 * How far round the two ends a search looks, widening when nothing is found: on a large board the
 * whole grid is too big to search (and would be refused), while a way round is nearly always close.
 */
const REACHES = [400, 1500, Infinity];

/** The way round the obstacles that crosses and runs over the lines in `segs` least, or null. */
export function routeClear(a: Anchor, b: Anchor, obstacles: Rect[], segs: Seg[], borders: Seg[] = []): Pt[] | null {
  for (const m of [12, 6]) {
    for (const reach of REACHES) {
      const pts = search(a, b, obstacles, m, segs, reach, borders);
      if (pts) return pts;
    }
  }
  return null;
}

const TRACK = 30; // distance between parallel bends
export const EDGE_ROOM = 8; // room between a line and a box it passes (collides allows a pixel of it)
export const CLEAR = 20; // straight run kept next to a port before a bend

/** A line that leaves one port to the right and enters another from the left, with a jog in between. */
export interface Run {
  id: string;
  /** The end on the left and the end on the right, with the boxes they are on. */
  l: Pt & { rect?: Rect };
  r: Pt & { rect?: Rect };
}

/** Roughly where the tag chip next to a port lands (the exact size depends on the font). */
export function chip(at: Pt & { dir: Dir }, text: string): Rect {
  const w = 40 + [...text.replace(/\s*\n\s*/g, ' ')].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 10 : 6), 0);
  if (at.dir === 'left') return { x: at.x - w, y: at.y - 8, w, h: 16 };
  if (at.dir === 'right') return { x: at.x, y: at.y - 8, w, h: 16 };
  return { x: at.x - w / 2, y: at.dir === 'top' ? at.y - 26 : at.y, w, h: 26 };
}

const span = (u: Run): [number, number] => [Math.min(u.l.y, u.r.y), Math.max(u.l.y, u.r.y)];
const inside = (y: number, [lo, hi]: [number, number]) => y > lo + 0.5 && y < hi - 0.5;
/**
 * Crossings between two runs when `u` bends to the left of `v`. Worse than a crossing: `u` going
 * on from its bend at the very height `v` comes in at, the two then run on top of each other.
 */
const crossed = (u: Run, v: Run) => (inside(v.l.y, span(u)) ? 1 : 0) + (inside(u.r.y, span(v)) ? 1 : 0) + (Math.abs(u.r.y - v.l.y) < 0.5 ? 2 : 0);

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

const holds = (f: Rect, p: Pt) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h;

/**
 * Where each jogging line should bend: lines that could sit on top of each other get bends side
 * by side, ordered so they do not cross, in the open corridor between areas when there is one.
 * A line missing from the result has no clear spot and is left to the ordinary router.
 */
export function lanes(runs: Run[], obstacles: Rect[], frames: Rect[]): Map<string, number> {
  const out = new Map<string, number>();
  const walls = bordersOf(frames);
  // The pieces of the lines given their bends so far.
  const laid: Laid[] = [];
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
  const fits = (list: Run[]) => {
    const lo = Math.max(...list.map((u) => u.l.x)) + CLEAR;
    const hi = Math.min(...list.map((u) => u.r.x)) - CLEAR;
    return hi >= lo && (list.length < 2 || (hi - lo) / (list.length - 1) >= 8);
  };
  // Lines from different columns can leave no room to bend side by side, all of them together:
  // those from one column, and into one, still get theirs.
  const placed: Run[][] = [];
  for (const list of groups.values()) {
    if (fits(list)) {
      placed.push(list);
      continue;
    }
    const by = new Map<string, Run[]>();
    for (const u of list) by.set(`${u.l.x},${u.r.x}`, [...(by.get(`${u.l.x},${u.r.x}`) ?? []), u]);
    placed.push(...by.values());
  }

  for (const list of placed) {
    const lo = Math.max(...list.map((u) => u.l.x)) + CLEAR;
    const hi = Math.min(...list.map((u) => u.r.x)) - CLEAR;
    const step = list.length > 1 ? Math.min(TRACK, (hi - lo) / (list.length - 1)) : 0;
    if (!fits(list)) continue;
    const order = ordered(list);
    const width = step * (list.length - 1);
    const mid = (lo + hi) / 2;
    const path = (u: Run, x: number): Pt[] => [u.l, { x, y: u.l.y }, { x, y: u.r.y }, u.r];
    // Only the boxes these lines could pass are looked at, however large the board.
    const x0 = Math.min(...list.map((u) => u.l.x));
    const x1 = Math.max(...list.map((u) => u.r.x));
    const y0 = Math.min(...list.flatMap((u) => [u.l.y, u.r.y]));
    const y1 = Math.max(...list.flatMap((u) => [u.l.y, u.r.y]));
    const near = obstacles.filter((r) => r.x <= x1 + EDGE_ROOM && r.x + r.w >= x0 - EDGE_ROOM && r.y <= y1 + EDGE_ROOM && r.y + r.h >= y0 - EDGE_ROOM);
    // The lines keep off other boxes by a little more: one down a box's edge is as hard to read as
    // one through it. (They meet the boxes of their own ends, as they must.)
    const roomy = order.map((u) => roomAround(near, [u.l.rect, u.r.rect].filter((r): r is Rect => !!r)));
    let best: { score: number[]; first: number } | null = null;
    for (let c = Math.ceil((lo + width / 2) / 10) * 10; c <= hi - width / 2; c += 10) {
      const first = c - width / 2;
      const blocked = order.some((u, k) => collides(path(u, first + k * step), near) || collides(path(u, first + k * step), roomy[k]));
      // Bends read best in the open corridor between areas rather than inside one or on its border:
      // an area the line both starts and ends in (a network round several others) is no matter.
      const framed = order.reduce((sum, u, k) => {
        const p = { x: first + k * step, y: (u.l.y + u.r.y) / 2 };
        return sum + frames.filter((f) => p.x > f.x - CLEAR && p.x < f.x + f.w + CLEAR && p.y > f.y && p.y < f.y + f.h && !(holds(f, u.l) && holds(f, u.r))).length;
      }, 0);
      // Worst of all short of a box is a bend running down an area's border.
      const hugging = order.reduce((sum, u, k) => sum + alongBorders(walls, false, first + k * step, Math.min(u.l.y, u.r.y), Math.max(u.l.y, u.r.y)), 0);
      // Nor on top of a line laid already, running along the same height into or out of its bend.
      const onTop = order.reduce((sum, u, k) => sum + segmentsOf(path(u, first + k * step)).reduce((t, q) => t + overLaid(laid, u, q), 0), 0);
      const score = [blocked ? 1 : 0, onTop, hugging, framed, Math.abs(c - mid)];
      const at = best ? score.findIndex((v, i) => v !== best!.score[i]) : 0;
      if (!best || (at >= 0 && score[at] < best.score[at])) best = { score, first };
    }
    if (!best || best.score[0]) continue;
    for (const [k, u] of order.entries()) {
      out.set(u.id, best.first + k * step);
      laid.push(...segmentsOf(path(u, best.first + k * step)).map((q) => ({ ...q, ends: [u.l, u.r] })));
    }
  }
  return out;
}
