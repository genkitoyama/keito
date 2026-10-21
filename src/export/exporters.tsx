import { renderToStaticMarkup } from 'react-dom/server';
import { DocView, SCREEN, deviceTagRects } from '../canvas/render';
import { docBounds } from '../model/geometry';
import type { Table } from '../model/lists';
import type { Doc, Rect } from '../model/types';

export interface Image {
  svg: string;
  /** Size in CSS px. */
  w: number;
  h: number;
}

/** What a picture of the board must take in: its boxes and lines, and the tags drawn over devices. */
function pictureBounds(doc: Doc): Rect {
  const box = docBounds(doc);
  if (!box) return { x: 0, y: 0, w: 400, h: 300 };
  let [x0, y0, x1, y1] = [box.x, box.y, box.x + box.w, box.y + box.h];
  for (const n of doc.nodes) {
    if (n.type !== 'device') continue;
    for (const r of deviceTagRects(doc.whole ?? doc, n)) [x0, y0, x1, y1] = [Math.min(x0, r.x), Math.min(y0, r.y), Math.max(x1, r.x + r.w), Math.max(y1, r.y + r.h)];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The board as shown on screen, cropped to its content. */
export function boardImage(doc: Doc, background: boolean, padding = 40): Image {
  const box = pictureBounds(doc);
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

/** The largest side browsers draw a canvas at (16384 in Chrome and Safari), with some room to spare. */
const MAX_CANVAS = 16000;
/** …and the most pixels in all (Safari's limit is lower than its side limit squared). */
const MAX_PIXELS = 16384 * 16384 * 0.25;

/** The scale a PNG of the picture is actually made at: the one asked for, or less if that is beyond the browser. */
export const pngScale = (img: Image, scale: number): number => Math.min(scale, MAX_CANVAS / img.w, MAX_CANVAS / img.h, Math.sqrt(MAX_PIXELS / (img.w * img.h)));

export async function toPng(img: Image, scale: number): Promise<Blob> {
  const el = new window.Image();
  el.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(img.svg)}`;
  await el.decode();
  const canvas = document.createElement('canvas');
  const k = pngScale(img, scale);
  canvas.width = Math.round(img.w * k);
  canvas.height = Math.round(img.h * k);
  canvas.getContext('2d')!.drawImage(el, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG の生成に失敗しました'))), 'image/png'),
  );
}


export type Paper = 'A4' | 'A3';
const SIZE: Record<Paper, [number, number]> = { A4: [297, 210], A3: [420, 297] };
const MARGIN = 10;

export interface PdfOptions {
  paper: Paper;
  /** The state of the board shown, when an older one from its history is on screen ("先方提出 10/15"). */
  version?: string;
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
  return bookletHtml(doc.meta.title, [{ doc, tables: opts.tables, version: opts.version }], opts.paper, zoom);
}

/** One board of a booklet: its diagram, then its lists. */
export interface PdfPart {
  doc: Doc;
  tables: Table[];
  /** The state of the board shown, when an older one is on screen. */
  version?: string;
}

/** Figure page of one board: the diagram fitted under its title, the project and the date (or its version) on the right. */
function figureHtml(part: PdfPart): string {
  const { doc } = part;
  const figure = boardImage(doc, true, 24).svg.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="100%"');
  // An older state carries its own name or time in place of today's date.
  const meta = [doc.meta.project, part.version ?? new Date().toLocaleDateString('sv-SE')].filter(Boolean);
  return `<div class="figure"><header><h1>${esc(doc.meta.title)}</h1><span class="grow"></span><span>${meta.map((m) => esc(String(m))).join('　')}</span></header><div class="art">${figure}</div></div>
${part.tables.map((t) => tableHtml(t, doc)).join('')}`;
}

/** Several boards (a project's) as one document: each board's diagram, then its lists, one after the other. */
export function bookletHtml(title: string, parts: PdfPart[], paper: Paper, zoom = 1): string {
  const [w, h] = SIZE[paper];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:${paper} landscape;margin:${MARGIN}mm}
html,body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font:8.5pt/1.45 -apple-system,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;color:#1f2937}
header{display:flex;align-items:baseline;gap:12pt;border-bottom:.8pt solid #334155;padding-bottom:3pt;margin-bottom:6pt}
header h1,header h2{margin:0;font-size:13pt}header span{color:#64748b;font-size:8.5pt}header .grow{flex:1}
.figure{height:${h - MARGIN * 2 - 1}mm;display:flex;flex-direction:column}
.figure .art{flex:1;min-height:0}.figure svg{display:block}
.list,.figure~.figure{break-before:page}
table{width:100%;border-collapse:collapse;table-layout:fixed}
thead{display:table-header-group}tr{break-inside:avoid}
th,td{border:.4pt solid #cbd5e1;padding:2.5pt 4pt;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#eef2f6;font-weight:600;vertical-align:bottom;word-break:keep-all;overflow-wrap:anywhere}
tbody tr:nth-child(even) td{background:#f8fafc}
.num{text-align:right}tr.total td{font-weight:700;background:#eef2f6;border-top:.8pt solid #334155}tr.member td:first-child{color:#94a3b8}tr.subtotal td{font-weight:700;background:#f4f6f9;border-bottom:.8pt solid #334155}tr.subtotal td:last-child{color:#15803d}tr.subtotal.over td{background:#fdecec}tr.subtotal.over td:last-child{color:#b91c1c}tr.subtotal.unknown td:last-child{color:#64748b;font-weight:400}
a{color:#1d4ed8;text-decoration:none}
@media screen{html{zoom:${zoom};background:#e2e8f0}body{padding:6mm}
.figure,.list{background:#fff;width:${w - MARGIN * 2}mm;padding:${MARGIN}mm;margin:0 auto 6mm;box-shadow:0 1px 6px rgba(15,23,42,.18)}
.list{min-height:${h - MARGIN * 2}mm}}
</style></head><body>
${parts.map(figureHtml).join('\n')}
</body></html>`;
}

/** Vector PDF via the print dialog; the system fonts render Japanese without embedding. */
/**
 * Files packed into one ZIP. Names repeated (two boards of one title) are numbered before the
 * extension ("図_2.png", "図_2.keito.json"); names differing only in case count as the same, as
 * they would once unpacked on a Mac or Windows.
 */
export async function zipFiles(files: { name: string; data: Blob | string }[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    const ext = /(\.keito\.json|\.[^.]+)$/.exec(f.name)?.[0] ?? '';
    const stem = f.name.slice(0, f.name.length - ext.length);
    let name = f.name;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}_${i}${ext}`;
    used.add(name.toLowerCase());
    zip.file(name, f.data);
  }
  return zip.generateAsync({ type: 'blob' });
}
