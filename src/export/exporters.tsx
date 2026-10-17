import { renderToStaticMarkup } from 'react-dom/server';
import { DocView, SCREEN } from '../canvas/render';
import { docBounds } from '../model/geometry';
import type { Table } from '../model/lists';
import type { Doc } from '../model/types';

export interface Image {
  svg: string;
  /** Size in CSS px. */
  w: number;
  h: number;
}

/** The board as shown on screen, cropped to its content. */
export function boardImage(doc: Doc, background: boolean, padding = 40): Image {
  const box = docBounds(doc) ?? { x: 0, y: 0, w: 400, h: 300 };
  const w = Math.ceil(box.w + padding * 2);
  const h = Math.ceil(box.h + padding * 2);
  const svg = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`${box.x - padding} ${box.y - padding} ${w} ${h}`}>
      {background && <rect x={box.x - padding} y={box.y - padding} width={w} height={h} fill="#ffffff" />}
      <DocView doc={doc} theme={SCREEN} />
    </svg>,
  );
  return { svg, w, h };
}

export async function toPng(img: Image, scale: number): Promise<Blob> {
  const el = new window.Image();
  el.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(img.svg)}`;
  await el.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.w * scale);
  canvas.height = Math.round(img.h * scale);
  canvas.getContext('2d')!.drawImage(el, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG の生成に失敗しました'))), 'image/png'),
  );
}

export async function copyPng(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export type Paper = 'A4' | 'A3';
const SIZE: Record<Paper, [number, number]> = { A4: [297, 210], A3: [420, 297] };
const MARGIN = 10;

export interface PdfOptions {
  paper: Paper;
  /** The revision mark shown in the header, when one has been recorded. */
  rev?: string;
  /** The lists that follow the diagram, each starting on a page of its own. */
  tables: Table[];
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tableHtml(t: Table, doc: Doc): string {
  const sum = t.widths.reduce((a, b) => a + b, 0);
  const num = new Set(t.numeric ?? []);
  const cell = (c: string, i: number): string => {
    const body = /^https?:\/\//.test(c) ? `<a href="${esc(c)}">${esc(c.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : esc(c);
    return `<td${num.has(t.head[i]) ? ' class="num"' : ''}>${body}</td>`;
  };
  return `<section class="list"><header><h2>${esc(t.title)}</h2><span>${esc(doc.meta.title)}</span></header><table>
<colgroup>${t.widths.map((w) => `<col style="width:${((w / sum) * 100).toFixed(2)}%">`).join('')}</colgroup>
<thead><tr>${t.head.map((h) => `<th${num.has(h) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${t.rows.map((row, r) => { const cls = [t.total && r === t.rows.length - 1 ? 'total' : '', t.rowClass?.[r] ?? ''].filter(Boolean).join(' '); return `<tr${cls ? ` class="${cls}"` : ''}>${row.map(cell).join('')}</tr>`; }).join('')}</tbody></table></section>`;
}

/**
 * The board as a document for the print dialog: the diagram fitted on the first page, then the
 * lists as real tables, which the browser breaks across pages with the header row repeated.
 * `zoom` scales the on-screen preview; print ignores it.
 */
export function pdfHtml(doc: Doc, opts: PdfOptions, zoom = 1): string {
  const [w, h] = SIZE[opts.paper];
  const figure = boardImage(doc, true, 24).svg.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="100%"');
  const meta = [doc.meta.project, opts.rev && `REV ${opts.rev}`, new Date().toLocaleDateString('sv-SE')].filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.meta.title)}</title><style>
@page{size:${opts.paper} landscape;margin:${MARGIN}mm}
html,body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font:8.5pt/1.45 -apple-system,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;color:#1f2937}
header{display:flex;align-items:baseline;gap:12pt;border-bottom:.8pt solid #334155;padding-bottom:3pt;margin-bottom:6pt}
header h1,header h2{margin:0;font-size:13pt}header span{color:#64748b;font-size:8.5pt}header .grow{flex:1}
.figure{height:${h - MARGIN * 2 - 1}mm;display:flex;flex-direction:column}
.figure .art{flex:1;min-height:0}.figure svg{display:block}
.list{break-before:page}
table{width:100%;border-collapse:collapse;table-layout:fixed}
thead{display:table-header-group}tr{break-inside:avoid}
th,td{border:.4pt solid #cbd5e1;padding:2.5pt 4pt;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#eef2f6;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tbody tr:nth-child(even) td{background:#f8fafc}
.num{text-align:right}tr.total td{font-weight:700;background:#eef2f6;border-top:.8pt solid #334155}tr.member td:first-child{color:#94a3b8}tr.subtotal td{font-weight:700;background:#f4f6f9;border-bottom:.8pt solid #334155}tr.subtotal td:last-child{color:#15803d}tr.subtotal.over td{background:#fdecec}tr.subtotal.over td:last-child{color:#b91c1c}tr.subtotal.unknown td:last-child{color:#64748b;font-weight:400}
a{color:#1d4ed8;text-decoration:none}
@media screen{html{zoom:${zoom};background:#e2e8f0}body{padding:6mm}
.figure,.list{background:#fff;width:${w - MARGIN * 2}mm;padding:${MARGIN}mm;margin:0 auto 6mm;box-shadow:0 1px 6px rgba(15,23,42,.18)}
.list{min-height:${h - MARGIN * 2}mm}}
</style></head><body>
<div class="figure"><header><h1>${esc(doc.meta.title)}</h1><span class="grow"></span><span>${meta.map((m) => esc(String(m))).join('　')}</span></header><div class="art">${figure}</div></div>
${opts.tables.map((t) => tableHtml(t, doc)).join('')}
</body></html>`;
}

/** Vector PDF via the print dialog; the system fonts render Japanese without embedding. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(html);
  d.close();
  const win = frame.contentWindow!;
  win.onafterprint = () => frame.remove();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 150);
}
