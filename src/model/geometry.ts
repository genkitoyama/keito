import { UI_FONT, measure, wrapText } from './text';
import { type Run, type Seg, STUB, bordersOf, hugCost, roomAround, chip, collides, facing, isH, lanes, routeAround } from './router';
import { seqLayout, seqScale } from './sequence';
import type { DeviceNode, Doc, Edge, EdgeEnd, Node, Port, PortSide, Pt, Rect } from './types';

export const GRID = 10;
export const DEV = { head: 44, row: 22, pad: 8 };
/** The bold name in a device's header; every extra line of it makes the header taller. */
export const DEVICE_NAME = { size: 13, line: 13 * 1.4 };

/** Height of a device's header: one line of name (and the maker / model line), plus any further lines of name. */
/** How wide a device's name may run: a venue device keeps clear of the 会場 mark on either side. */
export const deviceNameWidth = (d: DeviceNode): number => d.w - 12 - (d.venue ? 48 : 0);

export function deviceHead(d: DeviceNode): number {
  const lines = wrapText(d.text, deviceNameWidth(d), `700 ${DEVICE_NAME.size}px ${UI_FONT}`).length;
  return DEV.head + (Math.max(1, lines) - 1) * DEVICE_NAME.line;
}
export const snap = (v: number): number => Math.round(v / GRID) * GRID;

export type Dir = 'left' | 'right' | 'top' | 'bottom';
export interface Anchor extends Pt {
  dir: Dir;
  rect: Rect;
}

export const portsOn = (d: DeviceNode, side: PortSide): Port[] => d.ports.filter((p) => p.side === side);

/** Sizes as worked out, per node: nodes are never changed in place, so a node keeps its size. */
const sizes = new WeakMap<Node, { w: number; h: number }>();

export function nodeSize(n: Node): { w: number; h: number } {
  if (n.type !== 'device' && n.type !== 'sequence') return { w: n.w, h: n.h };
  const hit = sizes.get(n);
  if (hit) return hit;
  const size = measuredSize(n);
  sizes.set(n, size);
  return size;
}

/** A device's height follows its name and ports, a sequence diagram's its messages. */
function measuredSize(n: Node): { w: number; h: number } {
  if (n.type === 'device') {
    const rows = Math.max(1, portsOn(n, 'left').length, portsOn(n, 'right').length);
    return { w: n.w, h: deviceHead(n) + rows * DEV.row + DEV.pad };
  }
  if (n.type === 'sequence') {
    const d = seqLayout(n.text, n.w, n.h, seqScale(n.fontSize));
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
    y: d.y + deviceHead(d) + i * DEV.row + DEV.row / 2,
    side: port.side,
  };
}

/** How far in front of a port another line crossing there blocks its way in: the run straight out of the port. */
const FRONT = STUB;

/**
 * The way into each port that has a line: the stretch in front of it a line runs out of or into.
 * Another line passing across it blocks that way in (lines then step round it at the last moment).
 */
export function portFronts(doc: Doc): { node: string; port: string; seg: Seg }[] {
  const used = new Set(doc.edges.flatMap((e) => [`${e.from.node}|${e.from.port}`, `${e.to.node}|${e.to.port}`]));
  return doc.nodes.flatMap((n) =>
    n.type !== 'device'
      ? []
      : n.ports.flatMap((p) => {
          const at = used.has(`${n.id}|${p.id}`) ? portPos(n, p.id) : null;
          return at ? [{ node: n.id, port: p.id, seg: { flat: true, at: at.y, lo: at.side === 'left' ? at.x - FRONT : at.x, hi: at.side === 'left' ? at.x : at.x + FRONT } }] : [];
        }),
  );
}

/** The point on one side of a box, `at` of the way along it from its left or top end (the middle by default). */
export function sidePoint(r: Rect, dir: Dir, at = 0.5): Pt {
  const x = r.x + r.w * at;
  const y = r.y + r.h * at;
  if (dir === 'left') return { x: r.x, y };
  if (dir === 'right') return { x: r.x + r.w, y };
  if (dir === 'top') return { x, y: r.y };
  return { x, y: r.y + r.h };
}

/** Where an edge end attaches. Ends without a port pick the side facing `toward`. */
export function anchorOf(node: Node, end: EdgeEnd, toward: Pt): Anchor {
  const rect = nodeRect(node);
  if (node.type === 'device' && end.port) {
    const p = portPos(node, end.port);
    if (p) return { x: p.x, y: p.y, dir: p.side, rect };
  }
  if (end.side && node.type !== 'junction') return { ...sidePoint(rect, end.side, end.at), dir: end.side, rect };
  const c = center(rect);
  const dx = (toward.x - c.x) / Math.max(1, rect.w);
  const dy = (toward.y - c.y) / Math.max(1, rect.h);
  const dir: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  // Lines meet in the middle of a junction dot, not on its rim.
  if (node.type === 'junction') return { x: c.x, y: c.y, dir, rect };
  return { ...sidePoint(rect, dir), dir, rect };
}

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

/**
 * Orthogonal route between two anchors. `lane` shifts the shared middle segment so parallel cables
 * don't overlap; `outward` is how much further out a line goes when it must go round (it runs past
 * the ends, or loops below), distinct for lines leaving one box so they lie side by side.
 */
export function route(a: Anchor, b: Anchor, lane = 0, outward = Math.abs(lane)): Pt[] {
  const ha = isH(a.dir);
  const hb = isH(b.dir);
  if (!ha && !hb) return route(flip(a), flip(b), lane, outward).map(flipPt);
  if (!ha && hb) return route(b, a, lane, outward).reverse();
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
        else my = Math.max(aB, bB) + 24 + outward;
        pts.push(s1, { x: s1.x, y: my }, { x: s2.x, y: my }, s2);
      }
    } else {
      const ex = a.dir === 'right' ? Math.max(s1.x, s2.x) + outward : Math.min(s1.x, s2.x) - outward;
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
const chipCache = new WeakMap<Doc, Rect[]>();

/** How far out from a shared end merging lines meet, before running in together. */
const MERGE = 22;

/** The meeting point of lines merging into `end`: out in front of it, facing the same way. */
function meetingPoint(end: Anchor): Anchor {
  const dx = end.dir === 'left' ? -MERGE : end.dir === 'right' ? MERGE : 0;
  const dy = end.dir === 'top' ? -MERGE : end.dir === 'bottom' ? MERGE : 0;
  const x = end.x + dx;
  const y = end.y + dy;
  // The box it belongs to reaches out to it, so a line coming round the back still goes round the box.
  const r = end.rect;
  const x0 = Math.min(r.x, x);
  const y0 = Math.min(r.y, y);
  return { x, y, dir: end.dir, rect: { x: x0, y: y0, w: Math.max(r.x + r.w, x) - x0, h: Math.max(r.y + r.h, y) - y0 } };
}

/**
 * What a line must not run through: every node except area frames (lines belong inside those),
 * free text (captions are meant to sit next to lines), junctions (lines meet there) and pictures
 * laid under the drawing (a floor plan is under everything, not in the way).
 */
export const obstaclesOf = (doc: Doc): Rect[] => doc.nodes.filter((n) => n.type !== 'frame' && n.type !== 'text' && n.type !== 'junction' && !isUnderlay(n)).map(nodeRect);

/**
 * The title in the top corner of each area frame, as drawn: lines go round it rather than through
 * the words, as they would through a box.
 */
export const frameTitles = (doc: Doc): Rect[] =>
  doc.nodes.flatMap((n) => {
    if (n.type !== 'frame' || !n.text.trim()) return [];
    const size = n.fontSize ?? 13;
    const w = Math.max(...n.text.split('\n').map((line) => measure(line, `${n.bold === false ? 400 : 700} ${size}px ${UI_FONT}`)));
    return [{ x: n.x + 4, y: n.y + 4, w: Math.min(n.w - 8, w + 16), h: size + 11 }];
  });

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
  const obstacles = [...obstaclesOf(doc), ...frameTitles(doc)];
  const out = new Map<string, Pt[]>();
  // First the attachment points of every line, then one pass that hands jogging lines their bends.
  const drawn = doc.edges.flatMap((e, index) => {
    const a = nodes.get(e.from.node);
    const b = nodes.get(e.to.node);
    if (!a || !b) return [];
    const pa = anchorOf(a, e.from, center(nodeRect(b)));
    const pb = anchorOf(b, e.to, center(nodeRect(a)));
    // Re-aim port-less ends at the real attachment point of the other end.
    const ra = e.from.port ? pa : anchorOf(a, e.from, pb);
    const rb = e.to.port ? pb : anchorOf(b, e.to, pa);
    // A junction dot lets the line leave whichever way makes a single clean corner into the other
    // end: straight on when they are level, else square to the side the other end is entered from.
    const turn = (n: Node, self: Anchor, other: Anchor, dot: boolean): Anchor => {
      if (n.type !== 'junction' || dot) return self;
      const dx = other.x - self.x;
      const dy = other.y - self.y;
      const along: Dir = dx >= 0 ? 'right' : 'left';
      const across: Dir = dy >= 0 ? 'bottom' : 'top';
      const dir = isH(other.dir) ? (Math.abs(dy) < 0.5 ? along : across) : Math.abs(dx) < 0.5 ? across : along;
      return { ...self, dir };
    };
    const ea = turn(a, ra, rb, b.type === 'junction');
    const eb = turn(b, rb, ra, a.type === 'junction');
    return [{ e, index, a, b, pa, pb, ea, eb, tagged: isTagged(doc, e) }];
  });
  const manual = (e: Edge) => !!e.route && e.route.length >= 2;
  // Lines into the same place (one port, or one side of a box) merge in front of it: each runs to a
  // meeting point out from the end, and from there they go in together under a single arrowhead.
  const into = new Map<string, (typeof drawn)[number][]>();
  for (const d of drawn) {
    if (d.tagged || manual(d.e) || d.a === d.b || d.b.type === 'junction') continue;
    const k = `${d.b.id}|${Math.round(d.eb.x)},${Math.round(d.eb.y)}|${d.eb.dir}`;
    into.set(k, [...(into.get(k) ?? []), d]);
  }
  const meets = new Map<string, Anchor>();
  for (const list of into.values()) if (list.length > 1) for (const d of list) meets.set(d.e.id, meetingPoint(d.eb));
  const runs: Run[] = [];
  // A line drawn as tags leaves a chip beside each port; bends keep off those too.
  const chips: Rect[] = [];
  for (const { e, a, b, ea, eb: end, tagged } of drawn) {
    const eb = meets.get(e.id) ?? end;
    if (tagged) chips.push(chip(ea, `XXX-00 → ${b.text}`), chip(end, `⚡ ${a.text} ${e.label}`));
    else if (a !== b && !manual(e) && Math.abs(ea.y - eb.y) >= 0.5) {
      if (facing(ea, eb)) runs.push({ id: e.id, l: ea, r: eb });
      else if (facing(eb, ea)) runs.push({ id: e.id, l: eb, r: ea });
    }
  }
  const frames = doc.nodes.filter((n) => n.type === 'frame').map(nodeRect);
  const borders = bordersOf(frames);
  const bends = lanes(runs, [...obstacles, ...chips], frames, portFronts(doc).map((f) => f.seg));
  for (const { e, index, a, b, pa, pb, ea, eb, tagged } of drawn) {
    const siblings = bySource.get(e.from.node)!;
    const lane = (siblings.indexOf(e) - (siblings.length - 1) / 2) * 8;
    const outward = siblings.indexOf(e) * 8;
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
    // A merging line is routed to its meeting point and goes on from there with the others.
    const meet = meets.get(e.id);
    const to = meet ?? eb;
    const end = (pts: Pt[]): Pt[] => (meet ? simplify([...pts, { x: eb.x, y: eb.y }]) : pts);
    const x = bends.get(e.id);
    if (x !== undefined) {
      out.set(e.id, end([{ x: ea.x, y: ea.y }, { x, y: ea.y }, { x, y: to.y }, { x: to.x, y: to.y }]));
      continue;
    }
    // A line from a box back into the same place on it (a flow looping on itself) has no run of its
    // own: it goes out and comes back round the corner, onto the next side.
    if (a === b && (e.from.port ? e.from.port === e.to.port : !e.to.port) && Math.hypot(ea.x - to.x, ea.y - to.y) < 1) {
      out.set(e.id, selfLoop(ea));
      continue;
    }
    let pts = route(ea, to, lane, outward);
    // The plain elbow would cut through a node, or run along the edge of one or of an area: find a
    // way around (kept if it is clearer). Lines drawn as tags have no run to fix.
    if (a !== b && !tagged) {
      const room = roomAround(obstacles, [nodeRect(a), nodeRect(b), ea.rect, to.rect]);
      const unclear = (p: Pt[]) => (collides(p, room) ? 1000 : 0) + hugCost(p, borders);
      const blocked = collides(pts, obstacles);
      if (blocked || unclear(pts) > 0) {
        // Neighbouring lines keep slightly different clearances so they don't sit on top of each other.
        const around = routeAround(ea, to, obstacles, 8 + (index % 3) * 4, borders);
        if (around && (blocked || unclear(around) < unclear(pts))) pts = simplify(around);
      }
    }
    out.set(e.id, end(pts));
  }
  routeCache.set(doc, out);
  chipCache.set(doc, chips);
  return out;
}

/** Where the tags of lines drawn as tags (power, by default) sit beside their ports, as routing keeps clear of them. */
export function tagChips(doc: Doc): Rect[] {
  routeEdges(doc);
  return chipCache.get(doc) ?? [];
}

/** A loop out of one side of a box and back in at the next side round (right → top, top → left …). */
function selfLoop(a: Anchor): Pt[] {
  const out = 24;
  const r = a.rect;
  const c = center(r);
  if (a.dir === 'right') return [{ x: a.x, y: a.y }, { x: a.x + out, y: a.y }, { x: a.x + out, y: r.y - out }, { x: c.x, y: r.y - out }, { x: c.x, y: r.y }];
  if (a.dir === 'top') return [{ x: a.x, y: a.y }, { x: a.x, y: a.y - out }, { x: r.x - out, y: a.y - out }, { x: r.x - out, y: c.y }, { x: r.x, y: c.y }];
  if (a.dir === 'left') return [{ x: a.x, y: a.y }, { x: a.x - out, y: a.y }, { x: a.x - out, y: r.y + r.h + out }, { x: c.x, y: r.y + r.h + out }, { x: c.x, y: r.y + r.h }];
  return [{ x: a.x, y: a.y }, { x: a.x, y: a.y + out }, { x: r.x + r.w + out, y: a.y + out }, { x: r.x + r.w + out, y: c.y }, { x: r.x + r.w, y: c.y }];
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

/** Caption size of a picture when none is chosen. */
export const CAPTION_SIZE = 13;
/** Room between a picture and its caption. */
const CAPTION_GAP = 6;

/** Where a picture's caption is drawn, just above or below it and as wide; null with none. */
export function captionBox(n: Node): Rect | null {
  if (n.type !== 'image' || !n.caption?.trim()) return null;
  const size = n.fontSize ?? CAPTION_SIZE;
  // Line height as in the board's text blocks (TEXT.lineHeight).
  const h = wrapText(n.caption, n.w, `400 ${size}px ${UI_FONT}`).length * size * 1.4;
  return { x: n.x, y: n.captionAt === 'top' ? n.y - CAPTION_GAP - h : n.y + n.h + CAPTION_GAP, w: n.w, h };
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
    const c = captionBox(n);
    if (c) {
      add(c.x, c.y);
      add(c.x + c.w, c.y + c.h);
    }
  }
  if (!ids) for (const pts of routeEdges(doc).values()) for (const p of pts) add(p.x, p.y);
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** An underlay (a floor plan beneath the drawing) is never what the pointer is on. */
export const isUnderlay = (n: Node): boolean => n.type === 'image' && !!n.under;

/** Topmost node under a point; frames only when nothing else is hit. */

export function nodeAt(doc: Doc, p: Pt): Node | null {
  let frame: Node | null = null;
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i];
    // A picture's caption is part of it.
    const caption = captionBox(n);
    if (isUnderlay(n) || !(contains(nodeRect(n), p) || (caption && contains(caption, p)))) continue;
    // An area is only hit where nothing on it is.
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
  const over = new Map<string, Set<string>>();
  const gaps = new Map<string, Pt[]>();
  const unhopped = new Map<string, Pt[]>();
  for (const [id, pts] of routes) {
    if (tagged.has(id)) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.abs(a.y - b.y) > 0.5) continue;
      // Every crossing; a hop only where there is room for it, clear of the corners either end.
      const crossing = verticals.filter((v) => v.id !== id && v.x > Math.min(a.x, b.x) + 1 && v.x < Math.max(a.x, b.x) - 1 && a.y > v.y0 + 1 && a.y < v.y1 - 1);
      const under = crossing.filter((v) => v.x > Math.min(a.x, b.x) + HOP_ROOM && v.x < Math.max(a.x, b.x) - HOP_ROOM);
      for (const v of crossing) {
        gaps.set(v.id, [...(gaps.get(v.id) ?? []), { x: v.x, y: a.y }]);
        if (!under.includes(v)) unhopped.set(v.id, [...(unhopped.get(v.id) ?? []), { x: v.x, y: a.y }]);
      }
      if (!under.length) continue;
      if (!out.has(id)) out.set(id, new Map());
      out.get(id)!.set(i - 1, [...new Set(under.map((v) => v.x))]);
      over.set(id, new Set([...(over.get(id) ?? []), ...under.map((v) => v.id)]));
    }
  }
  hopCache.set(doc, out);
  overCache.set(doc, over);
  gapCache.set(doc, { gaps, unhopped });
  return out;
}

const overCache = new WeakMap<Doc, Map<string, Set<string>>>();
const gapCache = new WeakMap<Doc, { gaps: Map<string, Pt[]>; unhopped: Map<string, Pt[]> }>();

/** How far from either end of a run across a hop needs: its corner's rounding and the hop's own width. */
export const HOP_ROOM = 13;

/**
 * Where each line running down is crossed by one running across and no hop is drawn (every
 * crossing when hops are off; those too near a corner for one when on): the line down breaks
 * there for a moment, so a crossing does not read as the two lines joining.
 */
export function crossingGaps(doc: Doc): Map<string, Pt[]> {
  crossings(doc);
  const cached = gapCache.get(doc)!;
  return doc.hops ? cached.unhopped : cached.gaps;
}

/**
 * The lines in painting order when crossings are drawn as hops: a line that hops over another
 * comes after it, so the hop sits in front. Otherwise the order of the board is kept.
 */
export function hopOrder(doc: Doc): Edge[] {
  crossings(doc);
  const over = overCache.get(doc)!;
  if (!over.size) return doc.edges;
  const byId = new Map(doc.edges.map((e) => [e.id, e]));
  const out: Edge[] = [];
  const seen = new Set<string>();
  const place = (e: Edge) => {
    if (seen.has(e.id)) return;
    // Marked before its dependencies: two lines hopping over each other must not go round forever.
    seen.add(e.id);
    for (const id of over.get(e.id) ?? []) {
      const below = byId.get(id);
      if (below) place(below);
    }
    out.push(e);
  };
  doc.edges.forEach(place);
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

/** The side of its box a line's end goes into, as drawn (the way its last stretch runs). */
export function sideOf(doc: Doc, edge: Edge, which: 'from' | 'to'): Dir | undefined {
  const pts = routeEdges(doc).get(edge.id);
  if (!pts || pts.length < 2) return undefined;
  const [end, before] = which === 'to' ? [pts[pts.length - 1], pts[pts.length - 2]] : [pts[0], pts[1]];
  const dx = before.x - end.x;
  const dy = before.y - end.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

/** The drawn line passing closest to `p` within `tol`, with the point on it. Lines drawn as tags have no run to hit. */
export function edgeNear(doc: Doc, p: Pt, tol: number, skip?: string): { edge: Edge; at: Pt } | null {
  let best: { edge: Edge; at: Pt; d: number } | null = null;
  const routes = routeEdges(doc);
  for (const edge of doc.edges) {
    const pts = routes.get(edge.id);
    if (!pts || edge.id === skip || isTagged(doc, edge)) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = len ? Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len)) : 0;
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d <= tol && (!best || d < best.d)) best = { edge, at, d };
    }
  }
  return best && { edge: best.edge, at: best.at };
}

/**
 * The part of the board made of the given nodes and lines, for exporting a selection. An area
 * frame brings what is inside it; a selected line brings both its ends; a line between two
 * nodes that are in comes along, through a branch point if need be.
 */
export function subset(doc: Doc, ids: Iterable<string>): Doc {
  const want = new Set(ids);
  const keep = new Set<string>();
  for (const n of doc.nodes) {
    if (!want.has(n.id)) continue;
    keep.add(n.id);
    // Everything inside the area comes along, areas nested in it and their contents included.
    if (n.type === 'frame') for (const m of doc.nodes) if (m !== n && contains(nodeRect(n), center(nodeRect(m)))) keep.add(m.id);
  }
  for (const e of doc.edges) {
    if (!want.has(e.id)) continue;
    keep.add(e.from.node);
    keep.add(e.to.node);
  }
  // Branch points keep a cable whole between kept nodes, however many it runs through: take every
  // dot, then shed the ones left at a dead end until each remaining one links two kept things.
  const near = (id: string): string[] => doc.edges.flatMap((e) => (e.from.node === id ? [e.to.node] : e.to.node === id ? [e.from.node] : []));
  const dots = new Set(doc.nodes.filter((n) => n.type === 'junction' && !keep.has(n.id)).map((n) => n.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of dots) {
      if (new Set(near(id).filter((x) => keep.has(x) || dots.has(x))).size < 2) {
        dots.delete(id);
        changed = true;
      }
    }
  }
  for (const id of dots) keep.add(id);
  return {
    ...doc,
    whole: doc.whole ?? doc,
    nodes: doc.nodes.filter((n) => keep.has(n.id)),
    edges: doc.edges.filter((e) => want.has(e.id) || (keep.has(e.from.node) && keep.has(e.to.node))),
  };
}
