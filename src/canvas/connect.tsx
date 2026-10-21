// Where a line being drawn or re-attached will go: the box, port or line under the pointer, and its preview.
import { anchorOf, edgeNear, type Dir, nodeAt, nodeRect, pathD, portAt, routeEdges, sideOf, sidePoint, snap } from '../model/geometry';
import { type CreateKind, allIds, claimPort, junctionSignal, makeEdge, makeNode } from '../model/presets';
import { traceRoute } from '../model/trace';
import { type Doc, type Edge, type EdgeEnd, type Node, type Pt, type Rect } from '../model/types';
import { EdgeView, SCREEN } from './render';
import { type ConnectDrag, type ReconnectDrag, type Ghost, type Plan, SIDES, ACCENT, canConnect, portOf } from './drag';

/** How near (screen px) to a box's side dot the end goes in at that side. */
const SNAP = 18;

/** How near (screen px) to a rectangle's edge the end goes in at that very place on it. */
const RIM = 10;

/** Boxes whose edge is straight all along, so a line may go in anywhere on it (not a diamond or an ellipse). */
const straightEdged = (n: Node): boolean => (n.type === 'shape' && n.shape === 'rect') || n.type === 'sticky' || n.type === 'text';

/**
 * The place on a rectangle's edge nearest `p`, when `p` is within `reach` of it: the side, and
 * how far along it (on a 5px step, kept off the corners). Near the middle it is the side's dot.
 */
function rimAt(r: Rect, p: Pt, reach: number): { side: Dir; at?: number } | null {
  const hits = SIDES.map((side) => {
    const across = side === 'left' ? p.x - r.x : side === 'right' ? p.x - (r.x + r.w) : side === 'top' ? p.y - r.y : p.y - (r.y + r.h);
    const along = side === 'left' || side === 'right' ? p.y - r.y : p.x - r.x;
    const len = side === 'left' || side === 'right' ? r.h : r.w;
    return { side, gap: Math.abs(across), along, len };
  }).filter((h) => h.gap <= reach && h.along >= -reach && h.along <= h.len + reach);
  const hit = hits.sort((a, b) => a.gap - b.gap)[0];
  if (!hit || hit.len <= 0) return null;
  const at = Math.min(0.95, Math.max(0.05, (Math.round(hit.along / 5) * 5) / hit.len));
  return Math.abs(at - 0.5) * hit.len < 5 ? { side: hit.side } : { side: hit.side, at: Math.round(at * 1000) / 1000 };
}

/** What an end let go at `p` lands on: a port, a box (at one of its sides, or the side facing the line), or a line to merge with. */
function dropAt(doc: Doc, p: Pt, k: number, which: 'from' | 'to', skip?: string): { end: EdgeEnd; doc: Doc; box?: string; line?: string } | null {
  const port = portAt(doc, p);
  if (port) return { end: port, doc, box: port.node };
  // A side dot sits on the rim, half outside the box: it is looked for before the box itself.
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i];
    if (!canConnect(n)) continue;
    const r = nodeRect(n);
    const side = SIDES.find((d) => {
      const q = sidePoint(r, d);
      return Math.hypot(q.x - p.x, q.y - p.y) <= SNAP / k;
    });
    if (side) return { end: { node: n.id, side }, doc, box: n.id };
    // Anywhere else along a rectangle's edge: the line goes in at that place.
    const rim = straightEdged(n) ? rimAt(r, p, RIM / k) : null;
    if (rim) return { end: { node: n.id, ...rim }, doc, box: n.id };
  }
  const over = nodeAt(doc, p);
  if (over && over.type !== 'frame') return { end: { node: over.id }, doc, box: over.id };
  const line = edgeNear(doc, p, 8 / k, skip);
  if (!line) return null;
  return { ...mergeAt(doc, line.edge, which), line: line.edge.id };
}

const planKey = (t: { end: EdgeEnd; box?: string; line?: string }): string => `${t.end.node}|${t.end.port ?? ''}|${t.end.side ?? ''}|${t.end.at ?? ''}|${t.line ?? ''}`;

/** The corners of a line traced along `trail` (with the ends it has on `doc`), or nothing for a plain pull. */
function tracedRoute(doc: Doc, edge: Edge, trail: Pt[], k: number): Pt[] | undefined {
  const a = doc.nodes.find((n) => n.id === edge.from.node);
  const b = doc.nodes.find((n) => n.id === edge.to.node);
  if (!a || !b || trail.length < 3) return undefined;
  // Each end faces the way the trail leaves it (a port's side is its own).
  const from = anchorOf(a, edge.from, trail[1]);
  const to = anchorOf(b, edge.to, trail[trail.length - 2]);
  return traceRoute(trail, from, to, TRACE / k);
}

/** How far (screen px) the hand may wander from a straight stroke before it counts as a corner. */
const TRACE = 16;

/** A new line pulled from a dot or a port and let go at `p`. */
export function planConnect(doc: Doc, d: ConnectDrag, p: Pt, k: number): Plan | null {
  // A line pulled from an input comes from where the line it is dropped on comes from.
  const which = portOf(doc, d.from)?.side === 'left' ? 'from' : 'to';
  const t = dropAt(doc, p, k, which);
  if (!t || t.end.node === d.from.node) return null;
  const base = t.doc;
  const merged = t.line ? doc.edges.find((x) => x.id === t.line) : undefined;
  let to = t.end;
  // Pulled from a box's dot, the line leaves from that side.
  let from: EdgeEnd = d.side && !d.from.port ? { ...d.from, side: d.side } : d.from;
  const isDot = (end: EdgeEnd) => base.nodes.find((n) => n.id === end.node)?.type === 'junction';
  // Cables run output → input regardless of which end the drag started from.
  if (portOf(base, from)?.side === 'left' && portOf(base, to)?.side !== 'left') [from, to] = [to, from];
  else if (isDot(from) && portOf(base, to)?.side === 'right') [from, to] = [to, from];
  const signal = portOf(base, from)?.signal ?? portOf(base, to)?.signal ?? merged?.signal ?? junctionSignal(base, to.node) ?? junctionSignal(base, from.node) ?? 'flow';
  // An end dropped on a device body takes a free port of that signal (a new one if all are used),
  // so a row of devices can be plugged into a UPS without managing its outlets by hand.
  let next = base;
  if (!from.port) ({ end: from, doc: next } = claimPort(next, from.node, signal, 'right', from.side, from.at));
  if (!to.port) ({ end: to, doc: next } = claimPort(next, to.node, signal, 'left', to.side, to.at));
  // A line merging into another looks like it, so the two read as one from where they meet.
  const edge: Edge = { ...makeEdge(allIds(base), from, to, signal), ...(merged ? { arrow: merged.arrow, color: merged.color, dash: merged.dash } : {}) };
  // Traced around things on the way: the line keeps the corners the pointer took.
  const traced = merged ? undefined : tracedRoute(next, edge, [...d.trail, p], k);
  if (traced) edge.route = traced;
  return { doc: { ...next, edges: [...next.edges, edge] }, edge: edge.id, box: t.box, side: t.end.side, at: t.end.at, line: t.line, key: `${planKey(t)}|${JSON.stringify(traced ?? '')}` };
}

/** One end of a line dragged elsewhere and let go at `p`. */
export function planReconnect(doc: Doc, d: ReconnectDrag, p: Pt, k: number): Plan | null {
  const edge = doc.edges.find((x) => x.id === d.id);
  if (!edge) return null;
  const keep = d.end === 'from' ? edge.to : edge.from;
  const t = dropAt(doc, p, k, d.end, d.id);
  if (!t || t.end.node === keep.node) return null;
  // Dropped on a device body: take a free port of the cable's type on the matching side.
  const claimed = t.end.port ? { end: t.end, doc: t.doc } : claimPort(t.doc, t.end.node, edge.signal, d.end === 'from' ? 'right' : 'left', t.end.side, t.end.at);
  const next = { ...claimed.doc, edges: claimed.doc.edges.map((x) => (x.id === d.id ? { ...x, [d.end]: claimed.end, route: undefined } : x)) };
  return { doc: next, edge: d.id, box: t.box, side: t.end.side, at: t.end.at, line: t.line, key: planKey(t) };
}

/** Let go on no box (an area is open ground): back on the box it came from, it is called off. */
function onEmpty(doc: Doc, p: Pt): boolean {
  const over = nodeAt(doc, p);
  return !over || over.type === 'frame';
}

/** A line pulled from a box and let go on empty canvas: a box of the same kind there, at its end. */
export function planSpawn(doc: Doc, d: ConnectDrag, p: Pt): Plan | null {
  const source = doc.nodes.find((n) => n.id === d.from.node);
  if (!source || !canConnect(source) || !onEmpty(doc, p) || Math.hypot(p.x - d.at.x, p.y - d.at.y) <= 30) return null;
  const taken = allIds(doc);
  const kind: CreateKind = source.type === 'shape' ? source.shape : source.type;
  const n = makeNode(kind, snap(p.x), snap(p.y), taken, '', source.type === 'text' ? undefined : source.color);
  taken.add(n.id);
  const edge = makeEdge(taken, d.side ? { ...d.from, side: d.side } : d.from, { node: n.id }, 'flow');
  return { doc: { ...doc, nodes: [...doc.nodes, n], edges: [...doc.edges, edge] }, edge: edge.id, made: n.id, key: `+${snap(p.x)},${snap(p.y)}` };
}

/**
 * A line being pulled, as it will be: the line itself routed as it will run (faint), what it
 * lands on lit up — the box (its dots, the one it goes in at enlarged), or the line it merges
 * with — and on empty canvas the box that will be made there.
 */
export function ConnectGhost({ ghost, doc, k }: { ghost: Extract<Ghost, { kind: 'connect' }>; doc: Doc; k: number }) {
  const { plan } = ghost;
  if (!plan) {
    return (
      <g pointerEvents="none">
        <line x1={ghost.a.x} y1={ghost.a.y} x2={ghost.b.x} y2={ghost.b.y} stroke={ACCENT} strokeWidth={2 / k} strokeDasharray={`${6 / k} ${4 / k}`} />
      </g>
    );
  }
  const edge = plan.doc.edges.find((e) => e.id === plan.edge);
  const box = plan.box ? doc.nodes.find((n) => n.id === plan.box) : undefined;
  const made = plan.made ? plan.doc.nodes.find((n) => n.id === plan.made) : undefined;
  const m = made && nodeRect(made);
  const line = plan.line ? routeEdges(doc).get(plan.line) : undefined;
  const r = box && nodeRect(box);
  return (
    <g pointerEvents="none">
      {line && <path d={pathD(line, 8)} fill="none" stroke={ACCENT} strokeOpacity={0.22} strokeWidth={10 / k} strokeLinecap="round" strokeLinejoin="round" />}
      {r && box && box.type !== 'device' && <rect x={r.x - 3 / k} y={r.y - 3 / k} width={r.w + 6 / k} height={r.h + 6 / k} rx={6 / k} fill="none" stroke={ACCENT} strokeOpacity={plan.side ? 0.35 : 0.8} strokeWidth={1.5 / k} />}
      {r &&
        box &&
        canConnect(box) &&
        SIDES.map((side) => {
          const q = sidePoint(r, side);
          const on = plan.side === side && plan.at == null;
          return <circle key={side} cx={q.x} cy={q.y} r={(on ? 7 : 3.5) / k} fill={on ? ACCENT : '#fff'} stroke={ACCENT} strokeWidth={1.5 / k} />;
        })}
      {/* Let go on the edge away from a dot: the very place it will go in. */}
      {r && plan.side && plan.at != null && (() => {
        const q = sidePoint(r, plan.side, plan.at);
        return <circle cx={q.x} cy={q.y} r={6 / k} fill={ACCENT} stroke="#fff" strokeWidth={1.5 / k} />;
      })()}
      {m && <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={6} fill="rgba(37,99,235,0.06)" stroke={ACCENT} strokeOpacity={0.6} strokeWidth={1.5 / k} strokeDasharray={`${5 / k} ${4 / k}`} />}
      {edge && (
        <g opacity={0.7}>
          <EdgeView doc={plan.doc} e={edge} theme={SCREEN} hideLabel />
        </g>
      )}
    </g>
  );
}

/**
 * Merging with a line at one of its ends: that end, held to the side of the box it goes into now,
 * and the board with the line's own end held there too, so the two keep together as boxes move.
 */
function mergeAt(doc: Doc, line: Edge, which: 'from' | 'to'): { doc: Doc; end: EdgeEnd } {
  const end = line[which];
  const side = end.port ? undefined : (end.side ?? sideOf(doc, line, which));
  if (!side) return { doc, end };
  const held = { ...end, side };
  return { end: held, doc: { ...doc, edges: doc.edges.map((e) => (e.id === line.id ? { ...e, [which]: held } : e)) } };
}
