import type { ReactNode } from 'react';
import { DEV, DEVICE_NAME, crossings, deviceHead, hopOrder, isTagged, isUnderlay, labelPoint, nodeSize, pathD, portPos, routeEdges } from '../model/geometry';
import { LEGEND, shownRows } from '../model/legend';
import { lineColor, mix, signalColor } from '../model/lineColor';
import { cableIds, idShown, ipIssues, labelStacked, lengthShown, powerLoads } from '../model/lists';
import { SEQ, SEQ_TEXT, parseSequence, seqBands, seqLayout, seqRows, seqScale } from '../model/sequence';
import { PALETTE, STICKY, STRONG, signalOf } from '../model/signals';
import { MONO_FONT, UI_FONT, measure, wrapText } from '../model/text';
import { safeUrl } from '../model/url';
import type { DeviceNode, Doc, Edge, Node, Pt, Rect, SequenceNode } from '../model/types';
import { assetUrl } from '../platform/storage';

/** How the board is drawn; the screen and every export share one look. */
export interface Theme {
  font: string;
}
export const SCREEN: Theme = {
  font: UI_FONT,
};

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
/**
 * Height a shape, sticky or text box needs to hold `text` at its font size,
 * rounded up to the grid. Pointed and rounded shapes need more room than their
 * text block, since the text sits in the middle of them.
 */
/** Room along a sticky's top for its "COMMENT" label: its text is centred in what is left below. */
export const STICKY_HEAD = 12;

export function textHeightFor(n: Node, text: string): number {
  const size = textSize(n);
  const lines = wrapText(text, textWidth(n), `${textWeight(n)} ${size}px ${SCREEN.font}`).length;
  const shape = n.type === 'shape' ? n.shape : '';
  const need = (lines * size * TEXT.lineHeight + 22 + (n.type === 'sticky' ? STICKY_HEAD : 0)) * (shape === 'diamond' ? 1.7 : shape === 'cloud' ? 1.5 : shape === 'ellipse' ? 1.3 : 1);
  return Math.ceil(need / 10) * 10;
}

export const textSize = (n: Node): number =>
  n.type === 'sticky' ? (n.fontSize ?? TEXT.sticky) : n.type === 'text' ? (n.fontSize ?? TEXT.text) : n.type === 'shape' ? (n.fontSize ?? TEXT.shape) : n.type === 'frame' ? (n.fontSize ?? 13) : TEXT.shape;
/** Large free text is a heading, so it is set bold. */
export function textWeight(n: Node): number {
  if (n.type !== 'text' && n.type !== 'shape' && n.type !== 'sticky' && n.type !== 'frame') return 400;
  // Unless chosen by hand: area titles and large free text (headings) are bold, everything else regular.
  const usual = n.type === 'frame' || (n.type === 'text' && (n.fontSize ?? 0) >= 20);
  return (n.bold ?? usual) ? 700 : 400;
}
/** Height of the strip along the top of an area frame that holds its title. */
export const frameTitleHeight = (n: Node): number => textSize(n) + 19;

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
  underline?: boolean;
}

/** Wrapped text block centred vertically on y. */
export function TextBlock({ x, y, w, text, size, theme, weight = 400, fill = INK, anchor = 'middle', underline }: TextProps) {
  const lines = wrapText(text, w, `${weight} ${size}px ${theme.font}`);
  const lh = size * TEXT.lineHeight;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  return (
    <text fontFamily={theme.font} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} textDecoration={underline ? 'underline' : undefined}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} y={mid(y0 + i * lh, size)}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

/** A line is drawn in its colour; the signal type and theme are kept in the call for when looks differ. */
const signalStroke = (_signal: string, _theme: Theme, color: string): { stroke: string } => ({ stroke: color });

function Device({ n, theme, doc }: { n: DeviceNode; theme: Theme; doc?: Doc }) {
  const { w, h } = nodeSize(n);
  const { x, y } = n;
  const r = 7;
  // Colour-coded devices take the tint on their header and outline; gray is the plain look.
  const tint = n.color && n.color !== 'gray' ? PALETTE[n.color] : null;
  const line = (tint?.stroke ?? '#334155');
  const sw = 1.5;
  const sub = [n.maker, n.model].filter(Boolean).join(' ');
  const link = safeUrl(n.url);
  const top = deviceHead(n);
  // A name that runs to several lines pushes the maker / model line and the ports down.
  const extra = top - DEV.head;
  const head = `M${x},${y + top} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + top} Z`;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill="#fff" stroke={line} strokeWidth={sw} />
      <path d={head} fill={(tint?.fill ?? '#e8edf3')} stroke={line} strokeWidth={sw} />
      <TextBlock x={x + w / 2} y={y + (sub ? 16 : DEV.head / 2) + extra / 2} w={w - 12} text={n.text} size={DEVICE_NAME.size} weight={700} theme={theme} />
      {sub &&
        (link ? (
          // A real link in exported SVG / PDF. On the board, text never takes clicks, so the device still selects.
          <a href={link} target="_blank" rel="noopener noreferrer">
            <TextBlock x={x + w / 2} y={y + 33 + extra} w={w - 12} text={sub} size={9.5} fill="#2563eb" underline theme={theme} />
          </a>
        ) : (
          <TextBlock x={x + w / 2} y={y + 33 + extra} w={w - 12} text={sub} size={9.5} fill="#64748b" theme={theme} />
        ))}
      {doc && <LoadBadge doc={doc} n={n} theme={theme} />}
      <IpBadge n={n} doc={doc} />
      {n.ports.map((p) => {
        const pos = portPos(n, p.id)!;
        const left = p.side === 'left';
        const { stroke } = signalStroke(p.signal, theme, signalColor(doc, p.signal));
        return (
          <g key={p.id}>
            {(
              <circle cx={pos.x} cy={pos.y} r={4.5} fill={stroke} stroke="#fff" strokeWidth={1.5} />
            )}
            <text x={left ? pos.x + 9 : pos.x - 9} y={mid(pos.y, 10.5)} fontFamily={theme.font} fontSize={10.5} fill={'#334155'} textAnchor={left ? 'start' : 'end'}>
              {p.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

const IP_SIZE = 10.5;

/**
 * The device's address on a tag above its top-left corner, in the device's own colour, so the
 * network reads straight off the drawing: the IP in bold, the host name after it. An address
 * given to two devices, or one that cannot be an IPv4 address, shows as a red outline instead, so
 * it never passes for a device that is simply coloured red.
 */
function IpBadge({ n, doc }: { n: DeviceNode; doc?: Doc }) {
  const ip = n.ip?.trim();
  const host = n.host?.trim();
  if (!ip && !host) return null;
  const issue = doc ? ipIssues(doc).get(n.id) : undefined;
  const gap = ip && host ? IP_SIZE * 0.8 : 0;
  const bw = ipBadgeWidth(n);
  // Clear of the power tag: when both do not fit side by side, this one takes the row above.
  const by = n.y - 20 - (doc && tagsStacked(doc, n) ? 18 : 0);
  const solid = issue ? { fill: '#ffffff', text: '#dc2626' } : STRONG[n.color ?? 'gray'];
  return (
    <g>
      {issue && <title>{issue === 'dup' ? 'この IP アドレスはほかの機材と重複しています' : 'IPv4 アドレスとして読めません'}</title>}
      <rect x={n.x} y={by} width={bw} height={16} rx={4} fill={solid.fill} stroke={issue ? '#dc2626' : 'none'} strokeWidth={1.2} strokeDasharray={issue ? '3 2' : undefined} />
      <text x={n.x + 6} y={mid(by + 8, IP_SIZE)} fontFamily={MONO_FONT} fontSize={IP_SIZE} fill={solid.text}>
        {ip && <tspan fontWeight={700}>{ip}</tspan>}
        {/* SVG folds runs of spaces, so the gap before the host name is an offset. */}
        {host && (
          <tspan dx={gap || undefined} opacity={ip ? 0.8 : 1}>
            {host}
          </tspan>
        )}
      </text>
    </g>
  );
}

/** Load summary above a power source: how many devices it feeds and how many watts they draw. */
function loadBadgeText(doc: Doc, n: DeviceNode): string {
  const load = powerLoads(doc).get(n.id);
  if (!load) return '';
  const watts = load.capacity != null ? `${load.watts} / ${load.capacity}W` : load.watts ? `${load.watts}W` : '';
  return [`⚡ ${load.ids.length}台`, watts, load.over ? '容量超過' : ''].filter(Boolean).join(' · ');
}
const LOAD_SIZE = 10.5;
const loadBadgeWidth = (doc: Doc, n: DeviceNode): number => {
  const text = loadBadgeText(doc, n);
  return text ? measure(text, `600 ${LOAD_SIZE}px ${UI_FONT}`) + 12 : 0;
};

/** Width of a device's address tag; 0 when it has no address. */
function ipBadgeWidth(n: DeviceNode): number {
  const ip = n.ip?.trim();
  const host = n.host?.trim();
  if (!ip && !host) return 0;
  const gap = ip && host ? IP_SIZE * 0.8 : 0;
  return (ip ? measure(ip, `700 ${IP_SIZE}px ${MONO_FONT}`) : 0) + gap + (host ? measure(host, `400 ${IP_SIZE}px ${MONO_FONT}`) : 0) + 12;
}

/**
 * Whether a device's address tag and power tag are too wide to share the row above it. Then the
 * two stack, address on top, and both line up on the device's left edge instead of one on each
 * side, which would leave them staggered.
 */
function tagsStacked(doc: Doc, n: DeviceNode): boolean {
  const ip = ipBadgeWidth(n);
  const load = loadBadgeWidth(doc, n);
  return !!ip && !!load && ip + load + 4 > n.w;
}

function LoadBadge({ doc, n, theme }: { doc: Doc; n: DeviceNode; theme: Theme }) {
  const load = powerLoads(doc).get(n.id);
  if (!load) return null;
  const text = loadBadgeText(doc, n);
  const size = LOAD_SIZE;
  const bw = measure(text, `600 ${size}px ${theme.font}`) + 12;
  const bx = tagsStacked(doc, n) ? n.x : n.x + n.w - bw;
  const by = n.y - 20;
  const color = load.over ? '#dc2626' : '#b45309';
  return (
    <g>
      <rect x={bx} y={by} width={bw} height={16} rx={8} fill={load.over ? '#fee2e2' : '#fef3c7'} stroke={color} strokeWidth={0.8} />
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

function Sequence({ n, theme, doc }: { n: SequenceNode; theme: Theme; doc?: Doc }) {
  const d = parseSequence(n.text);
  // Everything scales with the text size, so a bigger text never outgrows its boxes.
  const k = seqScale(n.fontSize);
  const { col, step, w: dw, h: dh } = seqLayout(n.text, n.w, n.h, k);
  // Narrow columns take narrower boxes so neighbours never touch.
  const boxW = Math.min(SEQ.boxW * k, col - 12);
  const boxH = SEQ.boxH * k;
  const text = SEQ_TEXT * k;
  const line = '#334155';
  const sw = 1.3;
  const top = n.y + (SEQ.padTop + (d.title ? SEQ.titleH : 0)) * k;
  const cx = (i: number): number => n.x + SEQ.padX * k + i * col + col / 2;
  const lifeTop = top + boxH;
  const out: ReactNode[] = [
    <rect key="bg" x={n.x} y={n.y} width={dw} height={dh} rx={8} fill="#fff" stroke={'#cbd5e1'} strokeWidth={1} />,
  ];
  // Rows an open comment is pinned to are washed in the comments' yellow, under the drawing.
  if (doc) {
    const pinned = new Set(doc.nodes.flatMap((m) => (m.type === 'sticky' && !m.done && m.on?.seq === n.id && !m.on.lost ? [m.on.item] : [])));
    const bands = pinned.size ? seqBands(n) : [];
    pinned.forEach((i) => {
      const b = bands[i];
      if (b) out.push(<rect key={`pin${i}`} x={n.x + 4} y={b.y - b.h / 2} width={dw - 8} height={b.h} rx={4} fill="#fef3c7" fillOpacity={0.7} />);
    });
  }
  if (d.title) out.push(<TextBlock key="t" x={n.x + dw / 2} y={n.y + (SEQ.padTop + 8) * k} w={dw - 20} text={d.title} size={13 * k} weight={700} theme={theme} />);
  d.participants.forEach((p, i) => {
    out.push(
      <g key={`p${i}`}>
        <line x1={cx(i)} y1={lifeTop} x2={cx(i)} y2={n.y + dh - 12 * k} stroke={line} strokeWidth={sw * 0.75} strokeDasharray="4 4" />
        <rect x={cx(i) - boxW / 2} y={top} width={boxW} height={boxH} rx={5} fill={'#e8edf3'} stroke={line} strokeWidth={sw} />
        <TextBlock x={cx(i)} y={top + boxH / 2} w={boxW - 8} text={p.label} size={11.5 * k} weight={600} theme={theme} />
      </g>,
    );
  });
  const rows = seqRows(d);
  d.items.forEach((it, i) => {
    const y = lifeTop + rows.at[i] * step;
    if (it.kind === 'section') {
      // A block's start (loop, alt …) is a dashed rule with its label; its end a fainter one.
      const x0 = n.x + 8 * k;
      const x1 = n.x + dw - 8 * k;
      if (it.end) {
        out.push(<line key={`i${i}`} x1={x0} y1={y} x2={x1} y2={y} stroke={'#cbd5e1'} strokeWidth={1} strokeDasharray="2 3" />);
        return;
      }
      const tw = it.text ? measure(it.text, `600 ${text}px ${theme.font}`) + 12 * k : 0;
      out.push(
        <g key={`i${i}`}>
          <line x1={x0} y1={y} x2={x1} y2={y} stroke={'#94a3b8'} strokeWidth={1} strokeDasharray="6 3" />
          {it.text && (
            <>
              <rect x={x0} y={y - 9 * k} width={tw} height={18 * k} rx={3} fill={'#f1f5f9'} stroke={'#94a3b8'} strokeWidth={0.8} />
              <text x={x0 + 6 * k} y={mid(y, text)} fontFamily={theme.font} fontSize={text} fontWeight={600} fill={'#475569'}>
                {it.text}
              </text>
            </>
          )}
        </g>,
      );
      return;
    }
    if (it.kind === 'note') {
      // A note over two participants spans them both.
      const a = cx(it.over);
      const b = cx(it.to ?? it.over);
      const span = Math.abs(b - a);
      const lines = it.text.split('\n').length;
      const w = Math.max(Math.min(col - 12, measure(it.text, `${text}px ${theme.font}`) + 18 * k), span + col * 0.6 - 12);
      const h = Math.max(26 * k, lines * text * 1.4 + 10 * k);
      out.push(
        <g key={`i${i}`}>
          <rect x={(a + b) / 2 - w / 2} y={y - h / 2} width={w} height={h} fill={'#fef3c7'} stroke={'#eab308'} strokeWidth={1} />
          <TextBlock x={(a + b) / 2} y={y} w={w - 8} text={it.text} size={text} theme={theme} />
        </g>,
      );
      return;
    }
    const dash = it.dashed ? '5 3' : undefined;
    if (it.from === it.to) {
      const x = cx(it.from);
      const loop = 36 * k;
      const rise = 8 * k;
      out.push(
        <g key={`i${i}`}>
          <path d={`M${x},${y - rise} H${x + loop} V${y + rise} H${x}`} fill="none" stroke={line} strokeWidth={sw} strokeDasharray={dash} />
          <polygon points={arrowHead({ x, y: y + rise }, { x: x + loop, y: y + rise }, 8)} fill={line} />
          <text x={x + loop + 6 * k} y={mid(y, text)} fontFamily={theme.font} fontSize={text} fill={INK}>
            {it.text}
          </text>
        </g>,
      );
      return;
    }
    const a = { x: cx(it.from), y };
    const b = { x: cx(it.to), y };
    // A lost message ("-x") ends in a cross instead of an arrowhead.
    const c = 5 * k;
    const tip = b.x - Math.sign(b.x - a.x) * c;
    out.push(
      <g key={`i${i}`}>
        <line x1={a.x} y1={y} x2={b.x} y2={y} stroke={line} strokeWidth={sw} strokeDasharray={dash} />
        {it.cross ? <path d={`M${tip - c},${y - c} L${tip + c},${y + c} M${tip - c},${y + c} L${tip + c},${y - c}`} stroke={line} strokeWidth={sw * 1.2} /> : <polygon points={arrowHead(b, a, 8)} fill={line} />}
        <TextBlock x={(a.x + b.x) / 2} y={y - 10 * k} w={Math.abs(b.x - a.x) - 12} text={it.text} size={text} theme={theme} />
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
      return <Sequence n={n} theme={theme} doc={doc} />;
    case 'frame': {
      // A coloured area takes the tint as a light wash, with the outline and title in the full colour.
      const tint = n.color && n.color !== 'gray' ? { wash: PALETTE[n.color].fill, line: n.color === 'white' ? PALETTE.white.stroke : STRONG[n.color].fill } : null;
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={10}
            fill={(tint?.wash ?? 'rgba(100,116,139,0.06)')}
            fillOpacity={tint ? 0.45 : undefined}
            stroke={(tint?.line ?? '#94a3b8')}
            strokeWidth={tint ? 1.5 : 1.2}
            strokeDasharray={'6 5'}
          />
          <TextBlock x={x + 12} y={y + 11.5 + textSize(n) / 2} w={w - 24} text={n.text} size={textSize(n)} weight={textWeight(n)} fill={tint && n.color !== 'white' ? tint.line : '#475569'} anchor="start" theme={theme} />
        </g>
      );
    }
    case 'legend': {
      // A drawing sheet carries its own legend, by line type rather than colour.
      if (!doc) return null;
      const rows = shownRows(doc, n);
      const legendRows = doc.edges.some((e) => e.signal !== 'flow');
      const top = y + LEGEND.pad + (n.text.trim() ? LEGEND.title : 0);
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="#fff" stroke="#cbd5e1" strokeWidth={1.2} />
          {n.text.trim() && <TextBlock x={x + LEGEND.pad} y={y + LEGEND.pad + 7} w={w - LEGEND.pad * 2} text={n.text} size={11} weight={700} fill="#64748b" anchor="start" theme={theme} />}
          {rows.map((row, i) => {
            const cy = top + i * LEGEND.row + LEGEND.row / 2;
            return (
              <g key={row.color}>
                <line x1={x + LEGEND.pad} y1={cy} x2={x + LEGEND.pad + LEGEND.sample} y2={cy} stroke={row.color} strokeWidth={2.4} strokeLinecap="round" />
                <TextBlock x={x + LEGEND.pad + LEGEND.sample + 10} y={cy} w={w - LEGEND.pad * 2 - LEGEND.sample - 10} text={row.name} size={12} fill={INK} anchor="start" theme={theme} />
              </g>
            );
          })}
          {!rows.length && <TextBlock x={x + LEGEND.pad} y={top + LEGEND.row / 2} w={w - LEGEND.pad * 2} text={legendRows ? 'すべての行を隠しています' : '線を引くと、ここに色が並びます'} size={11} fill="#94a3b8" anchor="start" theme={theme} />}
        </g>
      );
    }
    case 'junction': {
      // The dot takes the colour of the lines it joins.
      const line = doc?.edges.find((e) => e.from.node === n.id || e.to.node === n.id);
      const ink = line && doc ? signalStroke(line.signal, theme, lineColor(doc, line)).stroke : '#64748b';
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="none" pointerEvents="all" />
          <circle cx={cx} cy={cy} r={4.5} fill={ink} />
        </g>
      );
    }
    case 'image':
      return <image href={assetUrl(doc?.id, n.src)} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity={n.under ? (n.opacity ?? 0.55) : undefined} pointerEvents={n.under ? 'none' : undefined} />;
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
      // A settled comment fades back, ticked.
      return (
        <g opacity={n.done ? 0.38 : undefined}>
          {(
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
          {/* Says what a sticky is for: a comment on the drawing. */}
          <text x={x + 9} y={y + 13} fontFamily={theme.font} fontSize={7} fontWeight={700} letterSpacing="0.1em" fill={mix(c.stroke, '#0f172a', 0.45)}>
            COMMENT
            {n.on?.lost && <tspan fill="#b91c1c">{'  対象の処理なし'}</tspan>}
          </text>
          <TextBlock x={cx} y={cy + STICKY_HEAD / 2} w={textWidth(n)} text={n.text} size={textSize(n)} weight={textWeight(n)} theme={theme} />
          {n.done && (
            <g transform={`translate(${x + w - 12},${y + 12})`}>
              <circle r={8} fill="#16a34a" />
              <path d="M-3.6,0.2 L-1,2.8 L3.8,-2.4" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
        </g>
      );
    }
    case 'shape': {
      const style = n.fill ?? 'tint';
      const strong = STRONG[n.color];
      const c =
        style === 'tint'
          ? PALETTE[n.color]
          : style === 'solid'
            ? { fill: strong.fill, stroke: strong.fill }
            : { fill: style === 'none' ? 'none' : '#fff', stroke: strong.fill };
      const ink = style === 'solid' ? strong.text : INK;
      const sw = 2;
      // A see-through shape must still be grabbable anywhere inside its outline.
      const paint = { fill: c.fill, stroke: c.stroke, strokeWidth: sw, strokeDasharray: n.dash ? '7 5' : undefined, pointerEvents: c.fill === 'none' ? ('all' as const) : undefined };
      let body: ReactNode;
      if (n.shape === 'diamond') {
        body = <polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} {...paint} strokeLinejoin="round" />;
      } else if (n.shape === 'cloud') {
        body = <path d={cloudPath(x, y, w, h)} {...paint} strokeLinejoin="round" />;
      } else if (n.shape === 'ellipse') {
        body = <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} {...paint} />;
      } else {
        const rx = n.shape === 'round' ? h / 2 : 4;
        body = <rect x={x} y={y} width={w} height={h} rx={rx} {...paint} />;
      }
      return (
        <g>
          {body}
          <TextBlock x={cx} y={cy} w={textWidth(n)} text={n.text} size={textSize(n)} weight={textWeight(n)} fill={ink} theme={theme} />
        </g>
      );
    }
  }
}

/** A line's label; may run over several lines when the user's own text does. */
export function edgeLabel(doc: Doc, e: Edge): string {
  // A protocol line names what it is and its port ("OSC 7000/udp"): its colour alone would not say.
  const sig = signalOf(e.signal);
  if (sig.protocol) return [[sig.id === 'data' ? '' : sig.prefix, e.spec].filter(Boolean).join(' '), e.label.trim()].filter(Boolean).join(labelStacked(doc, e) ? '\n' : ' · ');
  const id = idShown(doc, e) ? cableIds(doc).get(e.id) : undefined;
  const length = e.length != null && lengthShown(doc, e) ? `${e.length}m` : '';
  return [id, e.spec, e.label.trim(), length].filter(Boolean).join(labelStacked(doc, e) ? '\n' : ' · ');
}

/** Size of a (possibly multi-line) label box. */
function labelSize(label: string, size: number, font: string): { w: number; h: number; lines: string[] } {
  const lines = label.split('\n');
  return { lines, w: Math.max(...lines.map((l) => measure(l, `${size}px ${font}`))) + 10, h: size * 1.6 + (lines.length - 1) * size * 1.35 };
}

/** Box the label of a line occupies on the board — what you grab to slide it along the line. */
export function edgeLabelBox(doc: Doc, e: Edge, theme: Theme): Rect | null {
  const pts = routeEdges(doc).get(e.id);
  const label = edgeLabel(doc, e);
  if (!pts || pts.length < 2 || !label || isTagged(doc, e)) return null;
  const size = e.signal === 'flow' ? 12 : 10.5;
  const { w, h } = labelSize(label, size, theme.font);
  const at = labelPoint(pts, e.labelAt);
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

/** Nearest point along the route that differs from pts[i] — hand-placed bends can coincide. */
function distinct(pts: Pt[], i: number, step: 1 | -1): Pt {
  for (let j = i + step; j >= 0 && j < pts.length; j += step) {
    if (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) > 0.5) return pts[j];
  }
  return { x: pts[i].x - step, y: pts[i].y };
}

/** The crossings on one run that get a hop: those clear of the rounded corners at both ends. */
const hopsOn = (xs: number[] | undefined, a: Pt, b: Pt, radius: number, r: number): number[] =>
  (xs ?? []).filter((x) => Math.abs(x - a.x) > radius + r && Math.abs(x - b.x) > radius + r);

/** Rounded-corner path, like `pathD`, with a small hop wherever another line crosses underneath. */
function hopRound(pts: Pt[], hops: Map<number, number[]> | undefined, radius: number, r: number): string {
  if (!hops?.size || pts.length < 2) return pathD(pts, radius);
  let d = `M${pts[0].x},${pts[0].y}`;
  let from = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const p = pts[i];
    const b = pts[i + 1];
    // Where this run stops: at the start of the rounded corner, or at the very end of the line.
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = b ? Math.hypot(b.x - p.x, b.y - p.y) : 0;
    const cut = b ? Math.min(radius, la / 2, lb / 2) : 0;
    const to = cut >= 1 ? { x: p.x + ((a.x - p.x) / la) * cut, y: p.y + ((a.y - p.y) / la) * cut } : p;
    const dir = to.x > from.x ? 1 : -1;
    for (const x of hopsOn(hops.get(i - 1), a, p, radius, r).sort((u, v) => (u - v) * dir)) {
      d += ` L${x - dir * r},${a.y} A${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${x + dir * r},${a.y}`;
    }
    d += ` L${to.x},${to.y}`;
    from = to;
    if (cut >= 1) {
      from = { x: p.x + ((b.x - p.x) / lb) * cut, y: p.y + ((b.y - p.y) / lb) * cut };
      d += ` Q${p.x},${p.y} ${from.x},${from.y}`;
    }
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
  const name = (id: string): string => doc.nodes.find((n) => n.id === id)?.text.replace(/\s*\n\s*/g, ' ') || id;
  const id = idShown(doc, e) ? cableIds(doc).get(e.id) : undefined;
  const length = e.length != null && lengthShown(doc, e) ? ` ${e.length}m` : '';
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
    make(end, before, `${power ? '⚡' : '←'} ${name(e.from.node)}${e.label.trim() ? ` · ${e.label.trim().replace(/\n/g, ' ')}` : ''}`),
  ];
}

function TaggedEdge({ doc, e, theme }: { doc: Doc; e: Edge; theme: Theme }) {
  const { stroke } = signalStroke(e.signal, theme, lineColor(doc, e));
  const ink = stroke;
  const width = 1.5;
  return (
    <g>
      {edgeTags(doc, e, theme).map((t, i) => (
        <g key={i}>
          <line x1={t.from.x} y1={t.from.y} x2={t.to.x} y2={t.to.y} stroke={ink} strokeWidth={width} />
          <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={3} fill={mix(stroke, '#ffffff', 0.84)} stroke={ink} strokeWidth={1} />
          <text x={t.x + t.w / 2} y={mid(t.y + t.h / 2, 10)} fontFamily={theme.font} fontSize={10} fill={mix(stroke, '#0f172a', 0.5)} textAnchor="middle">
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
  // A line running into a junction carries on from there: no arrowhead at the dot.
  const intoJunction = doc.nodes.find((n) => n.id === e.to.node)?.type === 'junction';
  const signal = signalStroke(e.signal, theme, lineColor(doc, e));
  const stroke = signal.stroke;
  const dash = e.dash ? '7 6' : undefined;
  const label = hideLabel ? '' : edgeLabel(doc, e);
  const at = labelPoint(pts, e.labelAt);
  const size = flow ? 12 : 10.5;
  const box = labelSize(label, size, theme.font);
  const n = pts.length;
  const width = flow ? 2.4 : 1.8;
  const d = doc.hops ? hopRound(pts, crossings(doc).get(e.id), 8, 5) : pathD(pts, 8);
  const head = flow ? 11 : 9;
  // At a device port the arrowhead stops at the port marker instead of hiding underneath it.
  const tip = (i: number, step: 1 | -1, atPort: boolean): Pt => {
    const back = atPort ? (6) : 0;
    const q = distinct(pts, i, step);
    const len = Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
    return back && len > back + head ? { x: pts[i].x + ((q.x - pts[i].x) / len) * back, y: pts[i].y + ((q.y - pts[i].y) / len) * back } : pts[i];
  };
  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap={flow ? 'round' : undefined} />
      {e.arrow !== 'none' && !intoJunction && <polygon points={arrowHead(tip(n - 1, -1, !!e.to.port), distinct(pts, n - 1, -1), head)} fill={stroke} />}
      {e.arrow === 'both' && <polygon points={arrowHead(tip(0, 1, !!e.from.port), distinct(pts, 0, 1), head)} fill={stroke} />}
      {label && (
        <g>
          <rect
            x={at.x - box.w / 2}
            y={at.y - box.h / 2}
            width={box.w}
            height={box.h}
            rx={4}
            // On the board the label is a chip in a wash of the line's colour, with darker lettering:
            // it reads as part of that line, and stays legible where coloured text on white did not.
            fill={mix(stroke, '#ffffff', 0.84)}
            stroke={mix(stroke, '#ffffff', 0.45)}
            strokeWidth={0.8}
          />
          <text fontFamily={theme.font} fontSize={size} fill={mix(stroke, '#0f172a', 0.5)} textAnchor="middle">
            {box.lines.map((l, i) => (
              <tspan key={i} x={at.x} y={mid(at.y + (i - (box.lines.length - 1) / 2) * size * 1.35, size)}>
                {l}
              </tspan>
            ))}
          </text>
        </g>
      )}
    </g>
  );
}

/** The whole board: frames, then cables, then everything else. */
/**
 * The hops alone, painted after every line: wherever a line hops over another its little arch
 * ends up in front, even when two lines hop over each other and no painting order could do it.
 */
export function HopCaps({ doc, theme }: { doc: Doc; theme: Theme }) {
  if (!doc.hops) return null;
  const routes = routeEdges(doc);
  return (
    <g pointerEvents="none">
      {doc.edges.map((e) => {
        const hops = crossings(doc).get(e.id);
        const pts = routes.get(e.id);
        if (!hops || !pts || isTagged(doc, e)) return null;
        const r = 5;
        const d = [...hops].flatMap(([i, xs]) => hopsOn(xs, pts[i], pts[i + 1], 8, r).map((x) => `M${x - r},${pts[i].y} A${r},${r} 0 0 1 ${x + r},${pts[i].y}`)).join(' ');
        const flow = e.signal === 'flow';
        return d && <path key={e.id} d={d} fill="none" stroke={signalStroke(e.signal, theme, lineColor(doc, e)).stroke} strokeWidth={flow ? 2.4 : 1.8} strokeLinecap="round" />;
      })}
    </g>
  );
}

export function DocView({ doc, theme }: { doc: Doc; theme: Theme }) {
  return (
    <g>
      {doc.nodes.filter(isUnderlay).map((n) => <NodeView key={n.id} n={n} theme={theme} doc={doc} />)}
      {doc.nodes.filter((n) => n.type === 'frame').map((n) => <NodeView key={n.id} n={n} theme={theme} />)}
      {(doc.hops ? hopOrder(doc) : doc.edges).map((e) => <EdgeView key={e.id} doc={doc} e={e} theme={theme} />)}
      <HopCaps doc={doc} theme={theme} />
      {doc.nodes
        .filter((n) => n.type !== 'frame' && !isUnderlay(n))
        .map((n) => (
          <NodeView key={n.id} n={n} theme={theme} doc={doc} />
        ))}
    </g>
  );
}
