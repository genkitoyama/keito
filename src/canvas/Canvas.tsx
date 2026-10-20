import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as RMouseEvent, ReactNode, PointerEvent as RPointerEvent } from 'react';
import {
  edgeNear,
  hopOrder,
  DEVICE_NAME,
  deviceHead,
  type Dir,
  center,
  contains,
  intersects,
  isUnderlay,
  isTagged,
  labelPoint,
  nearestT,
  nodeAt,
  nodeRect,
  pathD,
  portAt,
  portPos,
  routeEdges,
  sideOf,
  sidePoint,
  simplify,
  snap,
} from '../model/geometry';
import { type CreateKind, allIds, claimPort, junctionSignal, makeEdge, makeImage, makeNode } from '../model/presets';
import { SEQUENCE_SAMPLE, seqLayout, seqScale } from '../model/sequence';
import { STRONG } from '../model/signals';
import { type Placing, copySelection, pasteClipboard, storeImage, useStore } from '../model/store';
import { type Doc, type Edge, type EdgeEnd, type Node, type Pt, type Rect, hasText } from '../model/types';
import { isImageFile, readImageFile } from '../platform/storage';
import { EdgeView, HopCaps, INK, NodeView, SCREEN, STICKY_HEAD, TEXT, edgeLabelBox, edgeTags, frameTitleHeight, textHeightFor, textSize, textWeight, textWidth } from './render';
import { QuickBar } from '../ui/QuickBar';

type Corner = 'nw' | 'ne' | 'sw' | 'se' | 'e';
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Pt; orig: Map<string, Pt>; routes: Map<string, Pt[]>; lead: string; moved: boolean }
  | { kind: 'segment'; id: string; seg: number; horizontal: boolean; start: Pt; route: Pt[]; moved: boolean }
  | { kind: 'reconnect'; id: string; end: 'from' | 'to'; other: Pt }
  | { kind: 'label'; id: string; start: Pt; moved: boolean }
  | { kind: 'marquee'; start: Pt; base: string[] }
  | { kind: 'resize'; id: string; corner: Corner; start: Pt; orig: Rect; moved: boolean; lock?: number }
  | { kind: 'connect'; from: EdgeEnd; at: Pt; side?: Dir; sx: number; sy: number }
  | { kind: 'place'; start: Pt };
type ConnectDrag = Extract<Drag, { kind: 'connect' }>;
type ReconnectDrag = Extract<Drag, { kind: 'reconnect' }>;
/** While a line is pulled: what letting go here would make (`plan`), else a plain rubber band. */
type Ghost = null | { kind: 'marquee'; rect: Rect } | { kind: 'size'; rect: Rect } | { kind: 'connect'; a: Pt; b: Pt; plan: Plan | null };

const SIDES: Dir[] = ['left', 'right', 'top', 'bottom'];
const MIN = { w: 40, h: 30 };
const ACCENT = '#2563eb';
const SPAWN_GAP = 70;
type Flowable = Extract<Node, { type: 'shape' | 'sticky' | 'text' }>;
const canConnect = (n: Node): n is Flowable => n.type === 'shape' || n.type === 'sticky' || n.type === 'text';
const canResize = (n: Node): boolean => n.type !== 'junction';
/** Nodes that offer side dots to pull a line from. */
const hasHandles = (n: Node): boolean => canConnect(n) || n.type === 'junction';
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

/** World point under a point of the window, if it is over the board. */
export function worldAt(clientX: number, clientY: number): Pt | null {
  const el = document.getElementById('canvas');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  const v = st().view;
  return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
}

/** The tools that put a box on the board. */
export const placesBox = (tool: string): tool is CreateKind => tool !== 'select' && tool !== 'pan';

/** The size a new box of a kind comes in (none for a sequence diagram, which sizes itself). */
export function boxSize(kind: CreateKind): { w: number; h: number } | null {
  if (kind === 'sequence') return null;
  const n = makeNode(kind, 0, 0, new Set());
  return { w: n.w, h: n.h };
}

/**
 * Pointer handling for a toolbar or library button whose thing goes onto the board: dragged
 * there, it is put where it is let go; clicked, it waits (outlined under the pointer) to be put
 * where the board is clicked next — `click` overrides that (a tool button arms its tool).
 */
export function placeDrag(make: () => Placing, click?: () => void) {
  return (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (dragging || Math.hypot(ev.clientX - sx, ev.clientY - sy) <= 5) return;
      dragging = true;
      st().setPlacing(make());
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) return click ? click() : st().setPlacing(make());
      const at = worldAt(ev.clientX, ev.clientY);
      const placing = st().placing;
      st().setPlacing(null);
      if (at && placing) placing.place(at);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

/**
 * Add a node centred on `at` (default: a free spot near the view centre) and start typing into
 * it; with `rect` it takes that place and size (drawn out with the tool).
 */
export function insertNode(kind: CreateKind, at?: Pt, rect?: Rect): void {
  const s = st();
  const p = at ?? viewCenter();
  const n = makeNode(kind, snap(p.x), snap(p.y), allIds(s.doc), kind === 'sequence' ? SEQUENCE_SAMPLE : '');
  n.x = snap(n.x);
  n.y = snap(n.y);
  if (rect && kind !== 'sequence') Object.assign(n, { x: snap(rect.x), y: snap(rect.y), w: Math.max(MIN.w, snap(rect.w)), h: Math.max(MIN.h, snap(rect.h)) });
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

/** Embed pictures (PNG / JPEG / GIF / WebP / SVG), side by side around `at` or the view centre. */
export async function insertImages(files: File[], at?: Pt): Promise<void> {
  const p = at ?? viewCenter();
  const ids: string[] = [];
  let x = p.x;
  for (const file of files.filter(isImageFile)) {
    try {
      const img = await readImageFile(file);
      // On disk the picture goes into the board's folder; the node only keeps a reference.
      img.src = await storeImage(img.src);
      const s = st();
      const n = makeImage(allIds(s.doc), img, x, p.y);
      x += n.w + 20;
      s.mutate((d) => ({ ...d, nodes: [...d.nodes, n] }));
      ids.push(n.id);
    } catch (e) {
      alert(`${file.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (ids.length) {
    st().select(ids);
    st().setTool('select');
  }
}

/** Where a shape spawned from `side` of `src` lands: same width, one gap away, clear of other nodes. */
function spawnRect(doc: Doc, src: Node, side: Dir): Rect {
  const r = nodeRect(src);
  const horizontal = side === 'left' || side === 'right';
  const h = src.type === 'shape' ? Math.min(src.h, src.shape === 'diamond' ? 90 : src.shape === 'cloud' ? 100 : 70) : src.type === 'sticky' ? Math.min(src.h, 160) : src.h;
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
  // The next step inherits the look of the one it grows from.
  const look = src.type === 'shape' ? { fill: src.fill, dash: src.dash } : {};
  const n = { ...makeNode(kind, 0, 0, taken, '', src.type === 'text' ? undefined : src.color), ...look, ...spawnRect(s.doc, src, side) };
  const edge = makeEdge(taken, { node: src.id }, { node: n.id }, 'flow');
  s.mutate((d) => ({ ...d, nodes: [...d.nodes, n], edges: [...d.edges, edge] }));
  s.select([n.id]);
  s.setEditing(n.id);
}

/** Height a node needs for its text, or null when the text fits. */
function neededHeight(n: Node, text: string): number | null {
  if (!canConnect(n)) return null;
  const need = textHeightFor(n, text);
  return need > n.h ? need : null;
}

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const doc = useStore((s) => s.doc);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const editing = useStore((s) => s.editing);
  const placing = useStore((s) => s.placing);
  /** Where the pointer is on the board, while something waits to be placed (its outline follows). */
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverSide, setHoverSide] = useState<Dir | null>(null);
  /** The box a line was just connected on: no dots on it until the pointer has left it. */
  const [hush, setHush] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [busy, setBusy] = useState(false);
  const [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null);
  /** The plan last shown, kept while the target stays the same so its routes are not worked out again. */
  const lastPlan = useRef<Plan | null>(null);
  const keepPlan = (plan: Plan | null): Plan | null => {
    const was = lastPlan.current;
    if (plan && was && plan.key === was.key) return was;
    return (lastPlan.current = plan);
  };
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
      // ⌘/Ctrl+Space switches the input source or opens Spotlight; the OS then
      // swallows the key-up, which would leave the canvas stuck in pan mode.
      if (e.code !== 'Space' || typing(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return setSpace(false);
      e.preventDefault();
      setSpace(true);
    };
    // Any key-up ends space-pan: the Space key-up itself can go missing when focus moves away.
    const up = () => setSpace(false);
    // Leaving the window mid-gesture must not leave a drag or pan half-finished.
    const reset = () => {
      drag.current = null;
      setSpace(false);
      setBusy(false);
      setGhost(null);
      setGuides({});
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // An edit target that no longer exists (deleted, undone, replaced by another tab) must not block the UI.
  useEffect(() => {
    if (editing && !doc.nodes.some((n) => n.id === editing) && !doc.edges.some((e) => e.id === editing)) st().setEditing(null);
  }, [editing, doc]);

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button === 1 || tool === 'pan' || space) {
      const v = st().view;
      return begin(e, { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y });
    }
    if (e.button !== 0) return;
    const p = world(e);
    if (st().placing) {
      const what = st().placing!;
      st().setPlacing(null);
      return what.place(p);
    }
    // A box tool: a click puts one there, a drag draws it out to the size wanted.
    if (placesBox(tool)) return begin(e, { kind: 'place', start: p });
    // Double-click on empty canvas drops a box and starts typing, like a whiteboard.
    if (doubleClick('canvas')) return insertNode('rect', p);
    const base = e.shiftKey ? st().selection : [];
    st().select(base);
    begin(e, { kind: 'marquee', start: p, base });
  };

  const onNodeDown = (e: RPointerEvent, n: Node) => {
    // While something waits to be placed, a click on a box goes through to the board (into an area, say).
    if (e.button !== 0 || tool !== 'select' || space || st().placing) return;
    e.stopPropagation();
    const s = st();
    if (doubleClick(n.id) && hasText(n)) {
      // Double-clicking the body of an area frame adds a box there; its title strip renames it.
      const p = world(e);
      if (n.type === 'frame' && p.y > n.y + frameTitleHeight(n)) return insertNode('rect', p);
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
          // ... but never the floor plan laid under the drawing.
          if (c.id !== m.id && !isUnderlay(c) && contains(m, center(nodeRect(c)))) orig.set(c.id, { x: c.x, y: c.y });
        }
      }
    }
    // Hand-placed bends travel with a cable when both of its ends are being moved.
    const routes = new Map<string, Pt[]>();
    for (const edge of now.edges) if (edge.route && orig.has(edge.from.node) && orig.has(edge.to.node)) routes.set(edge.id, edge.route);
    if (orig.has(lead)) begin(e, { kind: 'move', start: world(e), orig, routes, lead, moved: false });
  };

  const onEdgeDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0 || tool !== 'select' || space || st().placing) return;
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
    const id = n && hasText(n) && n.type !== 'frame' ? n.id : (edge?.id ?? (n?.type === 'frame' && p.y < n.y + frameTitleHeight(n) ? n.id : null));
    if (!id) return;
    s.select([id]);
    s.setEditing(id);
  };

  const onLabelDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0 || tool !== 'select' || space || st().placing) return;
    e.stopPropagation();
    const s = st();
    if (doubleClick(id)) {
      s.select([id]);
      s.setEditing(id);
      return;
    }
    s.select(e.shiftKey ? [...s.selection.filter((x) => x !== id), id] : [id]);
    begin(e, { kind: 'label', id, start: world(e), moved: false });
  };

  const onSegmentDown = (e: RPointerEvent, id: string, seg: number, horizontal: boolean, route: Pt[]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    begin(e, { kind: 'segment', id, seg, horizontal, start: world(e), route, moved: false });
  };

  const onEndDown = (e: RPointerEvent, id: string, end: 'from' | 'to', other: Pt) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    begin(e, { kind: 'reconnect', id, end, other });
  };

  const onHandleDown = (e: RPointerEvent, from: EdgeEnd, at: Pt, side?: Dir) => {
    if (e.button !== 0 || space) return;
    e.stopPropagation();
    begin(e, { kind: 'connect', from, at, side, sx: e.clientX, sy: e.clientY });
  };

  const onResizeDown = (e: RPointerEvent, n: Node, corner: Corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Pictures keep their proportions unless Shift is held.
    begin(e, { kind: 'resize', id: n.id, corner, start: world(e), orig: nodeRect(n), moved: false, lock: n.type === 'image' ? n.w / n.h : undefined });
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
      return best ?? { delta: (free ? Math.round(pos) : snap(pos)) - pos };
    };
    // A cable to a node that stays put: bring the two ports level, so the cable runs dead straight.
    // Ports sit at odd offsets inside a device, so neither the grid nor edge alignment gets them there.
    let level: { delta: number; guide: number } | null = null;
    const byId = new Map(s.doc.nodes.map((n) => [n.id, n]));
    const levelOf = (n: Node, end: EdgeEnd, at: Pt): number => {
      const port = n.type === 'device' && end.port ? portPos({ ...n, ...at }, end.port) : null;
      return port ? port.y : at.y + nodeRect(n).h / 2;
    };
    for (const edge of s.doc.edges) {
      const fromMoves = d.orig.has(edge.from.node);
      if (fromMoves === d.orig.has(edge.to.node) || (!edge.from.port && !edge.to.port)) continue;
      const [mine, theirs] = fromMoves ? [edge.from, edge.to] : [edge.to, edge.from];
      const moving = byId.get(mine.node);
      const fixed = byId.get(theirs.node);
      if (!moving || !fixed) continue;
      const target = levelOf(fixed, theirs, fixed);
      const diff = target - (levelOf(moving, mine, d.orig.get(moving.id)!) + dy);
      if (Math.abs(diff) < tol && (!level || Math.abs(diff) < Math.abs(level.delta))) level = { delta: diff, guide: target };
    }
    const ax = axis(o.x + dx, w, (r) => [r.x, r.x + r.w / 2, r.x + r.w]);
    const ay = level ?? axis(o.y + dy, h, (r) => [r.y, r.y + r.h / 2, r.y + r.h]);
    setGuides({ x: ax.guide, y: ay.guide });
    return { sx: dx + ax.delta, sy: dy + ay.delta };
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (st().placing || placesBox(st().tool)) setPointer(world(e));
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
        if (isUnderlay(n)) return false;
        const r = nodeRect(n);
        // Frames need to be fully enclosed, otherwise every marquee inside one would grab it.
        return n.type === 'frame' ? contains(rect, r) && contains(rect, { x: r.x + r.w, y: r.y + r.h }) : intersects(rect, r);
      });
      // Lines the frame passes over are taken too (to delete them, say); a line drawn as tags by its tags.
      const routes = routeEdges(s.doc);
      const lines = s.doc.edges.filter((x) =>
        isTagged(s.doc, x) ? edgeTags(s.doc, x, SCREEN).some((t) => intersects(rect, t)) : (routes.get(x.id) ?? []).some((q, i, pts) => i > 0 && segmentHits(pts[i - 1], q, rect)),
      );
      s.select([...new Set([...d.base, ...hit.map((n) => n.id), ...lines.map((x) => x.id)])]);
      return;
    }
    if (d.kind === 'place') {
      const rect = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
      setGhost(tool !== 'sequence' && (rect.w > 8 / s.view.k || rect.h > 8 / s.view.k) ? { kind: 'size', rect } : null);
      return;
    }
    if (d.kind === 'connect') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= 4) return;
      // Nothing to land on: a box of the same kind will be made there (from a shape).
      setGhost({ kind: 'connect', a: d.at, b: p, plan: keepPlan(planConnect(s.doc, d, p, s.view.k) ?? planSpawn(s.doc, d, p)) });
      return;
    }
    if (d.kind === 'reconnect') {
      setGhost({ kind: 'connect', a: d.other, b: p, plan: keepPlan(planReconnect(s.doc, d, p, s.view.k)) });
      return;
    }
    if (d.kind === 'label') {
      if (!d.moved) {
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * s.view.k < 3) return;
        d.moved = true;
        s.checkpoint();
      }
      const pts = routeEdges(s.doc).get(d.id);
      if (!pts) return;
      // The label slides along its line; near the middle it settles back on the default spot.
      const t = Math.min(0.96, Math.max(0.04, nearestT(pts, p)));
      s.updateEdge(d.id, { labelAt: Math.abs(t - 0.5) < 0.02 ? undefined : Math.round(t * 1000) / 1000 }, false);
      return;
    }
    if (d.kind === 'segment') {
      const delta = d.horizontal ? p.y - d.start.y : p.x - d.start.x;
      if (!d.moved) {
        if (Math.abs(delta) * s.view.k < 3) return;
        d.moved = true;
        s.checkpoint();
      }
      // Slide the segment sideways: both of its bend points move together. Close to the level of
      // the bend before or after, it clicks into line with it — that is how a detour is undone.
      const base = d.horizontal ? d.route[d.seg].y : d.route[d.seg].x;
      let v = e.altKey ? base + delta : snap(base + delta);
      let snapped = false;
      for (const near of [d.route[d.seg - 1], d.route[d.seg + 2]]) {
        const c = near && (d.horizontal ? near.y : near.x);
        if (c != null && Math.abs(base + delta - c) < 9 / s.view.k) {
          v = c;
          snapped = true;
        }
      }
      // The guide shows the moment the segment is back in line.
      setGuides(snapped ? (d.horizontal ? { y: v } : { x: v }) : {});
      const route = d.route.map((q, i) => (i !== d.seg && i !== d.seg + 1 ? q : d.horizontal ? { x: q.x, y: v } : { x: v, y: q.y }));
      s.updateEdge(d.id, { route }, false);
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
            // Two decimals: exact enough to keep a snapped cable straight, without float noise in the file.
            return o ? { ...n, x: Math.round((o.x + sx) * 100) / 100, y: Math.round((o.y + sy) * 100) / 100 } : n;
          }),
          edges: d.routes.size ? doc.edges.map((edge) => (d.routes.has(edge.id) ? { ...edge, route: d.routes.get(edge.id)!.map((q) => ({ x: q.x + sx, y: q.y + sy })) } : edge)) : doc.edges,
        }),
        false,
      );
      return;
    }
    const o = d.orig;
    let { x, y, w, h } = o;
    // A sequence diagram stops at the smallest size it stays readable at; anything smaller would
    // move its corner without making it any smaller, so the diagram would slide away.
    const resized = s.doc.nodes.find((n) => n.id === d.id);
    const min = resized?.type === 'sequence' ? seqLayout(resized.text, 1, 1, seqScale(resized.fontSize)) : MIN;
    // The edge being dragged snaps like a moved node does: to the edges and centres of the other
    // nodes, and to the position that gives this node the same width or height as one of them.
    const tol = 6 / s.view.k;
    const free = e.metaKey || e.ctrlKey;
    const rects = free ? [] : s.doc.nodes.filter((n) => n.id !== d.id).map(nodeRect);
    const guide: { x?: number; y?: number } = {};
    const snapEdge = (raw: number, horizontal: boolean, anchor: number): number => {
      let best: number | null = null;
      let line: number | undefined;
      for (const r of rects) {
        const lines = horizontal ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h];
        const same = anchor + Math.sign(raw - anchor) * (horizontal ? r.w : r.h);
        for (const [v, shown] of [...lines.map((v) => [v, v] as const), [same, undefined] as const]) {
          if (Math.abs(v - raw) < tol && (best === null || Math.abs(v - raw) < Math.abs(best - raw))) {
            best = v;
            line = shown;
          }
        }
      }
      if (best === null) return grid(raw);
      if (line !== undefined) guide[horizontal ? 'x' : 'y'] = line;
      return best;
    };
    if (d.corner.includes('e')) w = Math.max(min.w, snapEdge(o.x + o.w + dx, true, o.x) - o.x);
    if (d.corner.includes('w')) {
      x = Math.min(snapEdge(o.x + dx, true, o.x + o.w), o.x + o.w - min.w);
      w = o.x + o.w - x;
    }
    if (d.corner === 'se' || d.corner === 'sw') h = Math.max(min.h, snapEdge(o.y + o.h + dy, false, o.y) - o.y);
    if (d.corner === 'ne' || d.corner === 'nw') {
      y = Math.min(snapEdge(o.y + dy, false, o.y + o.h), o.y + o.h - min.h);
      h = o.y + o.h - y;
    }
    setGuides(guide);
    if (d.lock && !e.shiftKey) {
      h = Math.max(min.h, Math.round(w / d.lock));
      if (d.corner === 'ne' || d.corner === 'nw') y = o.y + o.h - h;
      // The height follows the width here, so only the horizontal guide means anything.
      setGuides({ x: guide.x });
    }
    s.updateNode(d.id, { x, y, w, h }, false);
  };

  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    lastPlan.current = null;
    // The pointer was held by the canvas, so the box it left from never heard it go: its dots
    // would stay lit. They come back as soon as the pointer moves onto a box again.
    if (d?.kind === 'connect' || d?.kind === 'reconnect') {
      setHoverSide(null);
      setHover(null);
      setHush(nodeAt(st().doc, world(e))?.id ?? null);
    }
    setGuides({});
    setBusy(false);
    if (d?.kind === 'place') {
      // Worked out from the pointer itself: a quick drag may end before its outline was ever drawn.
      const p = world(e);
      const rect = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
      const sized = tool !== 'sequence' && (rect.w > 8 / st().view.k || rect.h > 8 / st().view.k);
      if (placesBox(tool)) insertNode(tool, sized ? center(rect) : d.start, sized ? rect : undefined);
      return;
    }
    if (d?.kind === 'segment') {
      // Bends that ended up on a straight run are dropped; a route with none left is automatic again.
      const s = st();
      const pts = d.moved ? routeEdges(s.doc).get(d.id) : undefined;
      if (pts) {
        const route = simplify(pts).slice(1, -1);
        s.updateEdge(d.id, { route: route.length >= 2 ? route : undefined }, false);
      }
      return;
    }
    if (d?.kind === 'reconnect') {
      const s = st();
      const plan = planReconnect(s.doc, d, world(e), s.view.k);
      if (plan) s.setDoc(plan.doc);
      return;
    }
    if (d?.kind !== 'connect') return;
    const s = st();
    // A plain click on a side dot adds the next shape in that direction.
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= 4) {
      if (d.side) spawnFrom(d.from.node, d.side);
      return;
    }
    const p = world(e);
    const plan = planConnect(s.doc, d, p, s.view.k);
    const made = plan ? null : planSpawn(s.doc, d, p);
    if (plan) {
      s.setDoc(plan.doc);
      s.select([plan.edge]);
    } else if (made?.made) {
      // Dropping on empty canvas puts the next shape right there, ready to be named.
      s.setDoc(made.doc);
      s.select([made.made]);
      s.setEditing(made.made);
    }
  };

  const sel = new Set(selection);
  const routes = routeEdges(doc);
  // An underlay (a floor plan) lies beneath everything and lets the pointer through.
  const underlays = doc.nodes.filter(isUnderlay);
  const frames = doc.nodes.filter((n) => n.type === 'frame');
  const others = doc.nodes.filter((n) => n.type !== 'frame' && !isUnderlay(n));
  const single = selection.length === 1 ? doc.nodes.find((n) => n.id === selection[0]) : undefined;
  const selectedEdge = selection.length === 1 ? doc.edges.find((e) => e.id === selection[0]) : undefined;
  const handleNode = doc.nodes.find((n) => n.id === hover && n.id !== hush && hasHandles(n)) ?? (single && hasHandles(single) ? single : undefined);
  const hs = 8 / view.k;
  const idle = tool === 'select' && !editing && !busy;
  const cursor = space || tool === 'pan' ? 'grab' : tool === 'select' && !placing ? 'default' : 'crosshair';
  // What waits to be placed, outlined under the pointer: a library item, or the box an armed tool makes.
  const waiting = placing ? { label: placing.label, size: placing.size } : placesBox(tool) && boxSize(tool) && !busy ? { label: '', size: boxSize(tool)! } : null;
  const preview = idle && handleNode && canConnect(handleNode) && hoverSide ? spawnRect(doc, handleNode, hoverSide) : null;

  const nodeGroup = (n: Node) => (
    <g
      key={n.id}
      onPointerDown={(e) => onNodeDown(e, n)}
      onPointerEnter={() => setHover(n.id)}
      onPointerLeave={() => {
        setHover((h) => (h === n.id ? null : h));
        setHush((h) => (h === n.id ? null : h));
      }}
      style={{ cursor: tool === 'select' && !space ? 'move' : undefined }}
    >
      <NodeView n={editing === n.id && canConnect(n) ? { ...n, text: '' } : n} theme={SCREEN} doc={doc} />
    </g>
  );
  const devicePorts = (render: (key: string, p: Pt, end: EdgeEnd) => ReactNode) =>
    others.flatMap((n) => (n.type === 'device' ? n.ports.map((port) => render(`${n.id}/${port.id}`, portPos(n, port.id)!, { node: n.id, port: port.id })) : []));

  return (
    <div
      id="canvas"
      className="canvas"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void insertImages([...e.dataTransfer.files], world(e));
      }}
    >
      <svg ref={svgRef} width="100%" height="100%" style={{ cursor }} onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setPointer(null)} onDoubleClick={onDoubleClick}>
        <defs>
          <pattern id="dots" width={20 * view.k} height={20 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="#f4f6f9" />
        {view.k > 0.4 && <rect width="100%" height="100%" fill="url(#dots)" />}
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {underlays.map((n) => (
            <NodeView key={n.id} n={n} theme={SCREEN} doc={doc} />
          ))}
          {frames.map(nodeGroup)}
          {(doc.hops ? hopOrder(doc) : doc.edges).map((e) => {
            const pts = routes.get(e.id);
            if (!pts) return null;
            if (isTagged(doc, e)) {
              // No line to grab: the two tags are the cable's handles.
              return (
                <g key={e.id} onPointerDown={(ev) => onEdgeDown(ev, e.id)} style={{ cursor: 'pointer' }}>
                  <EdgeView doc={doc} e={e} theme={SCREEN} />
                  {edgeTags(doc, e, SCREEN).map((t, i) => (
                    <rect key={i} x={t.x - 2} y={t.y - 2} width={t.w + 4} height={t.h + 4} rx={4} fill="transparent" stroke={sel.has(e.id) ? ACCENT : 'none'} strokeWidth={2 / view.k} />
                  ))}
                </g>
              );
            }
            const d = pathD(pts, 8);
            const labelBox = editing === e.id ? null : edgeLabelBox(doc, e, SCREEN);
            return (
              <g key={e.id} onPointerDown={(ev) => onEdgeDown(ev, e.id)} style={{ cursor: 'pointer' }}>
                {sel.has(e.id) && <path d={d} fill="none" stroke={ACCENT} strokeOpacity={0.28} strokeWidth={9} strokeLinecap="round" />}
                <EdgeView doc={doc} e={e} theme={SCREEN} hideLabel={editing === e.id} />
                <path d={d} fill="none" stroke="transparent" strokeWidth={14 / view.k} />
                {labelBox && <rect x={labelBox.x} y={labelBox.y} width={labelBox.w} height={labelBox.h} fill="transparent" style={{ cursor: 'grab' }} onPointerDown={(ev) => onLabelDown(ev, e.id)} />}
              </g>
            );
          })}
          <HopCaps doc={doc} theme={SCREEN} />
          {others.map(nodeGroup)}
          <SharedMarks doc={doc} />

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
                single.type === 'device' || single.type === 'legend'
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
              const at = sidePoint(nodeRect(handleNode), side);
              // A junction dot is smaller than its handles: stand them off so they don't pile up on it.
              const off = handleNode.type === 'junction' ? 10 / view.k : 0;
              const p = { x: at.x + (side === 'right' ? off : side === 'left' ? -off : 0), y: at.y + (side === 'bottom' ? off : side === 'top' ? -off : 0) };
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
          {idle && selectedEdge && !isTagged(doc, selectedEdge) && (
            <EdgeHandles pts={routes.get(selectedEdge.id) ?? []} k={view.k} manual={!!selectedEdge.route} onSegment={(ev, seg, h, route) => onSegmentDown(ev, selectedEdge.id, seg, h, route)} onEnd={(ev, end, other) => onEndDown(ev, selectedEdge.id, end, other)} />
          )}
          {/* While a cable is being dragged, the port under the cursor lights up as the drop target. */}
          {ghost?.kind === 'connect' &&
            devicePorts((key, p) =>
              Math.hypot(p.x - ghost.b.x, p.y - ghost.b.y) <= 10 ? <circle key={key} cx={p.x} cy={p.y} r={9} fill="rgba(37,99,235,0.2)" stroke={ACCENT} strokeWidth={2} pointerEvents="none" /> : null,
            )}

          {guides.x != null && <line x1={guides.x} y1={-1e5} x2={guides.x} y2={1e5} stroke="#f43f5e" strokeWidth={1 / view.k} pointerEvents="none" />}
          {guides.y != null && <line x1={-1e5} y1={guides.y} x2={1e5} y2={guides.y} stroke="#f43f5e" strokeWidth={1 / view.k} pointerEvents="none" />}
          {ghost?.kind === 'connect' && <ConnectGhost ghost={ghost} doc={doc} k={view.k} />}
          {waiting && pointer && !ghost && (
            <g pointerEvents="none">
              <rect x={pointer.x - waiting.size.w / 2} y={pointer.y - waiting.size.h / 2} width={waiting.size.w} height={waiting.size.h} rx={4 / view.k} fill="rgba(37,99,235,0.06)" stroke={ACCENT} strokeOpacity={0.7} strokeWidth={1.5 / view.k} strokeDasharray={`${5 / view.k} ${4 / view.k}`} />
              {waiting.label && (
                <text x={pointer.x} y={pointer.y - waiting.size.h / 2 - 6 / view.k} fontSize={11 / view.k} fill={ACCENT} textAnchor="middle" fontFamily={SCREEN.font}>
                  {waiting.label}
                </text>
              )}
            </g>
          )}
          {ghost?.kind === 'size' && <rect x={ghost.rect.x} y={ghost.rect.y} width={ghost.rect.w} height={ghost.rect.h} rx={4 / view.k} fill="rgba(37,99,235,0.06)" stroke={ACCENT} strokeWidth={1.5 / view.k} strokeDasharray={`${5 / view.k} ${4 / view.k}`} pointerEvents="none" />}
          {ghost?.kind === 'marquee' && <rect x={ghost.rect.x} y={ghost.rect.y} width={ghost.rect.w} height={ghost.rect.h} fill="rgba(37,99,235,0.08)" stroke={ACCENT} strokeWidth={1 / view.k} pointerEvents="none" />}
        </g>
      </svg>
      {editing && <TextEditor key={editing} id={editing} />}
      {/* Keyed by the selection so an open menu never carries over to another object. */}
      {idle && selection.length > 0 && <QuickBar key={selection.join(',')} />}
      {(placing || placesBox(tool)) && !busy && (
        <div className="place-hint">
          {placing ? `「${placing.label}」: 置きたい所をクリック` : tool === 'sequence' ? '置きたい所をクリック' : '置きたい所をクリック、ドラッグで大きさを決めて置く'}
          <span>Esc でやめる</span>
        </div>
      )}
      <div className="zoom">
        <button onClick={() => zoomBy(1 / 1.25)} title="縮小">−</button>
        <button onClick={() => st().setView({ ...view, k: 1 })} title="100%">{Math.round(view.k * 100)}%</button>
        <button onClick={() => zoomBy(1.25)} title="拡大">＋</button>
        <button onClick={() => st().fit()} title="全体表示 (⇧1)">全体</button>
      </div>
    </div>
  );
}

/**
 * A small link mark on what is shared with other boards of the project (screen only: an export
 * shows the drawing, not how it is kept).
 */
/** What letting go of a pulled line would make: the board with the line in it, and what it lands on. */
interface Plan {
  doc: Doc;
  edge: string;
  /** The box it goes into, and the side it is held to (when let go on one of the box's dots). */
  box?: string;
  side?: Dir;
  /** The line it merges with. */
  line?: string;
  /** The box made for it, let go on empty canvas. */
  made?: string;
  /** The same key, the same plan: what it lands on, and where. */
  key: string;
}

/** How near (screen px) to a box's side dot the end goes in at that side. */
const SNAP = 18;

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
  }
  const over = nodeAt(doc, p);
  if (over && over.type !== 'frame') return { end: { node: over.id }, doc, box: over.id };
  const line = edgeNear(doc, p, 8 / k, skip);
  if (!line) return null;
  return { ...mergeAt(doc, line.edge, which), line: line.edge.id };
}

const planKey = (t: { end: EdgeEnd; box?: string; line?: string }): string => `${t.end.node}|${t.end.port ?? ''}|${t.end.side ?? ''}|${t.line ?? ''}`;

/** A new line pulled from a dot or a port and let go at `p`. */
function planConnect(doc: Doc, d: ConnectDrag, p: Pt, k: number): Plan | null {
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
  if (!from.port) ({ end: from, doc: next } = claimPort(next, from.node, signal, 'right', from.side));
  if (!to.port) ({ end: to, doc: next } = claimPort(next, to.node, signal, 'left', to.side));
  // A line merging into another looks like it, so the two read as one from where they meet.
  const edge = { ...makeEdge(allIds(base), from, to, signal), ...(merged ? { arrow: merged.arrow, color: merged.color, dash: merged.dash } : {}) };
  return { doc: { ...next, edges: [...next.edges, edge] }, edge: edge.id, box: t.box, side: t.end.side, line: t.line, key: planKey(t) };
}

/** One end of a line dragged elsewhere and let go at `p`. */
function planReconnect(doc: Doc, d: ReconnectDrag, p: Pt, k: number): Plan | null {
  const edge = doc.edges.find((x) => x.id === d.id);
  if (!edge) return null;
  const keep = d.end === 'from' ? edge.to : edge.from;
  const t = dropAt(doc, p, k, d.end, d.id);
  if (!t || t.end.node === keep.node) return null;
  // Dropped on a device body: take a free port of the cable's type on the matching side.
  const claimed = t.end.port ? { end: t.end, doc: t.doc } : claimPort(t.doc, t.end.node, edge.signal, d.end === 'from' ? 'right' : 'left', t.end.side);
  const next = { ...claimed.doc, edges: claimed.doc.edges.map((x) => (x.id === d.id ? { ...x, [d.end]: claimed.end, route: undefined } : x)) };
  return { doc: next, edge: d.id, box: t.box, side: t.end.side, line: t.line, key: planKey(t) };
}

/** Let go on no box (an area is open ground): back on the box it came from, it is called off. */
function onEmpty(doc: Doc, p: Pt): boolean {
  const over = nodeAt(doc, p);
  return !over || over.type === 'frame';
}

/** A line pulled from a box and let go on empty canvas: a box of the same kind there, at its end. */
function planSpawn(doc: Doc, d: ConnectDrag, p: Pt): Plan | null {
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
function ConnectGhost({ ghost, doc, k }: { ghost: Extract<Ghost, { kind: 'connect' }>; doc: Doc; k: number }) {
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
          const on = plan.side === side;
          return <circle key={side} cx={q.x} cy={q.y} r={(on ? 7 : 3.5) / k} fill={on ? ACCENT : '#fff'} stroke={ACCENT} strokeWidth={1.5 / k} />;
        })}
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

/**
 * 🔗 on devices that are the same thing as one on another board of the project. A key no other
 * board carries (the other copy deleted, or moved to another project) shows nothing. The mark is
 * part of the drawing, so it grows and shrinks with the box it sits on.
 */
function SharedMarks({ doc }: { doc: Doc }) {
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
 * Handles on a selected cable: a grip on every segment, to slide it sideways,
 * and a knob on each end to plug it into a different port.
 */
function EdgeHandles({ pts, k, manual, onSegment, onEnd }: {
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
function segmentHits(a: Pt, b: Pt, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 <= r.x + r.w && x1 >= r.x && y0 <= r.y + r.h && y1 >= r.y;
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
  // Area names stay on one line. A device name or a line's label may run to several, but Enter
  // still finishes it (Shift+Enter breaks the line).
  const oneLine = node?.type === 'frame';
  const enterCommits = oneLine || !node || node.type === 'device';
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
    } else if (node?.type === 'text' && !text) {
      // A text box left empty would be an invisible, unselectable leftover.
      s.setEditing(null);
      return s.removeIds([id]);
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
    const at = labelPoint(routeEdges(doc).get(id) ?? [{ x: 0, y: 0 }], edge?.labelAt);
    style = { left: view.x + at.x * k, top: view.y + at.y * k, transform: 'translate(-50%, -50%)', minWidth: 48 * k, fontSize: 12 * k, background: '#fff', padding: `${2 * k}px ${6 * k}px`, ...outline };
  } else if (node.type === 'device') {
    style = { left: view.x + node.x * k, top: view.y + node.y * k, width: node.w * k, minHeight: deviceHead(node) * k, fontSize: DEVICE_NAME.size * k, fontWeight: 700, background: '#e8edf3', borderRadius: 6 * k };
  } else if (node.type === 'frame') {
    const size = textSize(node);
    style = { left: view.x + (node.x + 8) * k, top: view.y + (node.y + 5) * k, minWidth: 80 * k, height: (size + 13) * k, fontSize: size * k, fontWeight: textWeight(node), textAlign: 'left', background: '#fff', padding: `0 ${4 * k}px`, ...outline };
  } else {
    // Same width, size and line height as the SVG text, so nothing jumps on commit.
    const tw = textWidth(node);
    // A sticky's text sits below its label.
    const head = node.type === 'sticky' ? STICKY_HEAD : 0;
    style = { left: view.x + (node.x + (node.w - tw) / 2) * k, top: view.y + (node.y + head) * k, width: tw * k, height: (node.h - head) * k, fontSize: textSize(node) * k, fontWeight: textWeight(node) };
    if (node.type === 'shape' && node.fill === 'solid') style.color = STRONG[node.color].text;
  }
  return (
    // The box does the centring and the editable sits inside it as a plain block: an empty
    // editable that is itself a flex container puts its caret at the top instead of the middle.
    <div
      className="text-editor-box"
      style={{ color: INK, lineHeight: TEXT.lineHeight, ...style }}
      onPointerDown={(e) => {
        e.stopPropagation();
        // A click beside the text still belongs to the editor.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          ref.current?.focus();
        }
      }}
    >
      <div
        ref={ref}
        className="text-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={edge ? 'ラベル' : 'テキストを入力'}
        onInput={grow}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          // While the IME is composing, Enter / Escape belong to the conversion, not to us.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape' || (e.key === 'Enter' && ((enterCommits && !e.shiftKey) || e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}
