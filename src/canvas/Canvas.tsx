import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import {
  DEV,
  type Dir,
  center,
  contains,
  intersects,
  nodeAt,
  nodeRect,
  pathD,
  portAt,
  portPos,
  routeEdges,
  sidePoint,
  snap,
} from '../model/geometry';
import { allIds, makeEdge, makeNode } from '../model/presets';
import { SEQUENCE_SAMPLE } from '../model/sequence';
import { PALETTE } from '../model/signals';
import { wrapText } from '../model/text';
import { type Tool, useStore } from '../model/store';
import type { Doc, EdgeEnd, Node, Pt, Rect } from '../model/types';
import { EdgeView, NodeView, SCREEN } from './render';

type Corner = 'nw' | 'ne' | 'sw' | 'se' | 'e';
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Pt; orig: Map<string, Pt>; lead: string; moved: boolean }
  | { kind: 'marquee'; start: Pt; base: string[] }
  | { kind: 'resize'; id: string; corner: Corner; start: Pt; orig: Rect; moved: boolean }
  | { kind: 'connect'; from: EdgeEnd; at: Pt };
type Ghost = null | { kind: 'marquee'; rect: Rect } | { kind: 'connect'; a: Pt; b: Pt };

const SIDES: Dir[] = ['left', 'right', 'top', 'bottom'];
const MIN = { w: 40, h: 30 };
const ACCENT = '#2563eb';
const canConnect = (n: Node): boolean => n.type === 'shape' || n.type === 'sticky' || n.type === 'text';
const canResize = (n: Node): boolean => n.type !== 'sequence';

const portSignal = (doc: Doc, end: EdgeEnd): string | undefined => {
  const n = doc.nodes.find((x) => x.id === end.node);
  return n?.type === 'device' ? n.ports.find((p) => p.id === end.port)?.signal : undefined;
};
const portSide = (doc: Doc, end: EdgeEnd): string | undefined => {
  const n = doc.nodes.find((x) => x.id === end.node);
  return n?.type === 'device' ? n.ports.find((p) => p.id === end.port)?.side : undefined;
};

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const doc = useStore((s) => s.doc);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const editing = useStore((s) => s.editing);
  const [hover, setHover] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost>(null);
  const [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null);
  const lastClick = useRef({ id: '', t: 0 });
  const st = useStore.getState;

  const world = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = st().view;
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  };
  const capture = (e: RPointerEvent) => {
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone (or synthetic) — the drag still works while over the canvas.
    }
  };

  useLayoutEffect(() => st().fit(), [st]);

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
  }, [st]);

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

  const startPan = (e: RPointerEvent) => {
    const v = st().view;
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
    capture(e);
  };

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button === 1 || tool === 'pan' || space) return startPan(e);
    if (e.button !== 0) return;
    const p = world(e);
    if (tool === 'select') {
      const base = e.shiftKey ? st().selection : [];
      st().select(base);
      drag.current = { kind: 'marquee', start: p, base };
      capture(e);
      return;
    }
    create(tool, p);
  };

  const create = (kind: Exclude<Tool, 'select' | 'pan'>, p: Pt) => {
    const s = st();
    const taken = allIds(s.doc);
    const n = makeNode(kind, snap(p.x), snap(p.y), taken, kind === 'sequence' ? SEQUENCE_SAMPLE : '');
    n.x = snap(n.x);
    n.y = snap(n.y);
    // Frames go to the back so they never cover what they contain.
    s.mutate((d) => ({ ...d, nodes: kind === 'frame' ? [n, ...d.nodes] : [...d.nodes, n] }));
    s.select([n.id]);
    s.setTool('select');
    if (kind !== 'sequence') s.setEditing(n.id);
  };

  const onNodeDown = (e: RPointerEvent, n: Node) => {
    if (e.button !== 0 || tool !== 'select' || space) return;
    e.stopPropagation();
    capture(e);
    const s = st();
    const now = performance.now();
    if (lastClick.current.id === n.id && now - lastClick.current.t < 350 && n.type !== 'sequence') {
      s.select([n.id]);
      s.setEditing(n.id);
      return;
    }
    lastClick.current = { id: n.id, t: now };
    let sel = s.selection;
    if (e.shiftKey) sel = sel.includes(n.id) ? sel.filter((id) => id !== n.id) : [...sel, n.id];
    else if (!sel.includes(n.id)) sel = [n.id];
    s.select(sel);
    const ids = new Set(sel);
    const orig = new Map<string, Pt>();
    for (const m of s.doc.nodes) {
      if (!ids.has(m.id)) continue;
      orig.set(m.id, { x: m.x, y: m.y });
      // A frame carries along whatever sits inside it.
      if (m.type === 'frame') {
        for (const c of s.doc.nodes) {
          if (c.id !== m.id && contains(m, center(nodeRect(c)))) orig.set(c.id, { x: c.x, y: c.y });
        }
      }
    }
    if (orig.has(n.id)) drag.current = { kind: 'move', start: world(e), orig, lead: n.id, moved: false };
  };

  const onEdgeDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0 || tool !== 'select' || space) return;
    e.stopPropagation();
    const s = st();
    s.select(e.shiftKey ? [...s.selection.filter((x) => x !== id), id] : [id]);
  };

  const onHandleDown = (e: RPointerEvent, from: EdgeEnd, at: Pt) => {
    if (e.button !== 0 || space) return;
    e.stopPropagation();
    capture(e);
    drag.current = { kind: 'connect', from, at };
    setGhost({ kind: 'connect', a: at, b: at });
  };

  const onResizeDown = (e: RPointerEvent, n: Node, corner: Corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    capture(e);
    drag.current = { kind: 'resize', id: n.id, corner, start: world(e), orig: { x: n.x, y: n.y, w: n.w, h: n.h }, moved: false };
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
      setGhost({ kind: 'connect', a: d.at, b: p });
      return;
    }
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) * s.view.k < 3) return;
      d.moved = true;
      s.checkpoint();
    }
    const grid = (v: number): number => (e.altKey ? Math.round(v) : snap(v));
    if (d.kind === 'move') {
      const lead = d.orig.get(d.lead)!;
      const sx = grid(lead.x + dx) - lead.x;
      const sy = grid(lead.y + dy) - lead.y;
      s.mutate(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) => {
            const o = d.orig.get(n.id);
            return o ? { ...n, x: o.x + sx, y: o.y + sy } : n;
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
    if (d?.kind !== 'connect') return;
    const s = st();
    const p = world(e);
    const taken = allIds(s.doc);
    const source = s.doc.nodes.find((n) => n.id === d.from.node)!;
    const over = nodeAt(s.doc, p);
    let to: EdgeEnd | null = portAt(s.doc, p) ?? (over && over.type !== 'frame' ? { node: over.id } : null);
    if (to && to.node === d.from.node) to = null;
    if (to) {
      let from = d.from;
      // Cables run output → input regardless of which end the drag started from.
      if (portSide(s.doc, from) === 'left' && portSide(s.doc, to) !== 'left') [from, to] = [to, from];
      const signal = portSignal(s.doc, from) ?? portSignal(s.doc, to) ?? 'flow';
      const edge = makeEdge(taken, from, to, signal);
      s.mutate((doc) => ({ ...doc, edges: [...doc.edges, edge] }));
      s.select([edge.id]);
    } else if (source.type === 'shape' && Math.hypot(p.x - d.at.x, p.y - d.at.y) > 30) {
      // Dropping on empty canvas spawns the next step of the flow.
      const n = makeNode(source.shape, snap(p.x), snap(p.y), taken, '', source.color);
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
  const cursor = space || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

  const nodeGroup = (n: Node) => (
    <g
      key={n.id}
      onPointerDown={(e) => onNodeDown(e, n)}
      onPointerEnter={() => setHover(n.id)}
      onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
      style={{ cursor: tool === 'select' && !space ? 'move' : undefined }}
    >
      <NodeView n={editing === n.id && n.type !== 'device' && n.type !== 'frame' ? { ...n, text: '' } : n} theme={SCREEN} />
    </g>
  );

  return (
    <div id="canvas" className="canvas">
      <svg ref={svgRef} width="100%" height="100%" style={{ cursor }} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <defs>
          <pattern id="dots" width={20 * view.k} height={20 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="#f8fafc" />
        {view.k > 0.4 && <rect width="100%" height="100%" fill="url(#dots)" />}
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {frames.map(nodeGroup)}
          {doc.edges.map((e) => {
            const pts = routes.get(e.id);
            if (!pts) return null;
            const d = pathD(pts, 7);
            return (
              <g key={e.id} onPointerDown={(ev) => onEdgeDown(ev, e.id)} style={{ cursor: 'pointer' }}>
                {sel.has(e.id) && <path d={d} fill="none" stroke={ACCENT} strokeOpacity={0.28} strokeWidth={8} strokeLinecap="round" />}
                <EdgeView doc={doc} e={e} theme={SCREEN} />
                <path d={d} fill="none" stroke="transparent" strokeWidth={14 / view.k} />
              </g>
            );
          })}
          {others.map(nodeGroup)}

          {doc.nodes
            .filter((n) => sel.has(n.id))
            .map((n) => {
              const r = nodeRect(n);
              return <rect key={n.id} x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} rx={5} fill="none" stroke={ACCENT} strokeWidth={1.5 / view.k} pointerEvents="none" />;
            })}

          {single &&
            canResize(single) &&
            tool === 'select' &&
            (() => {
              const r = nodeRect(single);
              const corners: [Corner, number, number, string][] =
                single.type === 'device'
                  ? [['e', r.x + r.w + 3, r.y + r.h / 2, 'ew-resize']]
                  : [
                      ['nw', r.x - 3, r.y - 3, 'nwse-resize'],
                      ['ne', r.x + r.w + 3, r.y - 3, 'nesw-resize'],
                      ['sw', r.x - 3, r.y + r.h + 3, 'nesw-resize'],
                      ['se', r.x + r.w + 3, r.y + r.h + 3, 'nwse-resize'],
                    ];
              return corners.map(([c, x, y, cur]) => (
                <rect key={c} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} fill="#fff" stroke={ACCENT} strokeWidth={1.5 / view.k} style={{ cursor: cur }} onPointerDown={(e) => onResizeDown(e, single, c)} />
              ));
            })()}

          {handleNode &&
            tool === 'select' &&
            !editing &&
            SIDES.map((side) => {
              const p = sidePoint(nodeRect(handleNode), side);
              return (
                <circle
                  key={side}
                  className="handle"
                  cx={p.x}
                  cy={p.y}
                  r={6 / view.k}
                  strokeWidth={1.5 / view.k}
                  onPointerEnter={() => setHover(handleNode.id)}
                  onPointerDown={(e) => onHandleDown(e, { node: handleNode.id }, p)}
                />
              );
            })}

          {tool === 'select' &&
            others.map((n) =>
              n.type !== 'device'
                ? null
                : n.ports.map((port) => {
                    const p = portPos(n, port.id)!;
                    return <circle key={`${n.id}/${port.id}`} className="port-hit" cx={p.x} cy={p.y} r={9} onPointerDown={(e) => onHandleDown(e, { node: n.id, port: port.id }, p)} />;
                  }),
            )}

          {ghost?.kind === 'connect' && <line x1={ghost.a.x} y1={ghost.a.y} x2={ghost.b.x} y2={ghost.b.y} stroke={ACCENT} strokeWidth={2 / view.k} strokeDasharray={`${6 / view.k} ${4 / view.k}`} pointerEvents="none" />}
          {ghost?.kind === 'marquee' && <rect {...{ x: ghost.rect.x, y: ghost.rect.y, width: ghost.rect.w, height: ghost.rect.h }} fill="rgba(37,99,235,0.08)" stroke={ACCENT} strokeWidth={1 / view.k} pointerEvents="none" />}
        </g>
      </svg>
      {editing && <TextEditor key={editing} id={editing} />}
      <div className="zoom">
        <button onClick={() => zoomBy(1 / 1.25)} title="縮小">−</button>
        <button onClick={() => st().setView({ ...view, k: 1 })} title="100%">{Math.round(view.k * 100)}%</button>
        <button onClick={() => zoomBy(1.25)} title="拡大">＋</button>
        <button onClick={() => st().fit()} title="全体表示 (⇧1)">全体</button>
      </div>
    </div>
  );
}

export function zoomBy(f: number): void {
  const s = useStore.getState();
  const el = document.getElementById('canvas');
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const v = s.view;
  const k = Math.min(4, Math.max(0.1, v.k * f));
  s.setView({ k, x: width / 2 - ((width / 2 - v.x) * k) / v.k, y: height / 2 - ((height / 2 - v.y) * k) / v.k });
}

/** World point at the centre of the visible canvas. */
export function viewCenter(): Pt {
  const v = useStore.getState().view;
  const el = document.getElementById('canvas');
  const { width, height } = el ? el.getBoundingClientRect() : { width: 800, height: 600 };
  return { x: (width / 2 - v.x) / v.k, y: (height / 2 - v.y) / v.k };
}

function TextEditor({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const node = useStore((s) => s.doc.nodes.find((n) => n.id === id));
  const view = useStore((s) => s.view);
  const done = useRef(false);

  // Layout effect: focus must land synchronously so a keystroke that opened the
  // editor (including the first IME key) is typed into it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !node) return;
    el.innerText = node.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!node) return null;
  const oneLine = node.type === 'device' || node.type === 'frame';
  const r =
    node.type === 'device'
      ? { x: node.x, y: node.y, w: node.w, h: DEV.head }
      : node.type === 'frame'
        ? { x: node.x + 6, y: node.y + 4, w: Math.min(node.w - 12, 260), h: 28 }
        : nodeRect(node);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const s = useStore.getState();
    const text = (ref.current?.innerText ?? '').replace(/\n+$/, '');
    if (text !== node.text) {
      const patch: Partial<Node> = { text: oneLine ? text.replace(/\n/g, ' ') : text };
      // Grow the box when the text no longer fits (never shrink what the user sized).
      if (node.type === 'shape' || node.type === 'sticky' || node.type === 'text') {
        const size = node.type === 'shape' ? 13.5 : node.type === 'sticky' ? 13 : 14;
        const shape = node.type === 'shape' ? node.shape : '';
        const tw = shape === 'diamond' ? node.w * 0.6 : shape === 'ellipse' ? node.w * 0.72 : node.type === 'text' ? node.w : node.w - (node.type === 'sticky' ? 20 : 16);
        const lines = wrapText(text, tw, `400 ${size}px ${SCREEN.font}`).length;
        const need = (lines * size * 1.35 + 16) * (shape === 'diamond' ? 1.7 : shape === 'ellipse' ? 1.3 : 1);
        if (need > node.h) patch.h = Math.ceil(need / 10) * 10;
      }
      s.updateNode(id, patch);
    }
    s.setEditing(null);
  };
  const bg = node.type === 'shape' || node.type === 'sticky' ? PALETTE[node.color].fill : node.type === 'device' ? '#e8edf3' : '#ffffff';
  return (
    <div
      ref={ref}
      className="text-editor"
      contentEditable
      suppressContentEditableWarning
      style={{
        left: view.x + r.x * view.k,
        top: view.y + r.y * view.k,
        width: r.w * view.k,
        minHeight: r.h * view.k,
        fontSize: 13.5 * view.k,
        fontWeight: oneLine ? 700 : 400,
        background: bg,
        textAlign: node.type === 'frame' ? 'left' : 'center',
      }}
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
