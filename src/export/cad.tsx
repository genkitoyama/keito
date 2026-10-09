import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAD_FONT, DocView, type Theme, mid } from '../canvas/render';
import { docBounds } from '../model/geometry';
import { type Table, cableTable, equipmentTable } from '../model/lists';
import { signalColor } from '../model/lineColor';
import { signalOf } from '../model/signals';
import { measure } from '../model/text';
import type { Doc } from '../model/types';

/**
 * Drawing sheets laid out after JIS Z 8311 (sheet sizes and layout — same as
 * ISO 5457): 20 mm filing margin on the left and 10 mm elsewhere, a 0.5 mm
 * frame, centring marks, a grid reference system, a metric reference
 * graduation and a title block in the bottom-right corner no wider than
 * 170 mm. Line widths follow JIS Z 8312 (0.18 / 0.25 / 0.35 / 0.5) and
 * lettering JIS Z 8313 (2.5 / 3.5 / 5 mm).
 */
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
export interface CadResult {
  sheets: Sheet[];
  /** Height in mm of the smallest lettering in the diagram once fitted to the sheet. */
  textMm: number;
}

const SIZE: Record<Paper, { w: number; h: number; cols: number; rows: number; title: number; rev: number }> = {
  A3: { w: 420, h: 297, cols: 8, rows: 6, title: 170, rev: 80 },
  A4: { w: 297, h: 210, cols: 6, rows: 4, title: 150, rev: 56 },
};
const M = 10; // top / right / bottom margin
const ML = 20; // left filing margin
const PX = 25.4 / 96; // mm per CSS px
const STRIP = 42; // title block height
const LINE = { fine: 0.18, thin: 0.25, mid: 0.35, thick: 0.5 };
const LETTER = { small: 2.5, normal: 3.5, large: 5 };

function fit(text: string, width: number, size: number): string {
  const w = (s: string): number => measure(s, `${size * 10}px ${CAD_FONT}`) / 10;
  if (w(text) <= width) return text;
  let s = text;
  while (s.length > 1 && w(`${s}…`) > width) s = s.slice(0, -1);
  return `${s}…`;
}

function T({ x, y, size, children, anchor = 'start', bold }: { x: number; y: number; size: number; children: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean }) {
  return (
    <text x={x} y={mid(y, size)} fontSize={size} fontFamily={CAD_FONT} fontWeight={bold ? 700 : 400} textAnchor={anchor} fill="#000">
      {children}
    </text>
  );
}

/** Title block cell: small caption in the top-left corner, value centred below it. */
function Cell({ x, y, w, h, label, value, size = LETTER.normal }: { x: number; y: number; w: number; h: number; label: string; value: string; size?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#000" strokeWidth={LINE.thin} />
      <T x={x + 1} y={y + 2} size={LETTER.small}>{label}</T>
      <T x={x + w / 2} y={y + h / 2 + 1.2} size={size} anchor="middle" bold={size > LETTER.normal}>{fit(value, w - 3, size)}</T>
    </g>
  );
}

/** Signature box (承認 / 検図 …): caption strip on top, room for a stamp below. */
function Stamp({ x, y, w, h, label, value = '' }: { x: number; y: number; w: number; h: number; label: string; value?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#000" strokeWidth={LINE.thin} />
      <line x1={x} y1={y + 4.5} x2={x + w} y2={y + 4.5} stroke="#000" strokeWidth={LINE.fine} />
      <T x={x + w / 2} y={y + 2.25} size={LETTER.small} anchor="middle">{label}</T>
      <T x={x + w / 2} y={y + 4.5 + (h - 4.5) / 2} size={LETTER.small} anchor="middle">{fit(value, w - 2, LETTER.small)}</T>
    </g>
  );
}

function Frame({ doc, paper, name, kind, page, pages }: { doc: Doc; paper: Paper; name: string; kind: string; page: number; pages: number }) {
  const { w, h, cols, rows, title, rev } = SIZE[paper];
  const right = w - M;
  const bottom = h - M;
  const marks: ReactNode[] = [];

  // Grid reference system: numbers left→right, letters top→bottom, starting opposite the title block.
  for (let i = 0; i < cols; i++) {
    const x0 = (w / cols) * i;
    const cx = Math.max(ML, x0) + (Math.min(right, x0 + w / cols) - Math.max(ML, x0)) / 2;
    if (i) marks.push(<path key={`c${i}`} d={`M${x0},${M - 5} V${M} M${x0},${bottom} V${bottom + 5}`} stroke="#000" strokeWidth={LINE.mid} />);
    marks.push(<T key={`ct${i}`} x={cx} y={M - 2.5} size={LETTER.small} anchor="middle">{String(i + 1)}</T>);
    marks.push(<T key={`cb${i}`} x={cx} y={bottom + 2.5} size={LETTER.small} anchor="middle">{String(i + 1)}</T>);
  }
  for (let i = 0; i < rows; i++) {
    const y0 = (h / rows) * i;
    const cy = Math.max(M, y0) + (Math.min(bottom, y0 + h / rows) - Math.max(M, y0)) / 2;
    const ch = String.fromCharCode(65 + i);
    if (i) marks.push(<path key={`r${i}`} d={`M${ML - 5},${y0} H${ML} M${right},${y0} H${right + 5}`} stroke="#000" strokeWidth={LINE.mid} />);
    marks.push(<T key={`rl${i}`} x={ML - 2.5} y={cy} size={LETTER.small} anchor="middle">{ch}</T>);
    marks.push(<T key={`rr${i}`} x={right + 2.5} y={cy} size={LETTER.small} anchor="middle">{ch}</T>);
  }

  // Centring marks: from the sheet edge to 5 mm inside the frame, on all four sides.
  const centre = `M${w / 2},0 V${M + 5} M${w / 2},${h} V${bottom - 5} M0,${h / 2} H${ML + 5} M${w},${h / 2} H${right - 5}`;

  // Metric reference graduation: 100 mm in 10 mm steps, centred below the frame.
  const gx = w / 2 - 50;
  const graduation: ReactNode[] = [<rect key="g" x={gx} y={bottom} width={100} height={3} fill="#fff" stroke="#000" strokeWidth={LINE.mid} />];
  for (let i = 1; i < 10; i++) graduation.push(<line key={i} x1={gx + i * 10} y1={bottom} x2={gx + i * 10} y2={bottom + 3} stroke="#000" strokeWidth={LINE.mid} />);

  const x = right - title;
  const y = bottom - STRIP;
  const c = title / 17; // title block column unit
  const date = new Date().toISOString().slice(0, 10);
  const m = doc.meta;

  const rx = x - rev;
  const revRows = STRIP / 6 - 1;
  const revCols = [rx, rx + 12, rx + 12 + 24, x];
  return (
    <g>
      <rect x={ML} y={M} width={right - ML} height={bottom - M} fill="none" stroke="#000" strokeWidth={LINE.thick} />
      {marks}
      <path d={centre} stroke="#000" strokeWidth={LINE.thick} fill="none" />
      {graduation}

      {/* Revision table */}
      <rect x={rx} y={y} width={rev} height={STRIP} fill="#fff" stroke="#000" strokeWidth={LINE.mid} />
      {revCols.slice(1, -1).map((cx) => <line key={cx} x1={cx} y1={y} x2={cx} y2={bottom} stroke="#000" strokeWidth={LINE.fine} />)}
      {['記号', '年月日', '改訂内容'].map((s, i) => <T key={s} x={(revCols[i] + revCols[i + 1]) / 2} y={y + 3} size={LETTER.small} anchor="middle">{s}</T>)}
      {Array.from({ length: revRows }, (_, i) => <line key={i} x1={rx} y1={y + 6 * (i + 1)} x2={x} y2={y + 6 * (i + 1)} stroke="#000" strokeWidth={LINE.fine} />)}
      {/* The latest recorded revisions, oldest first; with no history, just the current mark. */}
      {(doc.revisions?.length ? doc.revisions.slice(-revRows) : [{ id: '', rev: m.rev, date, note: '', author: '' }]).map((r, i) => (
        <g key={r.id || i}>
          <T x={(revCols[0] + revCols[1]) / 2} y={y + 9 + 6 * i} size={LETTER.small} anchor="middle">{fit(r.rev, 10, LETTER.small)}</T>
          <T x={(revCols[1] + revCols[2]) / 2} y={y + 9 + 6 * i} size={LETTER.small} anchor="middle">{r.date}</T>
          <T x={revCols[2] + 1.5} y={y + 9 + 6 * i} size={LETTER.small}>{fit(r.note, revCols[3] - revCols[2] - 3, LETTER.small)}</T>
        </g>
      ))}

      {/* Title block */}
      <rect x={x} y={y} width={title} height={STRIP} fill="#fff" stroke="#000" strokeWidth={LINE.thick} />
      <Cell x={x} y={y} w={c * 10} h={9} label="案件名" value={m.project} />
      <Cell x={x + c * 10} y={y} w={c * 7} h={9} label="会社名" value={m.company} />
      <Cell x={x} y={y + 9} w={c * 10} h={15} label="図面名称" value={name} size={LETTER.large} />
      <Cell x={x + c * 10} y={y + 9} w={c * 7} h={7.5} label="図番" value={m.drawingNo} />
      <Cell x={x + c * 10} y={y + 16.5} w={c * 3.5} h={7.5} label="縮尺" value="NON" size={LETTER.small} />
      <Cell x={x + c * 13.5} y={y + 16.5} w={c * 3.5} h={7.5} label="用紙" value={paper} size={LETTER.small} />
      <Stamp x={x} y={y + 24} w={c * 2.5} h={18} label="承認" />
      <Stamp x={x + c * 2.5} y={y + 24} w={c * 2.5} h={18} label="検図" />
      <Stamp x={x + c * 5} y={y + 24} w={c * 2.5} h={18} label="設計" />
      <Stamp x={x + c * 7.5} y={y + 24} w={c * 2.5} h={18} label="製図" value={m.author} />
      <Cell x={x + c * 10} y={y + 24} w={c * 3.5} h={9} label="日付" value={date} size={LETTER.small} />
      <Cell x={x + c * 13.5} y={y + 24} w={c * 1.75} h={9} label="版" value={m.rev} size={LETTER.small} />
      <Cell x={x + c * 15.25} y={y + 24} w={c * 1.75} h={9} label="頁" value={`${page}/${pages}`} size={LETTER.small} />
      <Cell x={x + c * 10} y={y + 33} w={c * 7} h={9} label="種別" value={kind} />
    </g>
  );
}

function Legend({ doc, paper, color }: { doc: Doc; paper: Paper; color: boolean }) {
  const { w, h, title, rev } = SIZE[paper];
  const counts = new Map<string, number>();
  for (const e of doc.edges) if (e.signal !== 'flow') counts.set(e.signal, (counts.get(e.signal) ?? 0) + 1);
  const used = [...counts.keys()];
  if (!used.length) return null;
  const perCol = 6;
  const colW = 56;
  const x = ML + 3;
  const cols = Math.min(Math.ceil(used.length / perCol), Math.max(1, Math.floor((w - M - title - rev - x - 3) / colW)));
  const rows = Math.min(perCol, used.length);
  const height = 7 + rows * 5.2;
  const y = h - M - 3 - height;
  return (
    <g>
      <rect x={x} y={y} width={cols * colW} height={height} fill="#fff" stroke="#000" strokeWidth={LINE.thin} />
      <T x={x + 2} y={y + 3.4} size={LETTER.small} bold>凡例</T>
      {used.slice(0, cols * perCol).map((id, i) => {
        const s = signalOf(id);
        const lx = x + Math.floor(i / perCol) * colW + 2;
        const ly = y + 9 + (i % perCol) * 5.2;
        const stroke = color ? signalColor(doc, id) : '#000';
        const dash = s.dash ? s.dash.split(' ').map((v) => Number(v) * PX).join(' ') : undefined;
        return (
          <g key={id}>
            <line x1={lx} y1={ly} x2={lx + 15} y2={ly} stroke={stroke} strokeWidth={LINE.thin} strokeDasharray={dash} />
            {s.cable && <polygon points={`${lx + 17},${ly} ${lx + 15},${ly - 0.6} ${lx + 15},${ly + 0.6}`} fill={stroke} />}
            <T x={lx + 19} y={ly} size={LETTER.small}>{`${s.label}${s.cable ? ` [${s.prefix}]` : ''} ×${counts.get(id)}`}</T>
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
  const x0 = ML + 6;
  const y0 = M + 16;
  const width = w - M - ML - 12;
  const rowH = 7;
  const perPage = Math.max(1, Math.floor((h - M - STRIP - 6 - y0 - rowH) / rowH));
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
        <T x={x0} y={M + 9} size={LETTER.large} bold>{t.title}</T>
        <rect x={x0} y={y0} width={width} height={rowH} fill="#e8e8e8" />
        <rect x={x0} y={y0} width={width} height={bottom - y0} fill="none" stroke="#000" strokeWidth={LINE.mid} />
        <line x1={x0} y1={y0 + rowH} x2={x0 + width} y2={y0 + rowH} stroke="#000" strokeWidth={LINE.mid} />
        {xs.slice(1, -1).map((x) => <line key={x} x1={x} y1={y0} x2={x} y2={bottom} stroke="#000" strokeWidth={LINE.fine} />)}
        {t.head.map((s, i) => <T key={i} x={xs[i] + 1.5} y={y0 + rowH / 2} size={LETTER.normal} bold>{fit(s, xs[i + 1] - xs[i] - 3, LETTER.normal)}</T>)}
        {rows.map((row, r) => {
          const y = y0 + (r + 1) * rowH;
          return (
            <g key={r}>
              {r > 0 && <line x1={x0} y1={y} x2={x0 + width} y2={y} stroke="#000" strokeWidth={LINE.fine} />}
              {row.map((s, i) => <T key={i} x={xs[i] + 1.5} y={y + rowH / 2} size={LETTER.normal}>{fit(s, xs[i + 1] - xs[i] - 3, LETTER.normal)}</T>)}
            </g>
          );
        })}
      </g>,
    );
  }
  return pages;
}

/** Drawing sheets: the system diagram in a title-blocked frame, then the schedules. */
export function cadSheets(doc: Doc, opts: CadOptions): CadResult {
  const { paper } = opts;
  const { w, h } = SIZE[paper];
  const bodies: { name: string; kind: string; body: ReactNode }[] = [];

  const box = docBounds(doc) ?? { x: 0, y: 0, w: 100, h: 100 };
  const area = { x: ML + 6, y: M + 6, w: w - M - ML - 12, h: h - 2 * M - STRIP - 12 };
  // mm of paper per board px; never enlarge beyond 1:1 (96 px = 25.4 mm).
  const s = Math.min(area.w / (box.w * PX), area.h / (box.h * PX), 1) * PX;
  const theme: Theme = { mono: true, color: opts.color, font: CAD_FONT, unit: 1 / s };
  const tx = area.x + (area.w - box.w * s) / 2 - box.x * s;
  const ty = area.y + (area.h - box.h * s) / 2 - box.y * s;
  bodies.push({
    name: doc.meta.title,
    kind: '系統図',
    body: (
      <>
        <g transform={`translate(${tx},${ty}) scale(${s})`}>
          <DocView doc={doc} theme={theme} />
        </g>
        <Legend doc={doc} paper={paper} color={opts.color} />
      </>
    ),
  });

  if (opts.tables) {
    // Addresses don't belong on a drawing sheet; the model name on the diagram carries the link.
    for (const t of [equipmentTable(doc, false), cableTable(doc, false)]) {
      if (!t.rows.length) continue;
      for (const body of tablePages(paper, t)) bodies.push({ name: doc.meta.title, kind: t.title, body });
    }
  }

  const sheets = bodies.map((b, i) =>
    wrapSheet(
      paper,
      <>
        {b.body}
        <Frame doc={doc} paper={paper} name={b.name} kind={b.kind} page={i + 1} pages={bodies.length} />
      </>,
    ),
  );
  // Port names are the smallest lettering on the board (10.5 px).
  return { sheets, textMm: 10.5 * s };
}
