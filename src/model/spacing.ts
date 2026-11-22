// Equal spacing while a box is dragged: where it would stand as far from its neighbours in a row or
// a column as they are from each other, and which gaps are equal where it stands.
import type { Rect } from './types';

export type Axis = 'x' | 'y';

/** One of the equal gaps of a row (`x`) or column (`y`): from one box to the next, drawn at `at` across. */
export interface Gap {
  axis: Axis;
  from: number;
  to: number;
  at: number;
}

/** Gaps this close read as the same. */
const EQUAL = 0.5;
/** Boxes closer than this are touching: there is no gap to show. */
const MIN_GAP = 1;

/** A box along the axis (`start`–`end`) and across it (`a`–`b`). */
interface Span {
  start: number;
  end: number;
  a: number;
  b: number;
}

const span = (r: Rect, axis: Axis): Span => (axis === 'x' ? { start: r.x, end: r.x + r.w, a: r.y, b: r.y + r.h } : { start: r.y, end: r.y + r.h, a: r.x, b: r.x + r.w });

/** The boxes in the row or column of `me`, along the axis. One that holds it (a large note under it) is no neighbour. */
function lineOf(me: Span, others: Rect[], axis: Axis): Span[] {
  return others
    .map((r) => span(r, axis))
    .filter((o) => o.a < me.b && o.b > me.a && !(o.start <= me.start && o.end >= me.end && o.a <= me.a && o.b >= me.b))
    .sort((p, q) => p.start - q.start);
}

/**
 * The equal gaps of the row or column of `box`, standing where it is: those beside it, and on along
 * the line for as long as the next gap is the same. None unless at least two gaps are equal.
 */
export function equalGaps(box: Rect, others: Rect[], axis: Axis): Gap[] {
  const me = span(box, axis);
  const line = lineOf(me, others, axis);
  if (line.some((o) => o.start < me.end && o.end > me.start)) return [];
  // The next box each way; none when another overlaps this one on that side, standing in the gap.
  const before = (x: Span): Span | undefined => {
    const earlier = line.filter((o) => o !== x && o.start < x.start);
    if (earlier.some((o) => o.end > x.start)) return undefined;
    return earlier.reduce<Span | undefined>((best, o) => (!best || o.end > best.end ? o : best), undefined);
  };
  const after = (x: Span): Span | undefined => {
    const later = line.filter((o) => o !== x && o.end > x.end);
    if (later.some((o) => o.start < x.end)) return undefined;
    return later.reduce<Span | undefined>((best, o) => (!best || o.start < best.start ? o : best), undefined);
  };
  const walk = (next: (x: Span) => Span | undefined, gapOf: (here: Span, there: Span) => number) => {
    const pairs: [Span, Span][] = [];
    let size: number | undefined;
    let here = me;
    for (let there = next(here); there; there = next(here)) {
      const gap = gapOf(here, there);
      if (gap < MIN_GAP || (size !== undefined && Math.abs(gap - size) > EQUAL)) break;
      size ??= gap;
      pairs.push([here, there]);
      here = there;
    }
    return { size, pairs };
  };
  const left = walk(before, (here, there) => here.start - there.end);
  const right = walk(after, (here, there) => there.start - here.end);
  const even = left.size !== undefined && right.size !== undefined && Math.abs(left.size - right.size) <= EQUAL;
  const at = (p: Span, q: Span): number => (Math.max(p.a, q.a) + Math.min(p.b, q.b)) / 2;
  return [
    ...(even || left.pairs.length > 1 ? left.pairs.map(([here, there]) => ({ axis, from: there.end, to: here.start, at: at(here, there) })) : []),
    ...(even || right.pairs.length > 1 ? right.pairs.map(([here, there]) => ({ axis, from: here.end, to: there.start, at: at(here, there) })) : []),
  ];
}

/**
 * How far to move `box` along the axis, less than `tolerance`, to stand evenly in its row or column:
 * in the middle between two boxes, or a gap past a pair of them. Null when no such place is near.
 */
export function spacingSnap(box: Rect, others: Rect[], axis: Axis, tolerance: number): number | null {
  const me = span(box, axis);
  const size = me.end - me.start;
  const line = lineOf(me, others, axis);
  let best: number | null = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [p, q] = [line[i], line[i + 1]];
    const gap = q.start - p.end;
    if (gap < MIN_GAP) continue;
    for (const place of [p.end + (gap - size) / 2, q.end + gap, p.start - gap - size]) {
      const delta = place - me.start;
      if (Math.abs(delta) >= tolerance || (best !== null && Math.abs(delta) >= Math.abs(best))) continue;
      const there = axis === 'x' ? { ...box, x: place } : { ...box, y: place };
      if (equalGaps(there, others, axis).length >= 2) best = delta;
    }
  }
  return best;
}
