import type { Anchor, Dir } from './geometry';
import type { Pt, Rect } from './types';

/**
 * Obstacle-avoiding orthogonal routing. The plain router draws the shortest
 * elbow between two anchors; when that elbow would run through a node, the
 * line is re-routed here around every node with A* over the grid formed by the
 * nodes' (inflated) edges, paying for each bend so the result stays tidy.
 */
const STUB = 18;
const BEND = 36;
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

function search(a: Anchor, b: Anchor, obstacles: Rect[], margin: number): Pt[] | null {
  const out = (p: Anchor): Pt => ({ x: p.x + STEP[INDEX[p.dir]][0] * STUB, y: p.y + STEP[INDEX[p.dir]][1] * STUB });
  const s = out(a);
  const t = out(b);
  const boxes = obstacles.map((r) => [r.x - margin, r.y - margin, r.x + r.w + margin, r.y + r.h + margin]);
  const inside = (x: number, y: number): boolean => {
    for (const k of boxes) if (x > k[0] + 0.01 && x < k[2] - 0.01 && y > k[1] + 0.01 && y < k[3] - 0.01) return true;
    return false;
  };
  // An end hemmed in by a neighbour leaves no room at this margin.
  if (inside(s.x, s.y) || inside(t.x, t.y)) return null;

  // Grid lines: every inflated node edge, the two ends, and a lane around the outside.
  const xl = [s.x, t.x];
  const yl = [s.y, t.y];
  for (const k of boxes) {
    xl.push(k[0], k[2]);
    yl.push(k[1], k[3]);
  }
  xl.push(Math.min(...xl) - 24, Math.max(...xl) + 24);
  yl.push(Math.min(...yl) - 24, Math.max(...yl) + 24);
  const xs = [...new Set(xl)].sort((p, q) => p - q);
  const ys = [...new Set(yl)].sort((p, q) => p - q);
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
      const cost = g[cur] + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nd === d ? 0 : BEND);
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
export function routeAround(a: Anchor, b: Anchor, obstacles: Rect[], margin: number): Pt[] | null {
  for (const m of [margin, 6, 2]) {
    const pts = search(a, b, obstacles, m);
    if (pts) return pts;
  }
  return null;
}

const TRACK = 30; // distance between parallel bends
export const CLEAR = 20; // straight run kept next to a port before a bend

/** A line that leaves one port to the right and enters another from the left, with a jog in between. */
export interface Run {
  id: string;
  /** The end on the left and the end on the right. */
  l: Pt;
  r: Pt;
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

/**
 * Where each jogging line should bend: lines that could sit on top of each other get bends side
 * by side, ordered so they do not cross, in the open corridor between areas when there is one.
 * A line missing from the result has no clear spot and is left to the ordinary router.
 */
export function lanes(runs: Run[], obstacles: Rect[], frames: Rect[]): Map<string, number> {
  const out = new Map<string, number>();
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
      // Bends read best in the open corridor between areas rather than inside one or on its border.
      const framed = order.reduce((sum, u, k) => {
        const p = { x: first + k * step, y: (u.l.y + u.r.y) / 2 };
        return sum + frames.filter((f) => p.x > f.x - CLEAR && p.x < f.x + f.w + CLEAR && p.y > f.y && p.y < f.y + f.h).length;
      }, 0);
      const score = [blocked ? 1 : 0, framed, Math.abs(c - mid)];
      const at = best ? score.findIndex((v, i) => v !== best!.score[i]) : 0;
      if (!best || (at >= 0 && score[at] < best.score[at])) best = { score, first };
    }
    if (!best || best.score[0]) continue;
    for (const [k, u] of order.entries()) out.set(u.id, best.first + k * step);
  }
  return out;
}
