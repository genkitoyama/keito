import { renderToStaticMarkup } from 'react-dom/server';
import { DocView, SCREEN } from '../canvas/render';
import { docBounds } from '../model/geometry';
import type { Doc } from '../model/types';
import type { Sheet } from './cad';

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

/** A CAD sheet as a px-sized image (96 dpi base) so it can be rasterised. */
export function sheetImage(sheet: Sheet): Image {
  const w = Math.round((sheet.w / 25.4) * 96);
  const h = Math.round((sheet.h / 25.4) * 96);
  return { svg: sheet.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${w}" height="${h}"`), w, h };
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

/**
 * Vector PDF via the print dialog — the system fonts render Japanese without embedding.
 * The named `@page` size with `landscape` makes the dialog default to a landscape sheet.
 */
export function printSheets(sheets: Sheet[], title: string): void {
  if (!sheets.length) return;
  const { w, h } = sheets[0];
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<&]/g, '')}</title>
<style>@page{size:${w > 400 ? 'A3' : 'A4'} landscape;margin:0}html,body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:${w}mm;height:${h}mm;page-break-after:always;overflow:hidden}
.sheet:last-child{page-break-after:auto}svg{display:block}</style></head>
<body>${sheets.map((s) => `<div class="sheet">${s.svg}</div>`).join('')}</body></html>`);
  d.close();
  const win = frame.contentWindow!;
  win.onafterprint = () => frame.remove();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 150);
}
