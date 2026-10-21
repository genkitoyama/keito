// Marks drawn over the board while editing: shared-thing badges, comment pins, a selected line's handles.
import { useMemo } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { pinTarget } from '../model/comments';
import { type Dir, center, intersects, nodeRect } from '../model/geometry';
import { useStore } from '../model/store';
import { type Doc, type Pt, type Rect } from '../model/types';
import { ACCENT } from './drag';

/**
 * 🔗 on devices that are the same thing as one on another board of the project. A key no other
 * board carries (the other copy deleted, or moved to another project) shows nothing. The mark is
 * part of the drawing, so it grows and shrinks with the box it sits on.
 */
export function SharedMarks({ doc }: { doc: Doc }) {
  const others = useStore((s) => s.others);
  const linked = useMemo(() => new Set(others.flatMap((d) => d.nodes.map((n) => (n.type === 'device' ? n.shared : undefined)).filter(Boolean))), [others]);
  const r = 7;
  return (
    <g pointerEvents="none">
      {doc.nodes.map((n) => {
        if (n.type !== 'device' || !n.shared || !linked.has(n.shared)) return null;
        const b = nodeRect(n);
        // Inside the top-right corner: clear of the resize handle on the corner itself.
        const cx = b.x + b.w - r * 1.6;
        const cy = b.y + r * 1.6;
        return (
          <g key={n.id} transform={`translate(${cx},${cy})`}>
            <circle r={7} fill="#fff" stroke={ACCENT} strokeWidth={1.2} />
            <g fill="none" stroke={ACCENT} strokeWidth={1.4} strokeLinecap="round" transform="rotate(-45)">
              <rect x={-4.6} y={-1.8} width={5} height={3.6} rx={1.8} />
              <rect x={-0.4} y={-1.8} width={5} height={3.6} rx={1.8} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

/**
 * A pinned comment set apart from its row gets a thin line to it, so it is clear what it is
 * about; the selected one also outlines its row.
 */
export function CommentPins({ doc, sel }: { doc: Doc; sel: Set<string> }) {
  return (
    <g pointerEvents="none">
      {doc.nodes.map((n) => {
        if (n.type !== 'sticky' || n.done) return null;
        const t = pinTarget(doc, n);
        if (!t) return null;
        const seq = nodeRect(t.seq);
        const row = { x: seq.x + 4, y: t.band.y - t.band.h / 2, w: seq.w - 8, h: t.band.h };
        const r = nodeRect(n);
        const on = sel.has(n.id);
        const near = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
        // From the sticky's edge to the nearest point of the row.
        const to = { x: near(r.x + r.w / 2, row.x, row.x + row.w), y: near(r.y + r.h / 2, row.y, row.y + row.h) };
        const from = { x: near(to.x, r.x, r.x + r.w), y: near(to.y, r.y, r.y + r.h) };
        return (
          <g key={n.id}>
            {on && <rect x={row.x} y={row.y} width={row.w} height={row.h} rx={4} fill="none" stroke="#d97706" strokeWidth={1.5} />}
            {!intersects(r, row) && (
              <>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#d97706" strokeWidth={on ? 1.5 : 1} strokeDasharray="4 3" strokeOpacity={on ? 1 : 0.7} />
                <circle cx={to.x} cy={to.y} r={3} fill="#d97706" />
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Handles on a selected cable: a grip on every segment, to slide it sideways,
 * and a knob on each end to plug it into a different port.
 */
export function EdgeHandles({ pts, k, manual, onSegment, onEnd }: {
  pts: Pt[];
  k: number;
  manual: boolean;
  onSegment: (e: RPointerEvent, seg: number, horizontal: boolean, route: Pt[]) => void;
  onEnd: (e: RPointerEvent, end: 'from' | 'to', other: Pt) => void;
}) {
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const grips: { key: number; at: Pt; seg: number; horizontal: boolean; route: Pt[] }[] = [];
  const inner = pts.slice(1, -1);
  const STUB = 18;
  const toward = (p: Pt, q: Pt, d: number): Pt => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: p.x + ((q.x - p.x) / l) * d, y: p.y + ((q.y - p.y) / l) * d };
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const horizontal = Math.abs(p.y - q.y) < 0.5;
    if (!horizontal && Math.abs(p.x - q.x) >= 0.5) continue;
    const first = i === 0;
    const last = i === pts.length - 2;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    // A segment that hangs off a port needs room for the short stub that keeps it plugged in.
    if (length < (first || last ? 60 : manual ? 1 : 16)) continue;
    let route = inner;
    let seg = i - 1;
    if (first && last) {
      // Straight cable: a pair of bends near each end, to pull the middle out into a detour.
      const s = toward(p, q, STUB);
      const t = toward(q, p, STUB);
      route = [s, { ...s }, { ...t }, t];
      seg = 1;
    } else if (first) {
      const s = toward(p, q, STUB);
      route = [s, { ...s }, ...inner];
      seg = 1;
    } else if (last) {
      const t = toward(q, p, STUB);
      route = [...inner, { ...t }, t];
      seg = inner.length - 1;
    }
    grips.push({ key: i, at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, seg, horizontal, route });
  }
  const long = 16 / k;
  const short = 6 / k;
  return (
    <g>
      {grips.map((g) => (
        <rect
          key={g.key}
          x={g.at.x - (g.horizontal ? long : short) / 2}
          y={g.at.y - (g.horizontal ? short : long) / 2}
          width={g.horizontal ? long : short}
          height={g.horizontal ? short : long}
          rx={short / 2}
          fill="#fff"
          stroke={ACCENT}
          strokeWidth={1.5 / k}
          style={{ cursor: g.horizontal ? 'ns-resize' : 'ew-resize' }}
          onPointerDown={(e) => onSegment(e, g.seg, g.horizontal, g.route)}
        />
      ))}
      <circle cx={a.x} cy={a.y} r={5.5 / k} fill="#fff" stroke={ACCENT} strokeWidth={2 / k} style={{ cursor: 'grab' }} onPointerDown={(e) => onEnd(e, 'from', b)} />
      <circle cx={b.x} cy={b.y} r={5.5 / k} fill="#fff" stroke={ACCENT} strokeWidth={2 / k} style={{ cursor: 'grab' }} onPointerDown={(e) => onEnd(e, 'to', a)} />
    </g>
  );
}

/** Whether the segment a–b passes through the rectangle (lines run square, so a box test does for the rest). */
export function segmentHits(a: Pt, b: Pt, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 <= r.x + r.w && x1 >= r.x && y0 <= r.y + r.h && y1 >= r.y;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** Connector preview from a side dot to the nearest edge of the previewed shape. */
export function previewLine(from: Pt, to: Rect): { x1: number; y1: number; x2: number; y2: number } {
  const c = center(to);
  const horizontal = Math.abs(c.x - from.x) > Math.abs(c.y - from.y);
  return {
    x1: from.x,
    y1: from.y,
    x2: horizontal ? (c.x > from.x ? to.x : to.x + to.w) : c.x,
    y2: horizontal ? c.y : c.y > from.y ? to.y : to.y + to.h,
  };
}

export function arrowGlyph(p: Pt, side: Dir, s: number): string {
  const [ux, uy] = side === 'right' ? [1, 0] : side === 'left' ? [-1, 0] : side === 'bottom' ? [0, 1] : [0, -1];
  const tip = { x: p.x + ux * s, y: p.y + uy * s };
  const wing = (k: number): string => `${p.x + ux * s * 0.1 - uy * s * 0.8 * k},${p.y + uy * s * 0.1 + ux * s * 0.8 * k}`;
  return `M${p.x - ux * s},${p.y - uy * s} L${tip.x},${tip.y} M${wing(1)} L${tip.x},${tip.y} L${wing(-1)}`;
}
