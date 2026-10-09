import { CLEAR, type Run, chip, collides, lanes, routeAround } from './router';
import { parseSequence } from './sequence';
import type { DeviceNode, Doc, Edge, EdgeEnd, Node, Port, PortSide, Pt, Rect } from './types';

export const GRID = 10;
export const DEV = { head: 44, row: 22, pad: 8 };
export const snap = (v: number): number => Math.round(v / GRID) * GRID;

export type Dir = 'left' | 'right' | 'top' | 'bottom';
export interface Anchor extends Pt {
  dir: Dir;
  rect: Rect;
}

export const portsOn = (d: DeviceNode, side: PortSide): Port[] => d.ports.filter((p) => p.side === side);

export function nodeSize(n: Node): { w: number; h: number } {
  if (n.type === 'device') {
    const rows = Math.max(1, portsOn(n, 'left').length, portsOn(n, 'right').length);
    return { w: n.w, h: DEV.head + rows * DEV.row + DEV.pad };
  }
  if (n.type === 'sequence') {
    const d = parseSequence(n.text);
    return { w: d.w, h: d.h };
  }
  return { w: n.w, h: n.h };
}

export const nodeRect = (n: Node): Rect => ({ x: n.x, y: n.y, ...nodeSize(n) });
export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const contains = (r: Rect, p: Pt): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function portPos(d: DeviceNode, portId: string): (Pt & { side: PortSide }) | null {
  const port = d.ports.find((p) => p.id === portId);
  if (!port) return null;
  const i = portsOn(d, port.side).indexOf(port);
  return {
    x: port.side === 'left' ? d.x : d.x + d.w,
    y: d.y + DEV.head + i * DEV.row + DEV.row / 2,
    side: port.side,
  };
}

export function sidePoint(r: Rect, dir: Dir): Pt {
  const c = center(r);
  if (dir === 'left') return { x: r.x, y: c.y };
  if (dir === 'right') return { x: r.x + r.w, y: c.y };
  if (dir === 'top') return { x: c.x, y: r.y };
  return { x: c.x, y: r.y + r.h };
}

/** Where an edge end attaches. Ends without a port pick the side facing `toward`. */
export function anchorOf(node: Node, end: EdgeEnd, toward: Pt): Anchor {
  const rect = nodeRect(node);
  if (node.type === 'device' && end.port) {
    const p = portPos(node, end.port);
    if (p) return { x: p.x, y: p.y, dir: p.side, rect };
  }
  const c = center(rect);
  const dx = (toward.x - c.x) / Math.max(1, rect.w);
  const dy = (toward.y - c.y) / Math.max(1, rect.h);
  const dir: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  return { ...sidePoint(rect, dir), dir, rect };
}

const STUB = 18;
const isH = (d: Dir): boolean => d === 'left' || d === 'right';
const SWAP: Record<Dir, Dir> = { left: 'top', top: 'left', right: 'bottom', bottom: 'right' };
const flipPt = (p: Pt): Pt => ({ x: p.y, y: p.x });
const flip = (a: Anchor): Anchor => ({
  x: a.y,
  y: a.x,
  dir: SWAP[a.dir],
  rect: { x: a.rect.y, y: a.rect.x, w: a.rect.h, h: a.rect.w },
});
const stub = (a: Anchor): Pt => {
  if (a.dir === 'left') return { x: a.x - STUB, y: a.y };
  if (a.dir === 'right') return { x: a.x + STUB, y: a.y };
  if (a.dir === 'top') return { x: a.x, y: a.y - STUB };
  return { x: a.x, y: a.y + STUB };
};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Drop repeated points and bends that lie on a straight run. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (b && Math.abs(b.x - p.x) < 0.5 && Math.abs(b.y - p.y) < 0.5) continue;
    if (a && b && ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Orthogonal route between two anchors. `lane` shifts the shared middle segment so parallel cables don't overlap. */
export function route(a: Anchor, b: Anchor, lane = 0): Pt[] {
  const ha = isH(a.dir);
  const hb = isH(b.dir);
  if (!ha && !hb) return route(flip(a), flip(b), lane).map(flipPt);
  if (!ha && hb) return route(b, a, lane).reverse();
  const s1 = stub(a);
  const s2 = stub(b);
  const pts: Pt[] = [a];
  if (hb) {
    if (a.dir !== b.dir) {
      const facing = a.dir === 'right' ? s1.x <= s2.x : s1.x >= s2.x;
      if (facing) {
        const mx = clamp((s1.x + s2.x) / 2 + lane, Math.min(s1.x, s2.x), Math.max(s1.x, s2.x));
        pts.push({ x: mx, y: a.y }, { x: mx, y: b.y });
      } else {
        // Loop around: pass through the vertical gap between the boxes, or below both.
        const aB = a.rect.y + a.rect.h;
        const bB = b.rect.y + b.rect.h;
        let my: number;
        if (aB + 2 * GRID < b.rect.y) my = (aB + b.rect.y) / 2;
        else if (bB + 2 * GRID < a.rect.y) my = (bB + a.rect.y) / 2;
        else my = Math.max(aB, bB) + 24 + Math.abs(lane);
        pts.push(s1, { x: s1.x, y: my }, { x: s2.x, y: my }, s2);
      }
    } else {
      const ex = a.dir === 'right' ? Math.max(s1.x, s2.x) + Math.abs(lane) : Math.min(s1.x, s2.x) - Math.abs(lane);
      pts.push({ x: ex, y: a.y }, { x: ex, y: b.y });
    }
  } else {
    const okX = a.dir === 'right' ? b.x >= s1.x : b.x <= s1.x;
    const okY = b.dir === 'top' ? a.y <= s2.y : a.y >= s2.y;
    if (okX && okY) pts.push({ x: b.x, y: a.y });
    else pts.push(s1, { x: s1.x, y: s2.y }, s2);
  }
  pts.push(b);
  return simplify(pts);
}

/** Whether an edge is drawn as a pair of tags (net labels) instead of a line. */
export const isTagged = (doc: Doc, e: Edge): boolean => e.tag ?? (e.signal === 'power' && doc.powerTags !== false);

const orthogonal = (pts: Pt[]): boolean => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.5 || Math.abs(p.y - pts[i - 1].y) < 0.5);

const routeCache = new WeakMap<Doc, Map<string, Pt[]>>();

/** Routed polyline for every edge of the doc (memoised per doc snapshot). */
export function routeEdges(doc: Doc): Map<string, Pt[]> {
  const hit = routeCache.get(doc);
  if (hit) return hit;
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const bySource = new Map<string, Edge[]>();
  for (const e of doc.edges) {
    const list = bySource.get(e.from.node);
    if (list) list.push(e);
    else bySource.set(e.from.node, [e]);
  }
  // What a line must not run through: every node except area frames (lines belong inside those)
  // and free text (captions are meant to sit next to lines).
  const obstacles = doc.nodes.filter((n) => n.type !== 'frame' && n.type !== 'text').map(nodeRect);
  const out = new Map<string, Pt[]>();
  // First the attachment points of every line, then one pass that hands jogging lines their bends.
  const drawn = doc.edges.flatMap((e, index) => {
    const a = nodes.get(e.from.node);
    const b = nodes.get(e.to.node);
    if (!a || !b) return [];
    const pa = anchorOf(a, e.from, center(nodeRect(b)));
    const pb = anchorOf(b, e.to, center(nodeRect(a)));
    // Re-aim port-less ends at the real attachment point of the other end.
    const ea = e.from.port ? pa : anchorOf(a, e.from, pb);
    const eb = e.to.port ? pb : anchorOf(b, e.to, pa);
    return [{ e, index, a, b, pa, pb, ea, eb, tagged: isTagged(doc, e) }];
  });
  const manual = (e: Edge) => !!e.route && e.route.length >= 2;
  const facing = (l: Anchor, r: Anchor) => l.dir === 'right' && r.dir === 'left' && r.x - l.x >= CLEAR * 2;
  const runs: Run[] = [];
  // A line drawn as tags leaves a chip beside each port; bends keep off those too.
  const chips: Rect[] = [];
  for (const { e, a, b, ea, eb, tagged } of drawn) {
    if (tagged) chips.push(chip(ea, `XXX-00 → ${b.text}`), chip(eb, `⚡ ${a.text} ${e.label}`));
    else if (a !== b && !manual(e) && Math.abs(ea.y - eb.y) >= 0.5) {
      if (facing(ea, eb)) runs.push({ id: e.id, l: ea, r: eb });
      else if (facing(eb, ea)) runs.push({ id: e.id, l: eb, r: ea });
    }
  }
  const bends = lanes(runs, [...obstacles, ...chips], doc.nodes.filter((n) => n.type === 'frame').map(nodeRect));
  for (const { e, index, a, b, pa, pb, ea, eb, tagged } of drawn) {
    const siblings = bySource.get(e.from.node)!;
    const lane = (siblings.indexOf(e) - (siblings.length - 1) / 2) * 8;
    if (manual(e) && !tagged) {
      // Hand-placed bends: the first and last follow their end so the outer segments stay square.
      const mid = e.route!.map((p) => ({ x: p.x, y: p.y }));
      const ma = e.from.port ? pa : anchorOf(a, e.from, mid[0]);
      const mb = e.to.port ? pb : anchorOf(b, e.to, mid[mid.length - 1]);
      if (isH(ma.dir)) mid[0].y = ma.y;
      else mid[0].x = ma.x;
      if (isH(mb.dir)) mid[mid.length - 1].y = mb.y;
      else mid[mid.length - 1].x = mb.x;
      const pts = [{ x: ma.x, y: ma.y }, ...mid, { x: mb.x, y: mb.y }];
      // If the nodes moved so far that the bends no longer line up, fall back to automatic routing.
      if (orthogonal(pts)) {
        out.set(e.id, pts);
        continue;
      }
    }
    const x = bends.get(e.id);
    if (x !== undefined) {
      out.set(e.id, [{ x: ea.x, y: ea.y }, { x, y: ea.y }, { x, y: eb.y }, { x: eb.x, y: eb.y }]);
      continue;
    }
    let pts = route(ea, eb, lane);
    // The plain elbow would cut through a node: find a way around. Lines drawn as tags have no run to fix.
    if (a !== b && !tagged && collides(pts, obstacles)) {
      // Neighbouring lines keep slightly different clearances so they don't sit on top of each other.
      const around = routeAround(ea, eb, obstacles, 8 + (index % 3) * 4);
      if (around) pts = simplify(around);
    }
    out.set(e.id, pts);
  }
  routeCache.set(doc, out);
  return out;
}

export function pathD(pts: Pt[], radius = 6): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(radius, la / 2, lb / 2);
    if (r < 1) {
      d += ` L${p.x},${p.y}`;
      continue;
    }
    const p1 = { x: p.x + ((a.x - p.x) / la) * r, y: p.y + ((a.y - p.y) / la) * r };
    const p2 = { x: p.x + ((b.x - p.x) / lb) * r, y: p.y + ((b.y - p.y) / lb) * r };
    d += ` L${p1.x},${p1.y} Q${p.x},${p.y} ${p2.x},${p2.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

/** Point a fraction `at` of the way along the polyline — where the label sits (default: halfway). */
export function labelPoint(pts: Pt[], at = 0.5): Pt {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let rest = lens.reduce((a, b) => a + b, 0) * at;
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] && lens[i] > 0) {
      const t = rest / lens[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    rest -= lens[i];
  }
  return pts[0] ?? { x: 0, y: 0 };
}

export function docBounds(doc: Doc, ids?: Set<string>): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const n of doc.nodes) {
    if (ids && !ids.has(n.id)) continue;
    const r = nodeRect(n);
    add(r.x, r.y);
    add(r.x + r.w, r.y + r.h);
  }
  if (!ids) for (const pts of routeEdges(doc).values()) for (const p of pts) add(p.x, p.y);
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Topmost node under a point; frames only when nothing else is hit. */
export function nodeAt(doc: Doc, p: Pt): Node | null {
  let frame: Node | null = null;
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i];
    if (!contains(nodeRect(n), p)) continue;
    if (n.type !== 'frame') return n;
    frame ??= n;
  }
  return frame;
}

export function portAt(doc: Doc, p: Pt, tol = 10): EdgeEnd | null {
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i];
    if (n.type !== 'device') continue;
    for (const port of n.ports) {
      const pos = portPos(n, port.id)!;
      if (Math.hypot(pos.x - p.x, pos.y - p.y) <= tol) return { node: n.id, port: port.id };
    }
  }
  return null;
}

/** Smallest frame containing the node's centre — its location in the lists. */
export function frameOf(doc: Doc, n: Node): Node | null {
  const c = center(nodeRect(n));
  let best: Node | null = null;
  for (const f of doc.nodes) {
    if (f.type !== 'frame' || f.id === n.id || !contains(f, c)) continue;
    if (!best || f.w * f.h < best.w * best.h) best = f;
  }
  return best;
}

const hopCache = new WeakMap<Doc, Map<string, Map<number, number[]>>>();

/**
 * Where each edge's horizontal segments are crossed by another edge's vertical
 * segment: edge id → segment index → x positions. Drawings show these as hops.
 */
export function crossings(doc: Doc): Map<string, Map<number, number[]>> {
  const hit = hopCache.get(doc);
  if (hit) return hit;
  const routes = routeEdges(doc);
  const tagged = new Set(doc.edges.filter((e) => isTagged(doc, e)).map((e) => e.id));
  const verticals: { id: string; x: number; y0: number; y1: number }[] = [];
  for (const [id, pts] of routes) {
    if (tagged.has(id)) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 1) verticals.push({ id, x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
    }
  }
  const out = new Map<string, Map<number, number[]>>();
  for (const [id, pts] of routes) {
    if (tagged.has(id)) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.abs(a.y - b.y) > 0.5) continue;
      const lo = Math.min(a.x, b.x) + 8;
      const hi = Math.max(a.x, b.x) - 8;
      const xs = verticals.filter((v) => v.id !== id && v.x > lo && v.x < hi && a.y > v.y0 + 1 && a.y < v.y1 - 1).map((v) => v.x);
      if (!xs.length) continue;
      if (!out.has(id)) out.set(id, new Map());
      out.get(id)!.set(i - 1, [...new Set(xs)]);
    }
  }
  hopCache.set(doc, out);
  return out;
}

/** How far along a polyline (0–1 of its length) the point closest to `p` lies. */
export function nearestT(pts: Pt[], p: Pt): number {
  const lens = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
  const total = lens.reduce((a, b) => a + b, 0);
  if (!total) return 0.5;
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const l = lens[i];
    const u = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l * l))) : 0;
    const d = Math.hypot(p.x - (a.x + (b.x - a.x) * u), p.y - (a.y + (b.y - a.y) * u));
    if (d < best) {
      best = d;
      at = acc + l * u;
    }
    acc += l;
  }
  return at / total;
}
