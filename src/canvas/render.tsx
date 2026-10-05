import type { ReactNode } from 'react';
import { DEV, crossings, isTagged, labelPoint, nodeSize, pathD, portPos, routeEdges } from '../model/geometry';
import { lineColor, signalColor } from '../model/lineColor';
import { cableIds, powerLoads } from '../model/lists';
import { SEQ, parseSequence } from '../model/sequence';
import { PALETTE, STICKY, STRONG, signalOf } from '../model/signals';
import { measure, wrapText } from '../model/text';
import type { DeviceNode, Doc, Edge, Node, Pt, Rect, SequenceNode } from '../model/types';
import { assetUrl } from '../platform/storage';

/** `mono` draws the CAD-style sheet look: black lines, dash patterns instead of colours. */
export interface Theme {
  mono: boolean;
  /** Keep signal colours on the CAD look. */
  color: boolean;
  font: string;
  /** Board px per millimetre of paper — lets the CAD look use real line widths (JIS Z 8312). */
  unit: number;
}
export const SCREEN: Theme = {
  mono: false,
  color: true,
  font: '-apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif',
  unit: 96 / 25.4,
};
export const CAD_FONT = '"Osaka-Mono", "MS Gothic", "Noto Sans Mono CJK JP", "Hiragino Sans", monospace';

/** Text metrics shared by the renderer and the in-place editor so they line up exactly. */
export const TEXT = { shape: 14, sticky: 13.5, text: 14, lineHeight: 1.4 };
export const INK = '#27323f';

/**
 * Baseline offset that visually centres a line on y. Done by hand instead of
 * `dominant-baseline`, which Illustrator / Keynote / Figma ignore on import.
 */
export const mid = (y: number, size: number): number => y + size * 0.36;

/** Width available to the text of a node — the editor wraps to the same width. */
export function textWidth(n: Node): number {
  if (n.type === 'shape') return n.shape === 'diamond' ? n.w * 0.6 : n.shape === 'ellipse' ? n.w * 0.72 : n.shape === 'cloud' ? n.w * 0.66 : n.w - 20;
  if (n.type === 'sticky') return n.w - 24;
  return n.w;
}
export const textSize = (n: Node): number => (n.type === 'sticky' ? TEXT.sticky : n.type === 'text' ? (n.fontSize ?? TEXT.text) : TEXT.shape);
/** Large free text is a heading, so it is set bold. */
export const textWeight = (n: Node): number => (n.type === 'text' && (n.fontSize ?? 0) >= 20 ? 700 : 400);

interface TextProps {
  x: number;
  y: number;
  w: number;
  text: string;
  size: number;
  theme: Theme;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
}

/** Wrapped text block centred vertically on y. */
export function TextBlock({ x, y, w, text, size, theme, weight = 400, fill = INK, anchor = 'middle' }: TextProps) {
  const lines = wrapText(text, w, `${weight} ${size}px ${theme.font}`);
  const lh = size * TEXT.lineHeight;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  return (
    <text fontFamily={theme.font} fontSize={size} fontWeight={weight} fill={theme.mono ? '#000' : fill} textAnchor={anchor}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} y={mid(y0 + i * lh, size)}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

const lw = (theme: Theme, mm: number): number => mm * theme.unit;

function signalStroke(signal: string, theme: Theme, color: string): { stroke: string; dash?: string } {
  const s = signalOf(signal);
  if (!theme.mono) return { stroke: color };
  // Dash patterns are authored for 1:1; keep them the same size on paper at any fit scale.
  const k = (theme.unit * 25.4) / 96;
  const dash = s.dash ? s.dash.split(' ').map((v) => Number(v) * k).join(' ') : undefined;
  return { stroke: theme.color ? color : '#000', dash };
}

function Device({ n, theme, doc }: { n: DeviceNode; theme: Theme; doc?: Doc }) {
  const { w, h } = nodeSize(n);
  const { x, y } = n;
  const r = theme.mono ? 0 : 7;
  // Colour-coded devices take the tint on their header and outline; gray is the plain look.
  const tint = !theme.mono && n.color && n.color !== 'gray' ? PALETTE[n.color] : null;
  const line = theme.mono ? '#000' : (tint?.stroke ?? '#334155');
  const sw = theme.mono ? lw(theme, 0.35) : 1.5;
  const sub = [n.maker, n.model].filter(Boolean).join(' ');
  const head = `M${x},${y + DEV.head} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + DEV.head} Z`;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill="#fff" stroke={line} strokeWidth={sw} />
      <path d={head} fill={theme.mono ? '#fff' : (tint?.fill ?? '#e8edf3')} stroke={line} strokeWidth={sw} />
      <TextBlock x={x + w / 2} y={y + (sub ? 16 : DEV.head / 2)} w={w - 12} text={n.text.split('\n')[0]} size={13} weight={700} theme={theme} />
      {sub && <TextBlock x={x + w / 2} y={y + 33} w={w - 12} text={sub} size={9.5} fill="#64748b" theme={theme} />}
      {doc && <LoadBadge doc={doc} n={n} theme={theme} />}
      {n.ports.map((p) => {
        const pos = portPos(n, p.id)!;
        const left = p.side === 'left';
        const { stroke } = signalStroke(p.signal, theme, signalColor(doc, p.signal));
        return (
          <g key={p.id}>
            {theme.mono ? (
              <rect x={pos.x - 3} y={pos.y - 3} width={6} height={6} fill="#fff" stroke={stroke} strokeWidth={lw(theme, 0.25)} />
            ) : (
              <circle cx={pos.x} cy={pos.y} r={4.5} fill={stroke} stroke="#fff" strokeWidth={1.5} />
            )}
            <text x={left ? pos.x + 9 : pos.x - 9} y={mid(pos.y, 10.5)} fontFamily={theme.font} fontSize={10.5} fill={theme.mono ? '#000' : '#334155'} textAnchor={left ? 'start' : 'end'}>
              {p.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Load summary above a power source: how many devices it feeds and how many watts they draw. */
function LoadBadge({ doc, n, theme }: { doc: Doc; n: DeviceNode; theme: Theme }) {
  const load = powerLoads(doc).get(n.id);
  if (!load) return null;
  const watts = load.capacity != null ? `${load.watts} / ${load.capacity}W` : load.watts ? `${load.watts}W` : '';
  const text = [`⚡ ${load.ids.length}台`, watts, load.over ? '容量超過' : ''].filter(Boolean).join(' · ');
  const size = 10.5;
  const bw = measure(text, `600 ${size}px ${theme.font}`) + 12;
  const bx = n.x + n.w - bw;
  const by = n.y - 20;
  const color = theme.mono ? '#000' : load.over ? '#dc2626' : '#b45309';
  return (
    <g>
      <rect x={bx} y={by} width={bw} height={16} rx={theme.mono ? 0 : 8} fill={theme.mono ? '#fff' : load.over ? '#fee2e2' : '#fef3c7'} stroke={color} strokeWidth={theme.mono ? lw(theme, 0.18) : 0.8} />
      <text x={bx + bw / 2} y={mid(by + 8, size)} fontFamily={theme.font} fontSize={size} fontWeight={600} fill={color} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function arrowHead(tip: Pt, from: Pt, size: number, spread = 0.42): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const p = (da: number): string => `${tip.x - size * Math.cos(a + da)},${tip.y - size * Math.sin(a + da)}`;
  return `${tip.x},${tip.y} ${p(spread)} ${p(-spread)}`;
}

function Sequence({ n, theme }: { n: SequenceNode; theme: Theme }) {
  const d = parseSequence(n.text);
  const line = theme.mono ? '#000' : '#334155';
  const sw = theme.mono ? lw(theme, 0.25) : 1.3;
  const top = n.y + SEQ.padTop + (d.title ? SEQ.titleH : 0);
  const cx = (i: number): number => n.x + SEQ.padX + i * SEQ.col + SEQ.col / 2;
  const lifeTop = top + SEQ.boxH;
  const out: ReactNode[] = [
    <rect key="bg" x={n.x} y={n.y} width={d.w} height={d.h} rx={theme.mono ? 0 : 8} fill="#fff" stroke={theme.mono ? '#000' : '#cbd5e1'} strokeWidth={theme.mono ? lw(theme, 0.18) : 1} />,
  ];
  if (d.title) out.push(<TextBlock key="t" x={n.x + d.w / 2} y={n.y + SEQ.padTop + 8} w={d.w - 20} text={d.title} size={13} weight={700} theme={theme} />);
  d.participants.forEach((p, i) => {
    out.push(
      <g key={`p${i}`}>
        <line x1={cx(i)} y1={lifeTop} x2={cx(i)} y2={n.y + d.h - 12} stroke={line} strokeWidth={sw * 0.75} strokeDasharray="4 4" />
        <rect x={cx(i) - SEQ.boxW / 2} y={top} width={SEQ.boxW} height={SEQ.boxH} rx={theme.mono ? 0 : 5} fill={theme.mono ? '#fff' : '#e8edf3'} stroke={line} strokeWidth={sw} />
        <TextBlock x={cx(i)} y={top + SEQ.boxH / 2} w={SEQ.boxW - 8} text={p.label} size={11.5} weight={600} theme={theme} />
      </g>,
    );
  });
  d.items.forEach((it, i) => {
    const y = lifeTop + (i + 1) * SEQ.step;
    if (it.kind === 'note') {
      const w = Math.min(SEQ.col - 12, measure(it.text, `11px ${theme.font}`) + 18);
      out.push(
        <g key={`i${i}`}>
          <rect x={cx(it.over) - w / 2} y={y - 13} width={w} height={26} fill={theme.mono ? '#fff' : '#fef3c7'} stroke={theme.mono ? '#000' : '#eab308'} strokeWidth={theme.mono ? lw(theme, 0.18) : 1} />
          <TextBlock x={cx(it.over)} y={y} w={w - 8} text={it.text} size={11} theme={theme} />
        </g>,
      );
      return;
    }
    const dash = it.dashed ? '5 3' : undefined;
    if (it.from === it.to) {
      const x = cx(it.from);
      out.push(
        <g key={`i${i}`}>
          <path d={`M${x},${y - 8} H${x + 36} V${y + 8} H${x}`} fill="none" stroke={line} strokeWidth={sw} strokeDasharray={dash} />
          <polygon points={arrowHead({ x, y: y + 8 }, { x: x + 36, y: y + 8 }, 8)} fill={line} />
          <text x={x + 42} y={mid(y, 11)} fontFamily={theme.font} fontSize={11} fill={theme.mono ? '#000' : INK}>
            {it.text}
          </text>
        </g>,
      );
      return;
    }
    const a = { x: cx(it.from), y };
    const b = { x: cx(it.to), y };
    out.push(
      <g key={`i${i}`}>
        <line x1={a.x} y1={y} x2={b.x} y2={y} stroke={line} strokeWidth={sw} strokeDasharray={dash} />
        <polygon points={arrowHead(b, a, 8)} fill={line} />
        <TextBlock x={(a.x + b.x) / 2} y={y - 10} w={Math.abs(b.x - a.x) - 12} text={it.text} size={11} theme={theme} />
      </g>,
    );
  });
  return <g>{out}</g>;
}

/**
 * Scalloped cloud outline filling the box: evenly spaced points on an inset
 * ellipse joined by outward arcs, with a bump centred on each side midpoint so
 * connectors meet the outline.
 */
function cloudPath(x: number, y: number, w: number, h: number): string {
  const perimeter = Math.PI * (w + h) * 0.5;
  const n = Math.max(8, Math.round(perimeter / 34 / 4) * 4);
  const chord = perimeter / n;
  const R = 0.62; // arc radius relative to the chord
  const inset = chord * (R - Math.sqrt(R * R - 0.25));
  const rx = Math.max(4, w / 2 - inset);
  const ry = Math.max(4, h / 2 - inset);
  // Walk the ellipse finely so the bumps are spaced by arc length, not by angle.
  const STEPS = 720;
  const fine: { x: number; y: number; len: number }[] = [];
  let len = 0;
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    const p = { x: x + w / 2 + rx * Math.cos(a), y: y + h / 2 + ry * Math.sin(a) };
    if (i) len += Math.hypot(p.x - fine[i - 1].x, p.y - fine[i - 1].y);
    fine.push({ ...p, len });
  }
  const pts: Pt[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = ((i + 0.5) / n) * len;
    while (fine[j].len < target) j++;
    pts.push(fine[j]);
  }
  const f = (v: number): string => v.toFixed(1);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    const r = Math.hypot(b.x - a.x, b.y - a.y) * R;
    d += ` A${f(r)},${f(r)} 0 0 1 ${f(b.x)},${f(b.y)}`;
  }
  return `${d} Z`;
}

export function NodeView({ n, theme, doc }: { n: Node; theme: Theme; doc?: Doc }) {
  const { x, y } = n;
  const { w, h } = nodeSize(n);
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (n.type) {
    case 'device':
      return <Device n={n} theme={theme} doc={doc} />;
    case 'sequence':
      return <Sequence n={n} theme={theme} />;
    case 'frame': {
      // Area boundary: long-dash-dot thin line, as on installation drawings.
      const k = (theme.unit * 25.4) / 96;
      // A coloured area takes the tint as a light wash, with the outline and title in the full colour.
      const tint = !theme.mono && n.color && n.color !== 'gray' ? { wash: PALETTE[n.color].fill, line: n.color === 'white' ? PALETTE.white.stroke : STRONG[n.color].fill } : null;
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={theme.mono ? 0 : 10}
            fill={theme.mono ? 'none' : (tint?.wash ?? 'rgba(100,116,139,0.06)')}
            fillOpacity={tint ? 0.45 : undefined}
            stroke={theme.mono ? '#000' : (tint?.line ?? '#94a3b8')}
            strokeWidth={theme.mono ? lw(theme, 0.18) : tint ? 1.5 : 1.2}
            strokeDasharray={theme.mono ? [14, 3, 2, 3].map((v) => v * k).join(' ') : '6 5'}
          />
          <TextBlock x={x + 12} y={y + 18} w={w - 24} text={n.text} size={13} weight={700} fill={tint && n.color !== 'white' ? tint.line : '#475569'} anchor="start" theme={theme} />
        </g>
      );
    }
    case 'image':
      return <image href={assetUrl(doc?.id, n.src)} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" />;
    case 'text':
      return (
        <g>
          {/* Invisible body so bare text can still be grabbed and dragged. */}
          <rect x={x} y={y} width={w} height={h} fill="none" pointerEvents="all" />
          <TextBlock x={cx} y={cy} w={textWidth(n)} text={n.text} size={textSize(n)} weight={textWeight(n)} theme={theme} />
        </g>
      );
    case 'sticky': {
      const c = STICKY[n.color];
      // Paper square with the bottom-right corner curling up off the board.
      const f = Math.min(22, w / 4, h / 4);
      const paper = `M${x},${y} H${x + w} V${y + h - f} L${x + w - f},${y + h} H${x} Z`;
      const curl = `M${x + w - f},${y + h} L${x + w - f * 0.82},${y + h - f * 0.82} L${x + w},${y + h - f} Z`;
      return (
        <g>
          {theme.mono ? (
            <path d={`${paper} ${curl}`} fill="#fff" stroke="#000" strokeWidth={lw(theme, 0.18)} strokeLinejoin="round" />
          ) : (
            <>
              <path d={`M${x + 3},${y + 8} H${x + w - 1} V${y + h - f + 5} L${x + w - f + 2},${y + h + 6} H${x + 5} Z`} fill="rgba(15,23,42,0.07)" />
              <path d={`M${x + 2},${y + 5} H${x + w} V${y + h - f + 3} L${x + w - f + 1},${y + h + 3} H${x + 3} Z`} fill="rgba(15,23,42,0.1)" />
              <path d={paper} fill={c.fill} />
              {/* The glued strip along the top edge reads slightly darker. */}
              <rect x={x} y={y} width={w} height={Math.min(12, h / 6)} fill="rgba(0,0,0,0.018)" />
              <path d={curl} fill={c.stroke} />
              <path d={`M${x + w - f},${y + h} L${x + w},${y + h - f}`} stroke="rgba(0,0,0,0.12)" strokeWidth={0.8} />
            </>
          )}
          <TextBlock x={cx} y={cy} w={textWidth(n)} text={n.text} size={TEXT.sticky} theme={theme} />
        </g>
      );
    }
    case 'shape': {
      const style = n.fill ?? 'tint';
      const strong = STRONG[n.color];
      const c = theme.mono
        ? { fill: style === 'none' ? 'none' : '#fff', stroke: '#000' }
        : style === 'tint'
          ? PALETTE[n.color]
          : style === 'solid'
            ? { fill: strong.fill, stroke: strong.fill }
            : { fill: style === 'none' ? 'none' : '#fff', stroke: strong.fill };
      const ink = !theme.mono && style === 'solid' ? strong.text : INK;
      const sw = theme.mono ? lw(theme, 0.35) : 2;
      const k = theme.mono ? (theme.unit * 25.4) / 96 : 1;
      // A see-through shape must still be grabbable anywhere inside its outline.
      const paint = { fill: c.fill, stroke: c.stroke, strokeWidth: sw, strokeDasharray: n.dash ? `${7 * k} ${5 * k}` : undefined, pointerEvents: c.fill === 'none' ? ('all' as const) : undefined };
      let body: ReactNode;
      if (n.shape === 'diamond') {
        body = <polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} {...paint} strokeLinejoin="round" />;
      } else if (n.shape === 'cloud') {
        body = <path d={cloudPath(x, y, w, h)} {...paint} strokeLinejoin="round" />;
      } else if (n.shape === 'ellipse') {
        body = <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} {...paint} />;
      } else {
        const rx = n.shape === 'round' ? h / 2 : theme.mono ? 0 : 4;
        body = <rect x={x} y={y} width={w} height={h} rx={rx} {...paint} />;
      }
      return (
        <g>
          {body}
          <TextBlock x={cx} y={cy} w={textWidth(n)} text={n.text} size={TEXT.shape} fill={ink} theme={theme} />
        </g>
      );
    }
  }
}

export function edgeLabel(doc: Doc, e: Edge): string {
  const id = cableIds(doc).get(e.id);
  return [id, e.label, e.length != null ? `${e.length}m` : ''].filter(Boolean).join(' · ');
}

/** Box the label of a line occupies on the board — what you grab to slide it along the line. */
export function edgeLabelBox(doc: Doc, e: Edge, theme: Theme): Rect | null {
  const pts = routeEdges(doc).get(e.id);
  const label = edgeLabel(doc, e);
  if (!pts || pts.length < 2 || !label || isTagged(doc, e)) return null;
  const size = e.signal === 'flow' ? 12 : 10.5;
  const w = measure(label, `${size}px ${theme.font}`) + 10;
  const at = labelPoint(pts, e.labelAt);
  return { x: at.x - w / 2, y: at.y - size * 0.8, w, h: size * 1.6 };
}

/** Nearest point along the route that differs from pts[i] — hand-placed bends can coincide. */
function distinct(pts: Pt[], i: number, step: 1 | -1): Pt {
  for (let j = i + step; j >= 0 && j < pts.length; j += step) {
    if (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) > 0.5) return pts[j];
  }
  return { x: pts[i].x - step, y: pts[i].y };
}

/** Square-cornered path with a small hop wherever another cable crosses underneath. */
function hopPath(pts: Pt[], hops: Map<number, number[]> | undefined, r: number): string {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const xs = hops?.get(i - 1);
    if (xs) {
      const dir = b.x > a.x ? 1 : -1;
      for (const x of [...xs].sort((p, q) => (p - q) * dir)) {
        d += ` L${x - dir * r},${a.y} A${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${x + dir * r},${a.y}`;
      }
    }
    d += ` L${b.x},${b.y}`;
  }
  return d;
}

export interface EdgeTag extends Rect {
  text: string;
  /** Short lead from the port to the tag. */
  from: Pt;
  to: Pt;
}

/**
 * Tag (net label) boxes for an edge drawn without a line: one at each end
 * naming what is on the other side. Keeps a UPS feeding a dozen devices from
 * burying the diagram under power cables.
 */
export function edgeTags(doc: Doc, e: Edge, theme: Theme): EdgeTag[] {
  const pts = routeEdges(doc).get(e.id);
  if (!pts || pts.length < 2) return [];
  const name = (id: string): string => doc.nodes.find((n) => n.id === id)?.text.split('\n')[0] || id;
  const id = cableIds(doc).get(e.id);
  const length = e.length != null ? ` ${e.length}m` : '';
  const power = e.signal === 'power';
  const size = 10;
  const make = (at: Pt, toward: Pt, text: string): EdgeTag => {
    const horizontal = Math.abs(toward.x - at.x) >= Math.abs(toward.y - at.y);
    const s = horizontal ? (toward.x >= at.x ? 1 : -1) : toward.y >= at.y ? 1 : -1;
    const w = measure(text, `${size}px ${theme.font}`) + 10;
    const h = 15;
    const lead = 9;
    if (horizontal) return { text, from: at, to: { x: at.x + s * lead, y: at.y }, x: s > 0 ? at.x + lead : at.x - lead - w, y: at.y - h / 2, w, h };
    return { text, from: at, to: { x: at.x, y: at.y + s * lead }, x: at.x - w / 2, y: s > 0 ? at.y + lead : at.y - lead - h, w, h };
  };
  const first = pts.find((p) => Math.hypot(p.x - pts[0].x, p.y - pts[0].y) > 1) ?? { x: pts[0].x + 1, y: pts[0].y };
  const end = pts[pts.length - 1];
  const before = [...pts].reverse().find((p) => Math.hypot(p.x - end.x, p.y - end.y) > 1) ?? { x: end.x - 1, y: end.y };
  return [
    make(pts[0], first, `${id ? `${id} ` : ''}→ ${name(e.to.node)}${length}`),
    make(end, before, `${power ? '⚡' : '←'} ${name(e.from.node)}${e.label ? ` · ${e.label}` : ''}`),
  ];
}

function TaggedEdge({ doc, e, theme }: { doc: Doc; e: Edge; theme: Theme }) {
  const { stroke } = signalStroke(e.signal, theme, lineColor(doc, e));
  const ink = theme.mono && !theme.color ? '#000' : stroke;
  const width = theme.mono ? lw(theme, 0.25) : 1.5;
  return (
    <g>
      {edgeTags(doc, e, theme).map((t, i) => (
        <g key={i}>
          <line x1={t.from.x} y1={t.from.y} x2={t.to.x} y2={t.to.y} stroke={ink} strokeWidth={width} />
          <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={theme.mono ? 0 : 3} fill="#fff" stroke={ink} strokeWidth={theme.mono ? lw(theme, 0.18) : 1} />
          <text x={t.x + t.w / 2} y={mid(t.y + t.h / 2, 10)} fontFamily={theme.font} fontSize={10} fill={ink} textAnchor="middle">
            {t.text}
          </text>
        </g>
      ))}
    </g>
  );
}

export function EdgeView({ doc, e, theme, hideLabel }: { doc: Doc; e: Edge; theme: Theme; hideLabel?: boolean }) {
  const pts = routeEdges(doc).get(e.id);
  if (!pts || pts.length < 2) return null;
  if (isTagged(doc, e)) return <TaggedEdge doc={doc} e={e} theme={theme} />;
  const flow = e.signal === 'flow';
  const signal = signalStroke(e.signal, theme, lineColor(doc, e));
  const stroke = signal.stroke;
  // On drawings the dash pattern already encodes the cable type, so only flows take the user's dash.
  const dash = e.dash && (!theme.mono || flow) ? '7 6' : signal.dash;
  const label = hideLabel ? '' : edgeLabel(doc, e);
  const at = labelPoint(pts, e.labelAt);
  const size = flow ? 12 : 10.5;
  const lwText = label ? measure(label, `${size}px ${theme.font}`) + 10 : 0;
  const n = pts.length;
  const width = theme.mono ? lw(theme, 0.25) : flow ? 2.4 : 1.8;
  const d = theme.mono ? hopPath(pts, crossings(doc).get(e.id), 3.5) : pathD(pts, 8);
  // Drawings mark signal direction with an arrowhead at the receiving end.
  const cadArrow = theme.mono && signalOf(e.signal).cable;
  const head = theme.mono ? 7 : flow ? 11 : 9;
  // At a device port the arrowhead stops at the port marker instead of hiding underneath it.
  const tip = (i: number, step: 1 | -1, atPort: boolean): Pt => {
    const back = atPort ? (theme.mono ? 3.4 : 6) : 0;
    const q = distinct(pts, i, step);
    const len = Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
    return back && len > back + head ? { x: pts[i].x + ((q.x - pts[i].x) / len) * back, y: pts[i].y + ((q.y - pts[i].y) / len) * back } : pts[i];
  };
  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap={flow ? 'round' : undefined} />
      {(e.arrow !== 'none' || cadArrow) && <polygon points={arrowHead(tip(n - 1, -1, !!e.to.port), distinct(pts, n - 1, -1), head, cadArrow ? 0.3 : 0.42)} fill={stroke} />}
      {e.arrow === 'both' && <polygon points={arrowHead(tip(0, 1, !!e.from.port), distinct(pts, 0, 1), head)} fill={stroke} />}
      {label && (
        <g>
          <rect
            x={at.x - lwText / 2}
            y={at.y - size * 0.8}
            width={lwText}
            height={size * 1.6}
            rx={theme.mono ? 0 : 4}
            fill={theme.mono ? '#fff' : '#f8fafc'}
            stroke={theme.mono ? stroke : 'none'}
            strokeWidth={lw(theme, 0.13)}
          />
          <text x={at.x} y={mid(at.y, size)} fontFamily={theme.font} fontSize={size} fill={theme.mono && !theme.color ? '#000' : flow ? INK : stroke} textAnchor="middle">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

/** The whole board: frames, then cables, then everything else. */
export function DocView({ doc, theme }: { doc: Doc; theme: Theme }) {
  return (
    <g>
      {doc.nodes.filter((n) => n.type === 'frame').map((n) => <NodeView key={n.id} n={n} theme={theme} />)}
      {doc.edges.map((e) => <EdgeView key={e.id} doc={doc} e={e} theme={theme} />)}
      {doc.nodes.filter((n) => n.type !== 'frame').map((n) => <NodeView key={n.id} n={n} theme={theme} doc={doc} />)}
    </g>
  );
}
