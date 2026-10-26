import { type Anchor, snap } from './geometry';
import { CLEAR } from './router';
import type { Pt } from './types';

/**
 * A line drawn the way the pointer went: the path traced while pulling it, squared into
 * horizontal and vertical runs, becomes the line's hand-placed bends. A quick, straight pull is no
 * tracing at all and leaves the line to the automatic route.
 */

/** The path with the wobble taken out: points further than `tolerance` from the straight line between their neighbours (Ramer–Douglas–Peucker). */
export function straighten(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length <= 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len : Math.hypot(p.x - a.x, p.y - a.y);
    if (d > far) [far, at] = [d, i];
  }
  if (far <= tolerance) return [a, b];
  return [...straighten(pts.slice(0, at + 1), tolerance).slice(0, -1), ...straighten(pts.slice(at), tolerance)];
}


type Axis = 'h' | 'v';
/** A straight stretch: horizontal at height `at`, or vertical at `at` across. */
interface Run {
  axis: Axis;
  at: number;
}
const axisOf = (a: Anchor): Axis => (a.dir === 'left' || a.dir === 'right' ? 'h' : 'v');
const coordOf = (axis: Axis, p: Pt): number => (axis === 'h' ? p.y : p.x);

/**
 * The bends of a line traced from `from` to `to` along `trail` (board coordinates), or nothing
 * when the trail has no corner worth keeping. `tolerance` is how far the hand may wander from a
 * straight stroke (board units). The line leaves and enters square to the sides of its ends.
 */
export function traceRoute(trail: Pt[], from: Anchor, to: Anchor, tolerance: number): Pt[] | undefined {
  const stroke = straighten(trail, tolerance);
  // One straight stroke from start to end: no tracing, the line is left to find its own way.
  if (stroke.length < 3) return undefined;
  // Each stroke as a horizontal or vertical run, at where its middle lies; runs one after another
  // the same way are one run.
  const runs: Run[] = [];
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1];
    const b = stroke[i];
    const axis: Axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'h' : 'v';
    const at = snap(axis === 'h' ? (a.y + b.y) / 2 : (a.x + b.x) / 2);
    if (runs.at(-1)?.axis === axis) continue;
    runs.push({ axis, at });
  }
  if (runs.length < 2) return undefined;
  // Out of the start and into the end square to their sides: the first and last runs lie on the
  // ends themselves, with a run put in where the stroke set off (or arrived) the other way.
  const first: Run = { axis: axisOf(from), at: coordOf(axisOf(from), from) };
  const last: Run = { axis: axisOf(to), at: coordOf(axisOf(to), to) };
  if (runs[0].axis === first.axis) runs[0] = first;
  else runs.unshift(first);
  if (runs.at(-1)!.axis === last.axis) runs[runs.length - 1] = last;
  else runs.push(last);
  // The stretch next to each end stands clear of its box, so the line never runs along its edge.
  const keepOut = (end: Anchor, run: Run | undefined) => {
    if (!run) return;
    const out = end.dir === 'right' || end.dir === 'bottom' ? 1 : -1;
    const rim = end.dir === 'left' || end.dir === 'right' ? end.x : end.y;
    if ((run.at - rim) * out < CLEAR) run.at = rim + CLEAR * out;
  };
  keepOut(from, runs[1]);
  keepOut(to, runs[runs.length - 2]);
  // A corner where each run meets the next.
  const bends: Pt[] = [];
  for (let i = 1; i < runs.length; i++) {
    const h = runs[i].axis === 'h' ? runs[i] : runs[i - 1];
    const v = runs[i].axis === 'v' ? runs[i] : runs[i - 1];
    const p = { x: v.at, y: h.at };
    if (!bends.some((q) => q.x === p.x && q.y === p.y)) bends.push(p);
  }
  // A single corner is what the automatic route draws anyway; it keeps a hand-placed route only
  // from two corners on.
  return bends.length >= 2 ? bends : undefined;
}
