import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAD_FONT, DocView, type Theme } from '../canvas/render';
import { docBounds } from '../model/geometry';
import { type Table, cableTable, equipmentTable } from '../model/lists';
import { signalOf } from '../model/signals';
import { measure } from '../model/text';
import type { Doc } from '../model/types';

export type Paper = 'A3' | 'A4';
export interface CadOptions {
  paper: Paper;
  /** Keep signal colours (dash patterns are drawn either way). */
  color: boolean;
  /** Append equipment / cable schedule sheets. */
  tables: boolean;
}
export interface Sheet {
  svg: string;
  /** Sheet size in mm. */
  w: number;
  h: number;
}

const SIZE: Record<Paper, { w: number; h: number; cols: number; rows: number; title: number }> = {
  A3: { w: 420, h: 297, cols: 8, rows: 6, title: 170 },
  A4: { w: 297, h: 210, cols: 6, rows: 4, title: 140 },
};
const M = 10; // border margin
const PX = 25.4 / 96; // mm per CSS px
const TITLE_H = 30;
const THIN = 0.18;
const BOLD = 0.5;

function fit(text: string, width: number, size: number): string {
  const w = (s: string): number => measure(s, `${size * 10}px ${CAD_FONT}`) / 10;
  if (w(text) <= width) return text;
  let s = text;
  while (s.length > 1 && w(`${s}…`) > width) s = s.slice(0, -1);
  return `${s}…`;
}

function T({ x, y, size, children, anchor = 'start', bold }: { x: number; y: number; size: number; children: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean }) {
  return (
    <text x={x} y={y} fontSize={size} fontFamily={CAD_FONT} fontWeight={bold ? 700 : 400} textAnchor={anchor} dominantBaseline="central" fill="#000">
      {children}
    </text>
  );
}

/** Labelled cell of the title block. */
function Cell({ x, y, w, h, label, value, size = 3.2 }: { x: number; y: number; w: number; h: number; label: string; value: string; size?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#000" strokeWidth={THIN} />
      <T x={x + 1.2} y={y + 2.1} size={1.9}>{label}</T>
      <T x={x + w / 2} y={y + h / 2 + 1.2} size={size} anchor="middle" bold={size > 3.5}>{fit(value, w - 3, size)}</T>
    </g>
  );
}

function Frame({ doc, paper, name, page, pages }: { doc: Doc; paper: Paper; name: string; page: number; pages: number }) {
  const { w, h, cols, rows, title } = SIZE[paper];
  const marks: ReactNode[] = [];
  for (let i = 0; i < cols; i++) {
    const x0 = M + ((w - 2 * M) / cols) * i;
    const cx = x0 + (w - 2 * M) / cols / 2;
    if (i) marks.push(<path key={`c${i}`} d={`M${x0},${M - 4} V${M} M${x0},${h - M} V${h - M + 4}`} stroke="#000" strokeWidth={THIN} />);
    marks.push(<T key={`ct${i}`} x={cx} y={M - 2.4} size={2.4} anchor="middle">{String(i + 1)}</T>);
    marks.push(<T key={`cb${i}`} x={cx} y={h - M + 2.4} size={2.4} anchor="middle">{String(i + 1)}</T>);
  }
  for (let i = 0; i < rows; i++) {
    const y0 = M + ((h - 2 * M) / rows) * i;
    const cy = y0 + (h - 2 * M) / rows / 2;
    const ch = String.fromCharCode(65 + i);
    if (i) marks.push(<path key={`r${i}`} d={`M${M - 4},${y0} H${M} M${w - M},${y0} H${w - M + 4}`} stroke="#000" strokeWidth={THIN} />);
    marks.push(<T key={`rl${i}`} x={M - 2.4} y={cy} size={2.4} anchor="middle">{ch}</T>);
    marks.push(<T key={`rr${i}`} x={w - M + 2.4} y={cy} size={2.4} anchor="middle">{ch}</T>);
  }
  const x = w - M - title;
  const y = h - M - TITLE_H;
  const c = title / 12; // title block column unit
  const date = new Date().toISOString().slice(0, 10);
  const m = doc.meta;
  return (
    <g>
      <rect x={M - 4} y={M - 4} width={w - 2 * M + 8} height={h - 2 * M + 8} fill="none" stroke="#000" strokeWidth={THIN} />
      <rect x={M} y={M} width={w - 2 * M} height={h - 2 * M} fill="none" stroke="#000" strokeWidth={BOLD} />
      {marks}
      <rect x={x} y={y} width={title} height={TITLE_H} fill="#fff" stroke="#000" strokeWidth={BOLD} />
      <Cell x={x} y={y} w={c * 8} h={8} label="案件名 PROJECT" value={m.project} />
      <Cell x={x + c * 8} y={y} w={c * 4} h={8} label="会社 COMPANY" value={m.company} size={2.8} />
      <Cell x={x} y={y + 8} w={c * 8} h={14} label="図面名称 TITLE" value={name} size={4.6} />
      <Cell x={x + c * 8} y={y + 8} w={c * 4} h={7} label="図番 DWG NO." value={m.drawingNo} size={2.8} />
      <Cell x={x + c * 8} y={y + 15} w={c * 2} h={7} label="REV" value={m.rev} size={2.8} />
      <Cell x={x + c * 10} y={y + 15} w={c * 2} h={7} label="SHEET" value={`${page}/${pages}`} size={2.8} />
      <Cell x={x} y={y + 22} w={c * 4} h={8} label="作成 DRAWN" value={m.author} size={2.8} />
      <Cell x={x + c * 4} y={y + 22} w={c * 4} h={8} label="日付 DATE" value={date} size={2.8} />
      <Cell x={x + c * 8} y={y + 22} w={c * 2} h={8} label="縮尺 SCALE" value="NTS" size={2.8} />
      <Cell x={x + c * 10} y={y + 22} w={c * 2} h={8} label="用紙 SIZE" value={paper} size={2.8} />
    </g>
  );
}

function Legend({ doc, x, bottom, color }: { doc: Doc; x: number; bottom: number; color: boolean }) {
  const counts = new Map<string, number>();
  for (const e of doc.edges) if (e.signal !== 'flow') counts.set(e.signal, (counts.get(e.signal) ?? 0) + 1);
  const used = [...counts.keys()];
  if (!used.length) return null;
  const perCol = 5;
  const colW = 52;
  const cols = Math.ceil(used.length / perCol);
  const rows = Math.min(perCol, used.length);
  const h = 6 + rows * 4.6;
  const y = bottom - h;
  return (
    <g>
      <rect x={x} y={y} width={cols * colW} height={h} fill="#fff" stroke="#000" strokeWidth={THIN} />
      <T x={x + 1.5} y={y + 2.8} size={2.4} bold>凡例 LEGEND</T>
      {used.map((id, i) => {
        const s = signalOf(id);
        const lx = x + Math.floor(i / perCol) * colW + 2;
        const ly = y + 7.5 + (i % perCol) * 4.6;
        // Dash patterns are authored in px; scale them to the legend's mm space.
        const dash = s.dash ? s.dash.split(' ').map((v) => Number(v) * PX).join(' ') : undefined;
        return (
          <g key={id}>
            <line x1={lx} y1={ly} x2={lx + 16} y2={ly} stroke={color ? s.color : '#000'} strokeWidth={0.35} strokeDasharray={dash} />
            <T x={lx + 18} y={ly} size={2.5}>{`${s.label}${s.cable ? `  (${s.prefix}-)` : ''}  ×${counts.get(id)}`}</T>
          </g>
        );
      })}
    </g>
  );
}

function wrapSheet(paper: Paper, body: ReactNode): Sheet {
  const { w, h } = SIZE[paper];
  const svg = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={`${w}mm`} height={`${h}mm`} viewBox={`0 0 ${w} ${h}`}>
      <rect width={w} height={h} fill="#fff" />
      {body}
    </svg>,
  );
  return { svg, w, h };
}

function tablePages(paper: Paper, t: Table): ReactNode[] {
  const { w, h } = SIZE[paper];
  const x0 = M + 6;
  const y0 = M + 14;
  const width = w - 2 * M - 12;
  const rowH = 6;
  const perPage = Math.max(1, Math.floor((h - M - TITLE_H - 6 - y0 - rowH) / rowH));
  const total = t.widths.reduce((a, b) => a + b, 0);
  const xs: number[] = [];
  let acc = x0;
  for (const cw of t.widths) {
    xs.push(acc);
    acc += (cw / total) * width;
  }
  xs.push(x0 + width);
  const pages: ReactNode[] = [];
  for (let start = 0; start < Math.max(1, t.rows.length); start += perPage) {
    const rows = t.rows.slice(start, start + perPage);
    const bottom = y0 + (rows.length + 1) * rowH;
    pages.push(
      <g key={start}>
        <T x={x0} y={M + 8} size={4.2} bold>{t.title}</T>
        <rect x={x0} y={y0} width={width} height={rowH} fill="#e5e5e5" />
        <rect x={x0} y={y0} width={width} height={bottom - y0} fill="none" stroke="#000" strokeWidth={0.35} />
        {xs.slice(1, -1).map((x) => <line key={x} x1={x} y1={y0} x2={x} y2={bottom} stroke="#000" strokeWidth={THIN} />)}
        {t.head.map((s, i) => <T key={i} x={xs[i] + 1.5} y={y0 + rowH / 2} size={2.7} bold>{s}</T>)}
        {rows.map((row, r) => {
          const y = y0 + (r + 1) * rowH;
          return (
            <g key={r}>
              <line x1={x0} y1={y} x2={x0 + width} y2={y} stroke="#000" strokeWidth={THIN} />
              {row.map((s, i) => <T key={i} x={xs[i] + 1.5} y={y + rowH / 2} size={2.7}>{fit(s, xs[i + 1] - xs[i] - 3, 2.7)}</T>)}
            </g>
          );
        })}
      </g>,
    );
  }
  return pages;
}

/** Drawing sheets: the system diagram in a title-blocked frame, then the schedules. */
export function cadSheets(doc: Doc, opts: CadOptions): Sheet[] {
  const { paper } = opts;
  const { w, h } = SIZE[paper];
  const theme: Theme = { mono: true, color: opts.color, font: CAD_FONT };
  const bodies: { name: string; body: ReactNode }[] = [];

  const box = docBounds(doc) ?? { x: 0, y: 0, w: 100, h: 100 };
  const area = { x: M + 8, y: M + 8, w: w - 2 * M - 16, h: h - 2 * M - TITLE_H - 16 };
  const s = Math.min(area.w / (box.w * PX), area.h / (box.h * PX), 1) * PX;
  const tx = area.x + (area.w - box.w * s) / 2 - box.x * s;
  const ty = area.y + (area.h - box.h * s) / 2 - box.y * s;
  bodies.push({
    name: doc.meta.title,
    body: (
      <>
        <g transform={`translate(${tx},${ty}) scale(${s})`}>
          <DocView doc={doc} theme={theme} />
        </g>
        <Legend doc={doc} x={M + 3} bottom={h - M - 3} color={opts.color} />
      </>
    ),
  });

  if (opts.tables) {
    for (const t of [equipmentTable(doc), cableTable(doc)]) {
      if (!t.rows.length) continue;
      for (const body of tablePages(paper, t)) bodies.push({ name: `${doc.meta.title}　${t.title}`, body });
    }
  }

  return bodies.map((b, i) =>
    wrapSheet(
      paper,
      <>
        {b.body}
        <Frame doc={doc} paper={paper} name={b.name} page={i + 1} pages={bodies.length} />
      </>,
    ),
  );
}
