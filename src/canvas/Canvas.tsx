import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as RMouseEvent, ReactNode, PointerEvent as RPointerEvent } from 'react';
import {
  DEV,
  type Dir,
  center,
  contains,
  docBounds,
  intersects,
  labelPoint,
  nodeAt,
  nodeRect,
  pathD,
  portAt,
  portPos,
  routeEdges,
  sidePoint,
  snap,
} from '../model/geometry';
import { type CreateKind, allIds, makeEdge, makeNode } from '../model/presets';
import { SEQUENCE_SAMPLE } from '../model/sequence';
import { COLOR_KEYS, PALETTE } from '../model/signals';
import { copySelection, pasteClipboard, useStore } from '../model/store';
import { wrapText } from '../model/text';
import type { Doc, EdgeEnd, Node, Pt, Rect, ShapeKind } from '../model/types';
import { EdgeView, INK, NodeView, SCREEN, TEXT, textSize, textWidth } from './render';

type Corner = 'nw' | 'ne' | 'sw' | 'se' | 'e';
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Pt; orig: Map<string, Pt>; lead: string; moved: boolean }
  | { kind: 'marquee'; start: Pt; base: string[] }
  | { kind: 'resize'; id: string; corner: Corner; start: Pt; orig: Rect; moved: boolean }
  | { kind: 'connect'; from: EdgeEnd; at: Pt; side?: Dir; sx: number; sy: number };
type Ghost = null | { kind: 'marquee'; rect: Rect } | { kind: 'connect'; a: Pt; b: Pt };

const SIDES: Dir[] = ['left', 'right', 'top', 'bottom'];
const MIN = { w: 40, h: 30 };
const ACCENT = '#2563eb';
const SPAWN_GAP = 70;
type Flowable = Extract<Node, { type: 'shape' | 'sticky' | 'text' }>;
const canConnect = (n: Node): n is Flowable => n.type === 'shape' || n.type === 'sticky' || n.type === 'text';
const canResize = (n: Node): boolean => n.type !== 'sequence';
const st = useStore.getState;

const portOf = (doc: Doc, end: EdgeEnd) => {
  const n = doc.nodes.find((x) => x.id === end.node);
  return n?.type === 'device' ? n.ports.find((p) => p.id === end.port) : undefined;
};

/** World point at the centre of the visible canvas. */
export function viewCenter(): Pt {
  const v = st().view;
  const el = document.getElementById('canvas');
  const { width, height } = el ? el.getBoundingClientRect() : { width: 800, height: 600 };
  return { x: (width / 2 - v.x) / v.k, y: (height / 2 - v.y) / v.k };
}

export function zoomBy(f: number): void {
  const s = st();
  const el = document.getElementById('canvas');
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const v = s.view;
  const k = Math.min(4, Math.max(0.1, v.k * f));
  s.setView({ k, x: width / 2 - ((width / 2 - v.x) * k) / v.k, y: height / 2 - ((height / 2 - v.y) * k) / v.k });
}

/** Add a node centred on `at` (default: a free spot near the view centre) and start typing into it. */
export function insertNode(kind: CreateKind, at?: Pt): void {
  const s = st();
  const p = at ?? viewCenter();
  const n = makeNode(kind, snap(p.x), snap(p.y), allIds(s.doc), kind === 'sequence' ? SEQUENCE_SAMPLE : '');
  n.x = snap(n.x);
  n.y = snap(n.y);
  if (!at && kind !== 'frame') {
    // Toolbar inserts step down until they no longer cover an existing node.
    const taken = s.doc.nodes.filter((m) => m.type !== 'frame').map(nodeRect);
    for (let i = 0; i < 30 && taken.some((r) => intersects(r, nodeRect(n))); i++) n.y += 40;
  }
  // Frames go to the back so they never cover what they contain.
  s.mutate((d) => ({ ...d, nodes: kind === 'frame' ? [n, ...d.nodes] : [...d.nodes, n] }));
  s.select([n.id]);
  s.setTool('select');
  if (kind !== 'sequence') s.setEditing(n.id);
}

/** Where a shape spawned from `side` of `src` lands: same width, one gap away, clear of other nodes. */
function spawnRect(doc: Doc, src: Node, side: Dir): Rect {
  const r = nodeRect(src);
  const horizontal = side === 'left' || side === 'right';
  const h = src.type === 'shape' ? Math.min(src.h, src.shape === 'diamond' ? 90 : 70) : src.type === 'sticky' ? Math.min(src.h, 120) : src.h;
  const out: Rect = {
    x: side === 'right' ? r.x + r.w + SPAWN_GAP : side === 'left' ? r.x - r.w - SPAWN_GAP : r.x,
    // Centres stay aligned so the connector runs dead straight.
    y: side === 'bottom' ? r.y + r.h + SPAWN_GAP : side === 'top' ? r.y - h - SPAWN_GAP : r.y + r.h / 2 - h / 2,
    w: src.w,
    h,
  };
  const others = doc.nodes.filter((n) => n.type !== 'frame').map(nodeRect);
  // Occupied: branch sideways (below for horizontal spawns, to the right for vertical ones).
  for (let i = 0; i < 30 && others.some((o) => intersects(o, out)); i++) {
    if (horizontal) out.y += out.h + 30;
    else out.x += out.w + 30;
  }
  return out;
}

/** Create the next step of a flow next to `id`, connected, and start typing into it. */
export function spawnFrom(id: string, side: Dir): void {
  const s = st();
  const src = s.doc.nodes.find((n) => n.id === id);
  if (!src || !canConnect(src)) return;
  const taken = allIds(s.doc);
  const kind: CreateKind = src.type === 'shape' ? src.shape : src.type;
  const n = { ...makeNode(kind, 0, 0, taken, '', src.type === 'text' ? undefined : src.color), ...spawnRect(s.doc, src, side) };
  const edge = makeEdge(taken, { node: src.id }, { node: n.id }, 'flow');
  s.mutate((d) => ({ ...d, nodes: [...d.nodes, n], edges: [...d.edges, edge] }));
  s.select([n.id]);
  s.setEditing(n.id);
}

/** Height a node needs for its text, or null when the text fits. */
function neededHeight(n: Node, text: string): number | null {
  if (!canConnect(n)) return null;
  const size = textSize(n);
  const lines = wrapText(text, textWidth(n), `400 ${size}px ${SCREEN.font}`).length;
  const shape = n.type === 'shape' ? n.shape : '';
  const need = (lines * size * TEXT.lineHeight + 22) * (shape === 'diamond' ? 1.7 : shape === 'ellipse' ? 1.3 : 1);
  return need > n.h ? Math.ceil(need / 10) * 10 : null;
}

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const doc = useStore((s) => s.doc);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const editing = useStore((s) => s.editing);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverSide, setHoverSide] = useState<Dir | null>(null);
  const [ghost, setGhost] = useState<Ghost>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [busy, setBusy] = useState(false);
  const [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null);
  const lastClick = useRef({ id: '', t: 0 });

  const world = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = st().view;
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  };
  const begin = (e: RPointerEvent, d: Drag) => {
    drag.current = d;
    setBusy(true);
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone (or synthetic) — the drag still works while over the canvas.
    }
  };
  const doubleClick = (id: string): boolean => {
    const now = performance.now();
    const hit = lastClick.current.id === id && now - lastClick.current.t < 450;
    lastClick.current = { id: hit ? '' : id, t: now };
    return hit;
  };

  useLayoutEffect(() => st().fit(), []);

  // Wheel: scroll pans, ctrl/⌘ + wheel (and trackpad pinch) zooms about the cursor.
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = st().view;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const k = Math.min(4, Math.max(0.1, v.k * Math.exp(-e.deltaY * 0.01)));
        st().setView({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
      } else {
        st().setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const typing = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button === 1 || tool === 'pan' || space) {
      const v = st().view;
      return begin(e, { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y });
    }
    if (e.button !== 0) return;
    const p = world(e);
    if (tool !== 'select') return insertNode(tool, p);
    // Double-click on empty canvas drops a box and starts typing, like a whiteboard.
    if (doubleClick('canvas')) return insertNode('rect', p);
    const base = e.shiftKey ? st().selection : [];
    st().select(base);
    begin(e, { kind: 'marquee', start: p, base });
  };

  const onNodeDown = (e: RPointerEvent, n: Node) => {
    if (e.button !== 0 || tool !== 'select' || space) return;
    e.stopPropagation();
    const s = st();
    if (doubleClick(n.id) && n.type !== 'sequence') {
      // Double-clicking the body of an area frame adds a box there; its title strip renames it.
      const p = world(e);
      if (n.type === 'frame' && p.y > n.y + 32) return insertNode('rect', p);
      s.select([n.id]);
      s.setEditing(n.id);
      return;
    }
    let sel = s.selection;
    if (e.shiftKey) sel = sel.includes(n.id) ? sel.filter((id) => id !== n.id) : [...sel, n.id];
    else if (!sel.includes(n.id)) sel = [n.id];
    s.select(sel);
    let lead = n.id;
    if (e.altKey && sel.includes(n.id)) {
      // Alt-drag leaves the originals behind and drags fresh copies.
      const index = sel.filter((id) => s.doc.nodes.some((m) => m.id === id)).indexOf(n.id);
      copySelection();
      pasteClipboard(0);
      sel = st().selection;
      lead = sel[index] ?? sel[0];
    }
    const now = st().doc;
    const ids = new Set(sel);
    const orig = new Map<string, Pt>();
    for (const m of now.nodes) {
      if (!ids.has(m.id)) continue;
      orig.set(m.id, { x: m.x, y: m.y });
      // A frame carries along whatever sits inside it.
      if (m.type === 'frame') {
        for (const c of now.nodes) {
          if (c.id !== m.id && contains(m, center(nodeRect(c)))) orig.set(c.id, { x: c.x, y: c.y });
        }
      }
    }
    if (orig.has(lead)) begin(e, { kind: 'move', start: world(e), orig, lead, moved: false });
  };

  const onEdgeDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0 || tool !== 'select' || space) return;
    e.stopPropagation();
    const s = st();
    if (doubleClick(id)) {
      s.select([id]);
      s.setEditing(id);
      return;
    }
    s.select(e.shiftKey ? [...s.selection.filter((x) => x !== id), id] : [id]);
  };

  const onDoubleClick = (e: RMouseEvent) => {
    const s = st();
    if (s.editing || tool !== 'select') return;
    const p = world(e);
    const n = nodeAt(s.doc, p);
    const tol = 8 / s.view.k;
    const edge = s.doc.edges.find((x) => {
      const pts = routeEdges(s.doc).get(x.id) ?? [];
      return pts.some((a, i) => i > 0 && distToSegment(p, pts[i - 1], a) < tol);
    });
    const id = n && n.type !== 'sequence' && n.type !== 'frame' ? n.id : (edge?.id ?? (n?.type === 'frame' && p.y < n.y + 32 ? n.id : null));
    if (!id) return;
    s.select([id]);
    s.setEditing(id);
  };

  const onHandleDown = (e: RPointerEvent, from: EdgeEnd, at: Pt, side?: Dir) => {
    if (e.button !== 0 || space) return;
    e.stopPropagation();
    begin(e, { kind: 'connect', from, at, side, sx: e.clientX, sy: e.clientY });
  };

  const onResizeDown = (e: RPointerEvent, n: Node, corner: Corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    begin(e, { kind: 'resize', id: n.id, corner, start: world(e), orig: { x: n.x, y: n.y, w: n.w, h: n.h }, moved: false });
  };

  /** Snap the dragged node's edges / centre to those of its neighbours; falls back to the grid. */
  const smartSnap = (d: Extract<Drag, { kind: 'move' }>, dx: number, dy: number, free: boolean) => {
    const s = st();
    const lead = s.doc.nodes.find((n) => n.id === d.lead)!;
    const o = d.orig.get(d.lead)!;
    const { w, h } = nodeRect(lead);
    const tol = 6 / s.view.k;
    const others = s.doc.nodes.filter((n) => !d.orig.has(n.id) && n.type !== 'frame').map(nodeRect);
    const axis = (pos: number, size: number, targets: (r: Rect) => number[]): { delta: number; guide?: number } => {
      let best: { delta: number; guide?: number } | null = null;
      for (const r of others) {
        for (const target of targets(r)) {
          for (const offset of [0, size / 2, size]) {
            const diff = target - (pos + offset);
            if (Math.abs(diff) < tol && (!best || Math.abs(diff) < Math.abs(best.delta))) best = { delta: diff, guide: target };
          }
        }
      }
      return best ?? { delta: free ? 0 : snap(pos) - pos };
    };
    const ax = axis(o.x + dx, w, (r) => [r.x, r.x + r.w / 2, r.x + r.w]);
    const ay = axis(o.y + dy, h, (r) => [r.y, r.y + r.h / 2, r.y + r.h]);
    setGuides({ x: ax.guide, y: ay.guide });
    return { sx: dx + ax.delta, sy: dy + ay.delta };
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const s = st();
    if (d.kind === 'pan') {
      s.setView({ ...s.view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
      return;
    }
    const p = world(e);
    if (d.kind === 'marquee') {
      const rect = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
      setGhost({ kind: 'marquee', rect });
      const hit = s.doc.nodes.filter((n) => {
        const r = nodeRect(n);
        // Frames need to be fully enclosed, otherwise every marquee inside one would grab it.
        return n.type === 'frame' ? contains(rect, r) && contains(rect, { x: r.x + r.w, y: r.y + r.h }) : intersects(rect, r);
      });
      s.select([...new Set([...d.base, ...hit.map((n) => n.id)])]);
      return;
    }
    if (d.kind === 'connect') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) setGhost({ kind: 'connect', a: d.at, b: p });
      return;
    }
    let dx = p.x - d.start.x;
    let dy = p.y - d.start.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) * s.view.k < 3) return;
      d.moved = true;
      s.checkpoint();
    }
    const grid = (v: number): number => (e.altKey ? Math.round(v) : snap(v));
    if (d.kind === 'move') {
      // Shift constrains the drag to one axis.
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const { sx, sy } = smartSnap(d, dx, dy, e.metaKey || e.ctrlKey);
      s.mutate(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) => {
            const o = d.orig.get(n.id);
            return o ? { ...n, x: Math.round(o.x + sx), y: Math.round(o.y + sy) } : n;
          }),
        }),
        false,
      );
      return;
    }
    const o = d.orig;
    let { x, y, w, h } = o;
    if (d.corner.includes('e')) w = Math.max(MIN.w, grid(o.x + o.w + dx) - o.x);
    if (d.corner.includes('w')) {
      x = Math.min(grid(o.x + dx), o.x + o.w - MIN.w);
      w = o.x + o.w - x;
    }
    if (d.corner === 'se' || d.corner === 'sw') h = Math.max(MIN.h, grid(o.y + o.h + dy) - o.y);
    if (d.corner === 'ne' || d.corner === 'nw') {
      y = Math.min(grid(o.y + dy), o.y + o.h - MIN.h);
      h = o.y + o.h - y;
    }
    s.updateNode(d.id, { x, y, w, h }, false);
  };

  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    setGuides({});
    setBusy(false);
    if (d?.kind !== 'connect') return;
    const s = st();
    // A plain click on a side dot adds the next shape in that direction.
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= 4) {
      if (d.side) spawnFrom(d.from.node, d.side);
      return;
    }
    const p = world(e);
    const taken = allIds(s.doc);
    const source = s.doc.nodes.find((n) => n.id === d.from.node)!;
    const over = nodeAt(s.doc, p);
    let to: EdgeEnd | null = portAt(s.doc, p) ?? (over && over.type !== 'frame' ? { node: over.id } : null);
    if (to && to.node === d.from.node) to = null;
    if (to) {
      let from = d.from;
      // Cables run output → input regardless of which end the drag started from.
      if (portOf(s.doc, from)?.side === 'left' && portOf(s.doc, to)?.side !== 'left') [from, to] = [to, from];
      const signal = portOf(s.doc, from)?.signal ?? portOf(s.doc, to)?.signal ?? 'flow';
      const edge = makeEdge(taken, from, to, signal);
      s.mutate((doc) => ({ ...doc, edges: [...doc.edges, edge] }));
      s.select([edge.id]);
    } else if (canConnect(source) && Math.hypot(p.x - d.at.x, p.y - d.at.y) > 30) {
      // Dropping on empty canvas puts the next shape right there.
      const kind: CreateKind = source.type === 'shape' ? source.shape : source.type;
      const n = makeNode(kind, snap(p.x), snap(p.y), taken, '', source.type === 'text' ? undefined : source.color);
      const edge = makeEdge(taken, d.from, { node: n.id }, 'flow');
      s.mutate((doc) => ({ ...doc, nodes: [...doc.nodes, n], edges: [...doc.edges, edge] }));
      s.select([n.id]);
      s.setEditing(n.id);
    }
  };

  const sel = new Set(selection);
  const routes = routeEdges(doc);
  const frames = doc.nodes.filter((n) => n.type === 'frame');
  const others = doc.nodes.filter((n) => n.type !== 'frame');
  const single = selection.length === 1 ? doc.nodes.find((n) => n.id === selection[0]) : undefined;
  const handleNode = doc.nodes.find((n) => n.id === hover && canConnect(n)) ?? (single && canConnect(single) ? single : undefined);
  const hs = 8 / view.k;
  const idle = tool === 'select' && !editing && !busy;
  const cursor = space || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const preview = idle && handleNode && hoverSide ? spawnRect(doc, handleNode, hoverSide) : null;

  const nodeGroup = (n: Node) => (
    <g
      key={n.id}
      onPointerDown={(e) => onNodeDown(e, n)}
      onPointerEnter={() => setHover(n.id)}
      onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
      style={{ cursor: tool === 'select' && !space ? 'move' : undefined }}
    >
      <NodeView n={editing === n.id && canConnect(n) ? { ...n, text: '' } : n} theme={SCREEN} />
    </g>
  );
  const devicePorts = (render: (key: string, p: Pt, end: EdgeEnd) => ReactNode) =>
    others.flatMap((n) => (n.type === 'device' ? n.ports.map((port) => render(`${n.id}/${port.id}`, portPos(n, port.id)!, { node: n.id, port: port.id })) : []));

  return (
    <div id="canvas" className="canvas">
      <svg ref={svgRef} width="100%" height="100%" style={{ cursor }} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDoubleClick}>
        <defs>
          <pattern id="dots" width={20 * view.k} height={20 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="#f4f6f9" />
        {view.k > 0.4 && <rect width="100%" height="100%" fill="url(#dots)" />}
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {frames.map(nodeGroup)}
          {doc.edges.map((e) => {
            const pts = routes.get(e.id);
            if (!pts) return null;
            const d = pathD(pts, 8);
            return (
              <g key={e.id} onPointerDown={(ev) => onEdgeDown(ev, e.id)} style={{ cursor: 'pointer' }}>
                {sel.has(e.id) && <path d={d} fill="none" stroke={ACCENT} strokeOpacity={0.28} strokeWidth={9} strokeLinecap="round" />}
                <EdgeView doc={doc} e={e} theme={SCREEN} hideLabel={editing === e.id} />
                <path d={d} fill="none" stroke="transparent" strokeWidth={14 / view.k} />
              </g>
            );
          })}
          {others.map(nodeGroup)}

          {preview && handleNode && hoverSide && (
            <g pointerEvents="none" opacity={0.55}>
              <line {...previewLine(sidePoint(nodeRect(handleNode), hoverSide), preview)} stroke="#76869a" strokeWidth={2.4} strokeLinecap="round" />
              <rect x={preview.x} y={preview.y} width={preview.w} height={preview.h} rx={4} fill="#fff" stroke="#b4bfcc" strokeWidth={2} />
            </g>
          )}

          {doc.nodes
            .filter((n) => sel.has(n.id))
            .map((n) => {
              const r = nodeRect(n);
              return <rect key={n.id} x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill="none" stroke={ACCENT} strokeWidth={1.5 / view.k} pointerEvents="none" />;
            })}

          {single &&
            canResize(single) &&
            idle &&
            (() => {
              const r = nodeRect(single);
              const corners: [Corner, number, number, string][] =
                single.type === 'device'
                  ? [['e', r.x + r.w, r.y + r.h / 2, 'ew-resize']]
                  : [
                      ['nw', r.x, r.y, 'nwse-resize'],
                      ['ne', r.x + r.w, r.y, 'nesw-resize'],
                      ['sw', r.x, r.y + r.h, 'nesw-resize'],
                      ['se', r.x + r.w, r.y + r.h, 'nwse-resize'],
                    ];
              return corners.map(([c, x, y, cur]) => (
                <rect key={c} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} rx={1.5 / view.k} fill="#fff" stroke={ACCENT} strokeWidth={1.5 / view.k} style={{ cursor: cur }} onPointerDown={(e) => onResizeDown(e, single, c)} />
              ));
            })()}

          {handleNode &&
            idle &&
            SIDES.map((side) => {
              const p = sidePoint(nodeRect(handleNode), side);
              const on = hoverSide === side;
              return (
                <g
                  key={side}
                  onPointerEnter={() => {
                    setHover(handleNode.id);
                    setHoverSide(side);
                  }}
                  onPointerLeave={() => setHoverSide((v) => (v === side ? null : v))}
                  onPointerDown={(e) => onHandleDown(e, { node: handleNode.id }, p, side)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={p.x} cy={p.y} r={12 / view.k} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={(on ? 9 : 4.5) / view.k} fill={ACCENT} />
                  {on && <path d={arrowGlyph(p, side, 4.5 / view.k)} fill="none" stroke="#fff" strokeWidth={1.6 / view.k} strokeLinecap="round" strokeLinejoin="round" />}
                </g>
              );
            })}

          {idle && devicePorts((key, p, end) => <circle key={key} className="port-hit" cx={p.x} cy={p.y} r={9} onPointerDown={(e) => onHandleDown(e, end, p)} />)}
          {/* While a cable is being dragged, the port under the cursor lights up as the drop target. */}
          {ghost?.kind === 'connect' &&
            devicePorts((key, p) =>
              Math.hypot(p.x - ghost.b.x, p.y - ghost.b.y) <= 10 ? <circle key={key} cx={p.x} cy={p.y} r={9} fill="rgba(37,99,235,0.2)" stroke={ACCENT} strokeWidth={2} pointerEvents="none" /> : null,
            )}

          {guides.x != null && <line x1={guides.x} y1={-1e5} x2={guides.x} y2={1e5} stroke="#f43f5e" strokeWidth={1 / view.k} pointerEvents="none" />}
          {guides.y != null && <line x1={-1e5} y1={guides.y} x2={1e5} y2={guides.y} stroke="#f43f5e" strokeWidth={1 / view.k} pointerEvents="none" />}
          {ghost?.kind === 'connect' && <line x1={ghost.a.x} y1={ghost.a.y} x2={ghost.b.x} y2={ghost.b.y} stroke={ACCENT} strokeWidth={2 / view.k} strokeDasharray={`${6 / view.k} ${4 / view.k}`} pointerEvents="none" />}
          {ghost?.kind === 'marquee' && <rect x={ghost.rect.x} y={ghost.rect.y} width={ghost.rect.w} height={ghost.rect.h} fill="rgba(37,99,235,0.08)" stroke={ACCENT} strokeWidth={1 / view.k} pointerEvents="none" />}
        </g>
      </svg>
      {editing && <TextEditor key={editing} id={editing} />}
      {idle && selection.length > 0 && <QuickBar />}
      <div className="zoom">
        <button onClick={() => zoomBy(1 / 1.25)} title="縮小">−</button>
        <button onClick={() => st().setView({ ...view, k: 1 })} title="100%">{Math.round(view.k * 100)}%</button>
        <button onClick={() => zoomBy(1.25)} title="拡大">＋</button>
        <button onClick={() => st().fit()} title="全体表示 (⇧1)">全体</button>
      </div>
    </div>
  );
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** Connector preview from a side dot to the nearest edge of the previewed shape. */
function previewLine(from: Pt, to: Rect): { x1: number; y1: number; x2: number; y2: number } {
  const c = center(to);
  const horizontal = Math.abs(c.x - from.x) > Math.abs(c.y - from.y);
  return {
    x1: from.x,
    y1: from.y,
    x2: horizontal ? (c.x > from.x ? to.x : to.x + to.w) : c.x,
    y2: horizontal ? c.y : c.y > from.y ? to.y : to.y + to.h,
  };
}

function arrowGlyph(p: Pt, side: Dir, s: number): string {
  const [ux, uy] = side === 'right' ? [1, 0] : side === 'left' ? [-1, 0] : side === 'bottom' ? [0, 1] : [0, -1];
  const tip = { x: p.x + ux * s, y: p.y + uy * s };
  const wing = (k: number): string => `${p.x + ux * s * 0.1 - uy * s * 0.8 * k},${p.y + uy * s * 0.1 + ux * s * 0.8 * k}`;
  return `M${p.x - ux * s},${p.y - uy * s} L${tip.x},${tip.y} M${wing(1)} L${tip.x},${tip.y} L${wing(-1)}`;
}

const SHAPE_ICON: Record<ShapeKind, string> = { rect: '▭', round: '⬭', diamond: '◇', ellipse: '◯' };

/** Floating toolbar above the selection: the edits you reach for right after placing something. */
function QuickBar() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const view = useStore((s) => s.view);
  const ids = new Set(selection);
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  const edge = nodes.length ? undefined : doc.edges.find((e) => ids.has(e.id));
  const box = nodes.length ? docBounds(doc, new Set(nodes.map((n) => n.id))) : null;
  let anchor: { x: number; top: number; bottom: number } | null = null;
  if (box) anchor = { x: box.x + box.w / 2, top: box.y, bottom: box.y + box.h };
  else if (edge) {
    const p = labelPoint(routeEdges(doc).get(edge.id) ?? [{ x: 0, y: 0 }]);
    anchor = { x: p.x, top: p.y - 14, bottom: p.y + 14 };
  }
  if (!anchor) return null;
  const one = nodes.length === 1 ? nodes[0] : undefined;
  const top = view.y + anchor.top * view.k - 50;
  const patch = (p: Partial<Node>) => one && st().updateNode(one.id, p);
  const editId = one && one.type !== 'sequence' ? one.id : edge?.id;
  return (
    <div className="quickbar" style={{ left: view.x + anchor.x * view.k, top: top < 6 ? view.y + anchor.bottom * view.k + 12 : top }} onPointerDown={(e) => e.stopPropagation()}>
      {one?.type === 'shape' &&
        (Object.keys(SHAPE_ICON) as ShapeKind[]).map((k) => (
          <button key={k} className={one.shape === k ? 'on' : ''} onClick={() => patch({ shape: k })} title="形を変える">
            {SHAPE_ICON[k]}
          </button>
        ))}
      {one?.type === 'shape' && <i />}
      {(one?.type === 'shape' || one?.type === 'sticky') &&
        COLOR_KEYS.map((c) => (
          <button key={c} className={`dot ${one.color === c ? 'on' : ''}`} onClick={() => patch({ color: c })} title="色">
            <span style={{ background: PALETTE[c].fill, borderColor: PALETTE[c].stroke }} />
          </button>
        ))}
      {(one?.type === 'shape' || one?.type === 'sticky') && <i />}
      {editId && (
        <button onClick={() => st().setEditing(editId)} title="文字を編集 (Enter)">
          Ｔ
        </button>
      )}
      {nodes.length > 0 && (
        <button
          onClick={() => {
            copySelection();
            pasteClipboard();
          }}
          title="複製 (⌘D)"
        >
          ⧉
        </button>
      )}
      <button onClick={() => st().removeIds(selection)} title="削除 (Delete)">
        ✕
      </button>
    </div>
  );
}

function TextEditor({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const doc = useStore((s) => s.doc);
  const view = useStore((s) => s.view);
  const node = doc.nodes.find((n) => n.id === id);
  const edge = doc.edges.find((e) => e.id === id);
  const done = useRef(false);
  const grew = useRef(false);

  // Layout effect: focus must land synchronously so a keystroke that opened the
  // editor (including the first IME key) is typed into it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerText = node ? node.text : (edge?.label ?? '');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!node && !edge) return null;
  const k = view.k;
  const oneLine = !node || node.type === 'device' || node.type === 'frame';
  const read = (): string => {
    const text = (ref.current?.innerText ?? '').replace(/\n+$/, '');
    return oneLine ? text.replace(/\n/g, ' ') : text;
  };
  // The box follows the text while typing, so a long label never spills out of its shape.
  const grow = () => {
    if (!node) return;
    const h = neededHeight(node, read());
    if (h == null) return;
    if (!grew.current) {
      grew.current = true;
      st().checkpoint();
    }
    st().updateNode(id, { h }, false);
  };
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const s = st();
    const text = read();
    if (edge) {
      if (text !== edge.label) s.updateEdge(id, { label: text });
    } else if (node && text !== node.text) {
      const h = neededHeight(node, text);
      // The growth steps already opened an undo entry; fold the text change into it.
      s.updateNode(id, h == null ? { text } : { text, h }, !grew.current);
    }
    s.setEditing(null);
  };

  const outline = { boxShadow: `0 0 0 1.5px ${ACCENT}`, borderRadius: 4 };
  let style: CSSProperties;
  if (!node) {
    const at = labelPoint(routeEdges(doc).get(id) ?? [{ x: 0, y: 0 }]);
    style = { left: view.x + at.x * k, top: view.y + at.y * k, transform: 'translate(-50%, -50%)', minWidth: 48 * k, fontSize: 12 * k, background: '#fff', padding: `${2 * k}px ${6 * k}px`, ...outline };
  } else if (node.type === 'device') {
    style = { left: view.x + node.x * k, top: view.y + node.y * k, width: node.w * k, height: DEV.head * k, fontSize: 13 * k, fontWeight: 700, background: '#e8edf3', borderRadius: 6 * k };
  } else if (node.type === 'frame') {
    style = { left: view.x + (node.x + 8) * k, top: view.y + (node.y + 5) * k, minWidth: 80 * k, height: 26 * k, fontSize: 13 * k, fontWeight: 700, textAlign: 'left', background: '#fff', padding: `0 ${4 * k}px`, ...outline };
  } else {
    // Same width, size and line height as the SVG text, so nothing jumps on commit.
    const tw = textWidth(node);
    style = { left: view.x + (node.x + (node.w - tw) / 2) * k, top: view.y + node.y * k, width: tw * k, height: node.h * k, fontSize: textSize(node) * k };
  }
  return (
    <div
      ref={ref}
      className="text-editor"
      contentEditable
      suppressContentEditableWarning
      data-placeholder={edge ? 'ラベル' : 'テキストを入力'}
      style={{ color: INK, lineHeight: TEXT.lineHeight, ...style }}
      onInput={grow}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        // While the IME is composing, Enter / Escape belong to the conversion, not to us.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape' || (e.key === 'Enter' && (oneLine || e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
