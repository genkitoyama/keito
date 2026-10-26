import { isTagged, isUnderlay, labelPoint, nodeRect, routeEdges, tagChips } from './geometry';
import { cableIds, idShown, labelStacked, lengthShown, protocolShown } from './lists';
import { signalOf } from './signals';
import { UI_FONT, measure } from './text';
import type { Doc, Edge, Pt, Rect } from './types';

/** The board's usual size of a cable's label, in px. */
export const LABEL_SIZE = 10.5;
/** Sizes offered for line labels: the board's choice. */
export const LABEL_SIZES = [
  { size: 8, label: '極小' },
  { size: 9, label: '小' },
  { size: LABEL_SIZE, label: '標準' },
  { size: 12, label: '大' },
];

/** Size of a line's label: its own, else the board's choice (a flow line's a little larger). */
export function labelFont(doc: Doc, e: Edge): number {
  if (e.fontSize) return e.fontSize;
  const k = (doc.labelSize ?? LABEL_SIZE) / LABEL_SIZE;
  return (e.signal === 'flow' ? 12 : LABEL_SIZE) * k;
}

/** Size of the tags drawn in place of a line (power cables, by default): in step with the labels. */
export const tagFont = (doc: Doc, e: Edge): number => (10 * (e.fontSize ?? doc.labelSize ?? LABEL_SIZE)) / LABEL_SIZE;

/** A line's label; may run over several lines when the user's own text does. */
export function edgeLabel(doc: Doc, e: Edge): string {
  // A protocol line names what it is and its port ("OSC 7000/udp"): its colour alone would not say.
  const sig = signalOf(e.signal);
  if (sig.protocol) {
    const what = protocolShown(doc, e) ? [sig.id === 'data' ? '' : sig.prefix, e.spec].filter(Boolean).join(' ') : '';
    return [what, e.label.trim()].filter(Boolean).join(labelStacked(doc, e) ? '\n' : ' · ');
  }
  const id = idShown(doc, e) ? cableIds(doc).get(e.id) : undefined;
  const length = e.length != null && lengthShown(doc, e) ? `${e.length}m` : '';
  return [id, e.spec, e.label.trim(), length].filter(Boolean).join(labelStacked(doc, e) ? '\n' : ' · ');
}

/** Size of a (possibly multi-line) label box. */
export function labelSize(label: string, size: number, font: string): { w: number; h: number; lines: string[] } {
  const lines = label.split('\n');
  return { lines, w: Math.max(...lines.map((l) => measure(l, `${size}px ${font}`))) + 10, h: size * 1.6 + (lines.length - 1) * size * 1.35 };
}

const area = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Whether two square segments, one across and one down, cross each other. */
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const [h0, h1, v0, v1] = Math.abs(a.y - b.y) < 0.5 ? [a, b, c, d] : [c, d, a, b];
  return v0.x > Math.min(h0.x, h1.x) && v0.x < Math.max(h0.x, h1.x) && h0.y > Math.min(v0.y, v1.y) && h0.y < Math.max(v0.y, v1.y);
}

/** Length of the segment a–b inside r (Liang–Barsky clipping). */
function inside(a: Pt, b: Pt, r: Rect): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y)) return (t1 - t0) * Math.hypot(dx, dy);
  return 0;
}

/** Where along its run point `at` falls: the segment, and how far it is from that segment's ends. */
function onSegment(pts: Pt[], at: number): { i: number; before: number; after: number } {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let rest = lens.reduce((a, b) => a + b, 0) * at;
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] && lens[i] > 0) return { i, before: rest, after: lens[i] - rest };
    rest -= lens[i];
  }
  return { i: 0, before: 0, after: 0 };
}

/** Labels this far apart across their runs are not lined up with each other, in px. */
const ALIGN_REACH = 480;
/** What lining a label up with a neighbour is worth, against the costs below. */
const ALIGNED = 24;

/** Room kept between two labels, in px. */
const GAP = 6;

/** Points along a line a label may sit at: the middle first, then either side of it. */
const SPOTS = [0.5, ...Array.from({ length: 18 }, (_, i) => 0.5 + (i % 2 ? -1 : 1) * 0.025 * (Math.floor(i / 2) + 1) * 2)].filter((t) => t > 0.04 && t < 0.96);

/**
 * Slide every line's label along its line to where it is easiest to read: clear of the other
 * labels, the boxes, the tags beside ports, the area titles and borders and the other lines, on a straight run rather than over a
 * bend, in line with the labels of neighbouring lines, and as near the middle as that allows. Lines with the least room are placed first.
 * Only where a label sits along its own line changes; the same board always gives the same result.
 */
export function placeLabels(doc: Doc): Doc {
  const routes = routeEdges(doc);
  const boxes: Rect[] = [];
  const frames: Rect[] = [];
  for (const n of doc.nodes) {
    if (n.type === 'junction' || isUnderlay(n)) continue;
    if (n.type === 'frame') {
      frames.push(nodeRect(n));
      // Only an area's title is in the way: a label may sit anywhere inside the area.
      boxes.push({ x: n.x, y: n.y, w: Math.min(n.w, measure(n.text, `600 13px ${UI_FONT}`) + 24), h: 24 });
      continue;
    }
    boxes.push(nodeRect(n));
  }
  // The tags beside ports (power lines drawn as tags) are read like boxes: a label keeps off them.
  boxes.push(...tagChips(doc));
  const lines = doc.edges.filter((e) => !isTagged(doc, e) && (routes.get(e.id)?.length ?? 0) >= 2);
  const todo = lines
    .map((e) => ({ e, pts: routes.get(e.id)!, label: edgeLabel(doc, e) }))
    .filter((x) => x.label)
    .map((x) => {
      const len = x.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - x.pts[i].x, p.y - x.pts[i].y), 0);
      return { ...x, len, size: labelSize(x.label, labelFont(doc, x.e), UI_FONT) };
    })
    .sort((a, b) => a.len - b.len || a.e.id.localeCompare(b.e.id));
  if (!todo.length) return doc;
  const placed: Rect[] = [];
  // Where the labels already placed sit, by the way their run goes: labels on runs across line up
  // under each other, labels on runs down line up side by side.
  const marks: { flat: boolean; x: number; y: number }[] = [];
  const at = new Map<string, number | undefined>();
  for (const { e, pts, size, len } of todo) {
    let best = 0.5;
    let bestCost = Infinity;
    // Besides the spots spread along it, the line may put its label in line with one already placed.
    const spots = [...SPOTS];
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const flat = Math.abs(a.y - b.y) < 0.5;
      const half = flat ? size.w / 2 : size.h / 2;
      for (const m of marks) {
        if (m.flat !== flat || Math.abs(flat ? m.y - a.y : m.x - a.x) > ALIGN_REACH) continue;
        const d = flat ? Math.abs(m.x - a.x) : Math.abs(m.y - a.y);
        const v = flat ? m.x : m.y;
        if (v > Math.min(flat ? a.x : a.y, flat ? b.x : b.y) + half && v < Math.max(flat ? a.x : a.y, flat ? b.x : b.y) - half) spots.push((run + d) / len);
      }
      run += l;
    }
    for (const t of spots) {
      const p = labelPoint(pts, t);
      const r = { x: p.x - size.w / 2, y: p.y - size.h / 2, w: size.w, h: size.h };
      const own = size.w * size.h;
      let cost = 0;
      // Labels keep a little air between them, so neighbours on close lines read apart.
      const near = { x: r.x - GAP, y: r.y - GAP, w: r.w + GAP * 2, h: r.h + GAP * 2 };
      for (const q of placed) cost += (area(r, q) / own) * 1000 + (area(near, q) / own) * 200;
      for (const b of boxes) cost += (area(r, b) / own) * 600;
      // A chip astride an area's border reads as half in each: it sits wholly in one, or between them.
      for (const f of frames) {
        const o = area(r, f);
        if (o > 0 && o < own) cost += 15;
      }
      // Other lines running under the chip are hidden by it; worst, a crossing hidden under it (and
      // its hop) leaves no telling which way either line goes.
      const s0 = onSegment(pts, t);
      const across = Math.abs(pts[s0.i + 1]?.x - pts[s0.i].x) >= Math.abs(pts[s0.i + 1]?.y - pts[s0.i].y);
      for (const o of lines) {
        if (o === e) continue;
        const op = routes.get(o.id)!;
        for (let i = 1; i < op.length; i++) {
          const hidden = inside(op[i - 1], op[i], r);
          cost += hidden * 1.5;
          const flat = Math.abs(op[i].y - op[i - 1].y) < 0.5;
          if (hidden > 0 && flat !== across && crosses(pts[s0.i], pts[s0.i + 1] ?? pts[s0.i], op[i - 1], op[i])) cost += 120;
        }
      }
      // Over a bend the chip hides the corner: it reads best on a straight run.
      const s = onSegment(pts, t);
      const a = pts[s.i];
      const b = pts[s.i + 1] ?? a;
      const half = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? size.w / 2 : size.h / 2;
      if (s.before < half || s.after < half) cost += 40;
      cost += Math.abs(t - 0.5) * 40;
      // Labels out of line with their neighbours read as scattered.
      const flat = Math.abs(b.y - a.y) < 0.5;
      if (marks.some((m) => m.flat === flat && (flat ? Math.abs(m.y - p.y) <= ALIGN_REACH && Math.abs(m.x - p.x) < 1 : Math.abs(m.x - p.x) <= ALIGN_REACH && Math.abs(m.y - p.y) < 1))) cost -= ALIGNED;
      if (cost < bestCost - 1e-6) [best, bestCost] = [t, cost];
    }
    const p = labelPoint(pts, best);
    placed.push({ x: p.x - size.w / 2, y: p.y - size.h / 2, w: size.w, h: size.h });
    const s = onSegment(pts, best);
    const a = pts[s.i];
    const b = pts[s.i + 1] ?? a;
    marks.push({ flat: Math.abs(b.y - a.y) < 0.5, x: p.x, y: p.y });
    at.set(e.id, Math.abs(best - 0.5) < 0.02 ? undefined : Math.round(best * 10000) / 10000);
  }
  let changed = false;
  const edges = doc.edges.map((e) => {
    if (!at.has(e.id) || at.get(e.id) === e.labelAt) return e;
    changed = true;
    const { labelAt: _, ...rest } = e;
    const t = at.get(e.id);
    return t === undefined ? rest : { ...rest, labelAt: t };
  });
  return changed ? { ...doc, edges } : doc;
}
