import type { ReactNode } from 'react';
import { DEV, labelPoint, nodeSize, pathD, portPos, routeEdges } from '../model/geometry';
import { cableIds } from '../model/lists';
import { SEQ, parseSequence } from '../model/sequence';
import { PALETTE, signalOf } from '../model/signals';
import { measure, wrapText } from '../model/text';
import type { DeviceNode, Doc, Edge, Node, Pt, SequenceNode } from '../model/types';

/** `mono` draws the CAD-style sheet look: black lines, dash patterns instead of colours. */
export interface Theme {
  mono: boolean;
  /** Keep signal colours on the CAD look. */
  color: boolean;
  font: string;
}
export const SCREEN: Theme = {
  mono: false,
  color: true,
  font: '-apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif',
};
export const CAD_FONT = '"Osaka-Mono", "MS Gothic", "Noto Sans Mono CJK JP", "Hiragino Sans", monospace';

const INK = '#1e293b';

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
  /** 'middle' centres the block on y; 'top' starts it at y. */
  valign?: 'middle' | 'top';
}

export function TextBlock({ x, y, w, text, size, theme, weight = 400, fill = INK, anchor = 'middle', valign = 'middle' }: TextProps) {
  const lines = wrapText(text, w, `${weight} ${size}px ${theme.font}`);
  const lh = size * 1.35;
  const y0 = valign === 'middle' ? y - ((lines.length - 1) * lh) / 2 : y + lh / 2;
  return (
    <text fontFamily={theme.font} fontSize={size} fontWeight={weight} fill={theme.mono ? '#000' : fill} textAnchor={anchor} dominantBaseline="central">
      {lines.map((l, i) => (
        <tspan key={i} x={x} y={y0 + i * lh}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

function signalStroke(signal: string, theme: Theme): { stroke: string; dash?: string } {
  const s = signalOf(signal);
  if (!theme.mono) return { stroke: s.color };
  return { stroke: theme.color ? s.color : '#000', dash: s.dash || undefined };
}

function Device({ n, theme }: { n: DeviceNode; theme: Theme }) {
  const { w, h } = nodeSize(n);
  const { x, y } = n;
  const r = theme.mono ? 0 : 7;
  const sub = [n.maker, n.model].filter(Boolean).join(' ');
  const head = `M${x},${y + DEV.head} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + DEV.head} Z`;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill="#fff" stroke={theme.mono ? '#000' : '#334155'} strokeWidth={theme.mono ? 1.4 : 1.5} />
      <path d={head} fill={theme.mono ? '#fff' : '#e8edf3'} stroke={theme.mono ? '#000' : '#334155'} strokeWidth={theme.mono ? 1.4 : 1.5} />
      <TextBlock x={x + w / 2} y={y + (sub ? 16 : DEV.head / 2)} w={w - 12} text={n.text.split('\n')[0]} size={13} weight={700} theme={theme} />
      {sub && <TextBlock x={x + w / 2} y={y + 33} w={w - 12} text={sub} size={9.5} fill="#64748b" theme={theme} />}
      {n.ports.map((p) => {
        const pos = portPos(n, p.id)!;
        const left = p.side === 'left';
        const { stroke } = signalStroke(p.signal, theme);
        return (
          <g key={p.id}>
            {theme.mono ? (
              <rect x={pos.x - 3} y={pos.y - 3} width={6} height={6} fill="#fff" stroke={stroke} strokeWidth={1.1} />
            ) : (
              <circle cx={pos.x} cy={pos.y} r={4.5} fill={stroke} stroke="#fff" strokeWidth={1.5} />
            )}
            <text
              x={left ? pos.x + 9 : pos.x - 9}
              y={pos.y}
              fontFamily={theme.font}
              fontSize={10.5}
              fill={theme.mono ? '#000' : '#334155'}
              textAnchor={left ? 'start' : 'end'}
              dominantBaseline="central"
            >
              {p.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function arrowHead(tip: Pt, from: Pt, size: number): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const p = (da: number): string => `${tip.x - size * Math.cos(a + da)},${tip.y - size * Math.sin(a + da)}`;
  return `${tip.x},${tip.y} ${p(0.42)} ${p(-0.42)}`;
}

function Sequence({ n, theme }: { n: SequenceNode; theme: Theme }) {
  const d = parseSequence(n.text);
  const line = theme.mono ? '#000' : '#334155';
  const top = n.y + SEQ.padTop + (d.title ? SEQ.titleH : 0);
  const cx = (i: number): number => n.x + SEQ.padX + i * SEQ.col + SEQ.col / 2;
  const lifeTop = top + SEQ.boxH;
  const out: ReactNode[] = [
    <rect key="bg" x={n.x} y={n.y} width={d.w} height={d.h} rx={theme.mono ? 0 : 8} fill="#fff" stroke={theme.mono ? '#000' : '#cbd5e1'} strokeWidth={1} />,
  ];
  if (d.title) out.push(<TextBlock key="t" x={n.x + d.w / 2} y={n.y + SEQ.padTop + 8} w={d.w - 20} text={d.title} size={13} weight={700} theme={theme} />);
  d.participants.forEach((p, i) => {
    out.push(
      <g key={`p${i}`}>
        <line x1={cx(i)} y1={lifeTop} x2={cx(i)} y2={n.y + d.h - 12} stroke={line} strokeWidth={1} strokeDasharray="4 4" />
        <rect x={cx(i) - SEQ.boxW / 2} y={top} width={SEQ.boxW} height={SEQ.boxH} rx={theme.mono ? 0 : 5} fill={theme.mono ? '#fff' : '#e8edf3'} stroke={line} strokeWidth={1.3} />
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
          <rect x={cx(it.over) - w / 2} y={y - 13} width={w} height={26} fill={theme.mono ? '#fff' : '#fef3c7'} stroke={theme.mono ? '#000' : '#eab308'} strokeWidth={1} />
          <TextBlock x={cx(it.over)} y={y} w={w - 8} text={it.text} size={11} theme={theme} />
        </g>,
      );
      return;
    }
    const dash = it.dashed ? '5 3' : undefined;
    if (it.from === it.to) {
      const x = cx(it.from);
      const tip = { x, y: y + 8 };
      out.push(
        <g key={`i${i}`}>
          <path d={`M${x},${y - 8} H${x + 36} V${y + 8} H${x}`} fill="none" stroke={line} strokeWidth={1.3} strokeDasharray={dash} />
          <polygon points={arrowHead(tip, { x: x + 36, y: y + 8 }, 8)} fill={line} />
          <text x={x + 42} y={y} fontFamily={theme.font} fontSize={11} fill={theme.mono ? '#000' : INK} dominantBaseline="central">
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
        <line x1={a.x} y1={y} x2={b.x} y2={y} stroke={line} strokeWidth={1.3} strokeDasharray={dash} />
        <polygon points={arrowHead(b, a, 8)} fill={line} />
        <TextBlock x={(a.x + b.x) / 2} y={y - 10} w={Math.abs(b.x - a.x) - 12} text={it.text} size={11} theme={theme} />
      </g>,
    );
  });
  return <g>{out}</g>;
}

export function NodeView({ n, theme }: { n: Node; theme: Theme }) {
  const { x, y } = n;
  const { w, h } = nodeSize(n);
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (n.type) {
    case 'device':
      return <Device n={n} theme={theme} />;
    case 'sequence':
      return <Sequence n={n} theme={theme} />;
    case 'frame':
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={theme.mono ? 0 : 10}
            fill={theme.mono ? 'none' : 'rgba(100,116,139,0.06)'}
            stroke={theme.mono ? '#000' : '#94a3b8'}
            strokeWidth={theme.mono ? 0.9 : 1.2}
            strokeDasharray={theme.mono ? '12 4 2 4' : '6 5'}
          />
          <TextBlock x={x + 12} y={y + 18} w={w - 24} text={n.text} size={13} weight={700} fill="#475569" anchor="start" theme={theme} />
        </g>
      );
    case 'text':
      return <TextBlock x={cx} y={cy} w={w} text={n.text} size={14} theme={theme} />;
    case 'sticky': {
      const c = PALETTE[n.color];
      const fold = 14;
      return (
        <g>
          {theme.mono ? (
            <path d={`M${x},${y} H${x + w - fold} L${x + w},${y + fold} V${y + h} H${x} Z M${x + w - fold},${y} V${y + fold} H${x + w}`} fill="#fff" stroke="#000" strokeWidth={0.9} />
          ) : (
            <>
              <rect x={x + 1.5} y={y + 3} width={w} height={h} rx={3} fill="rgba(15,23,42,0.12)" />
              <rect x={x} y={y} width={w} height={h} rx={3} fill={c.fill} stroke={c.stroke} strokeWidth={0.8} />
            </>
          )}
          <TextBlock x={cx} y={cy} w={w - 20} text={n.text} size={13} theme={theme} />
        </g>
      );
    }
    case 'shape': {
      const c = theme.mono ? { fill: '#fff', stroke: '#000' } : PALETTE[n.color];
      const sw = theme.mono ? 1.2 : 1.5;
      let body: ReactNode;
      let tw = w - 16;
      if (n.shape === 'diamond') {
        body = <polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} fill={c.fill} stroke={c.stroke} strokeWidth={sw} />;
        tw = w * 0.6;
      } else if (n.shape === 'ellipse') {
        body = <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={c.fill} stroke={c.stroke} strokeWidth={sw} />;
        tw = w * 0.72;
      } else {
        const rx = n.shape === 'round' ? h / 2 : theme.mono ? 0 : 7;
        body = <rect x={x} y={y} width={w} height={h} rx={rx} fill={c.fill} stroke={c.stroke} strokeWidth={sw} />;
      }
      return (
        <g>
          {body}
          <TextBlock x={cx} y={cy} w={tw} text={n.text} size={13.5} theme={theme} />
        </g>
      );
    }
  }
}

export function edgeLabel(doc: Doc, e: Edge): string {
  const id = cableIds(doc).get(e.id);
  return [id, e.label, e.length != null ? `${e.length}m` : ''].filter(Boolean).join(' · ');
}

export function EdgeView({ doc, e, theme }: { doc: Doc; e: Edge; theme: Theme }) {
  const pts = routeEdges(doc).get(e.id);
  if (!pts || pts.length < 2) return null;
  const { stroke, dash } = signalStroke(e.signal, theme);
  const label = edgeLabel(doc, e);
  const at = labelPoint(pts);
  const size = 10.5;
  const lw = label ? measure(label, `${size}px ${theme.font}`) + 10 : 0;
  const n = pts.length;
  return (
    <g>
      <path d={pathD(pts, theme.mono ? 0 : 7)} fill="none" stroke={stroke} strokeWidth={theme.mono ? 1.1 : 1.8} strokeDasharray={dash} strokeLinejoin="round" />
      {e.arrow !== 'none' && <polygon points={arrowHead(pts[n - 1], pts[n - 2], 9)} fill={stroke} />}
      {e.arrow === 'both' && <polygon points={arrowHead(pts[0], pts[1], 9)} fill={stroke} />}
      {label && (
        <g>
          <rect x={at.x - lw / 2} y={at.y - 8} width={lw} height={16} rx={theme.mono ? 0 : 4} fill="#fff" stroke={theme.mono ? stroke : 'none'} strokeWidth={0.6} opacity={theme.mono ? 1 : 0.92} />
          <text x={at.x} y={at.y} fontFamily={theme.font} fontSize={size} fill={theme.mono && !theme.color ? '#000' : stroke} textAnchor="middle" dominantBaseline="central">
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
      {doc.nodes.filter((n) => n.type !== 'frame').map((n) => <NodeView key={n.id} n={n} theme={theme} />)}
    </g>
  );
}
