import { freshId } from './presets';
import type { Doc, Node, Rect, ScreenSpec, ShapeNode } from './types';

/**
 * Screen layout boards: a content canvas (the picture the show renders) and the outputs that show
 * regions of it — displays, projectors, LED walls. Everything is measured in content pixels; the
 * board draws them at `pxScale` content pixels to one of its own (4 by default, so a 3840 px wide
 * canvas is 960 across). An output's region is where it sits on its canvas.
 */

export const pxRatio = (doc: Pick<Doc, 'pxScale'>): number => doc.pxScale || 4;

export type ScreenNode = ShapeNode & { screen: ScreenSpec };
export const isScreen = (n: Node): n is ScreenNode => n.type === 'shape' && !!n.screen;
export const isOutput = (n: Node): n is ScreenNode => isScreen(n) && n.screen.role !== 'canvas';

const inside = (r: Rect, n: Node): boolean => n.x + n.w / 2 >= r.x && n.x + n.w / 2 <= r.x + r.w && n.y + n.h / 2 >= r.y && n.y + n.h / 2 <= r.y + r.h;

/** The canvas an output lies on: the one its centre is inside. */
export function canvasOf(doc: Doc, n: Node): ScreenNode | null {
  return (doc.nodes.filter((c): c is ScreenNode => isScreen(c) && c.screen.role === 'canvas').find((c) => inside(c, n)) as ScreenNode | undefined) ?? null;
}

/** An output's region in content pixels, from its canvas's top-left (or the board's origin with no canvas). */
export function regionOf(doc: Doc, n: Node): Rect {
  const k = pxRatio(doc);
  const c = isOutput(n) ? canvasOf(doc, n) : null;
  const ox = c ? c.x : 0;
  const oy = c ? c.y : 0;
  return { x: Math.round((n.x - ox) * k), y: Math.round((n.y - oy) * k), w: Math.round(n.w * k), h: Math.round(n.h * k) };
}

/** Where a region (content pixels) puts the node on the board. */
export function placeRegion(doc: Doc, n: Node, r: Partial<Rect>): Partial<Node> {
  const k = pxRatio(doc);
  const c = isOutput(n) ? canvasOf(doc, n) : null;
  const cur = regionOf(doc, n);
  const next = { ...cur, ...r };
  return { x: (c ? c.x : 0) + next.x / k, y: (c ? c.y : 0) + next.y / k, w: Math.max(1, next.w / k), h: Math.max(1, next.h / k) };
}

export interface Overlap {
  a: ScreenNode;
  b: ScreenNode;
  /** On the board, and in content pixels. */
  board: Rect;
  px: Rect;
}

/** Where two outputs on one canvas cover the same content: a projector blend, or a mistake. */
export function overlaps(doc: Doc): Overlap[] {
  const k = pxRatio(doc);
  const outs = doc.nodes.filter(isOutput);
  const out: Overlap[] = [];
  for (let i = 0; i < outs.length; i++)
    for (let j = i + 1; j < outs.length; j++) {
      const a = outs[i];
      const b = outs[j];
      const x0 = Math.max(a.x, b.x);
      const y0 = Math.max(a.y, b.y);
      const x1 = Math.min(a.x + a.w, b.x + b.w);
      const y1 = Math.min(a.y + a.h, b.y + b.h);
      if (x1 - x0 < 0.5 || y1 - y0 < 0.5 || canvasOf(doc, a)?.id !== canvasOf(doc, b)?.id) continue;
      const board = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      out.push({ a, b, board, px: { x: Math.round(x0 * k), y: Math.round(y0 * k), w: Math.round(board.w * k), h: Math.round(board.h * k) } });
    }
  return out;
}

export interface ScreenPreset {
  key: string;
  name: string;
  category: string;
  role: ScreenSpec['role'];
  /** Size in content pixels. */
  w: number;
  h: number;
}

export const SCREENS: ScreenPreset[] = [
  { key: 'canvasfhd', name: 'キャンバス', category: 'キャンバス', role: 'canvas', w: 1920, h: 1080 },
  { key: 'canvas4k', name: 'キャンバス', category: 'キャンバス', role: 'canvas', w: 3840, h: 2160 },
  { key: 'canvaswide', name: 'キャンバス（横長）', category: 'キャンバス', role: 'canvas', w: 7680, h: 1080 },
  { key: 'fhd', name: 'ディスプレイ FHD', category: 'ディスプレイ', role: 'display', w: 1920, h: 1080 },
  { key: 'fhdv', name: 'ディスプレイ FHD 縦', category: 'ディスプレイ', role: 'display', w: 1080, h: 1920 },
  { key: 'uhd', name: 'ディスプレイ 4K', category: 'ディスプレイ', role: 'display', w: 3840, h: 2160 },
  { key: 'pjfhd', name: 'プロジェクター FHD', category: 'プロジェクター', role: 'projector', w: 1920, h: 1080 },
  { key: 'pjwuxga', name: 'プロジェクター WUXGA', category: 'プロジェクター', role: 'projector', w: 1920, h: 1200 },
  { key: 'pj4k', name: 'プロジェクター 4K', category: 'プロジェクター', role: 'projector', w: 3840, h: 2160 },
  { key: 'ledcab', name: 'LED キャビネット', category: 'LED', role: 'led', w: 256, h: 256 },
  { key: 'ledwall', name: 'LED ウォール', category: 'LED', role: 'led', w: 1920, h: 1080 },
];

/** A canvas or an output as a shape at (x, y), sized by the board's pixel ratio. */
export function makeScreen(p: ScreenPreset, x: number, y: number, taken: Set<string>, ratio: number): ShapeNode {
  const color = p.role === 'canvas' ? 'gray' : p.role === 'projector' ? 'purple' : p.role === 'led' ? 'orange' : 'blue';
  return {
    id: freshId(taken, p.role === 'canvas' ? 'canvas' : 'out'),
    type: 'shape',
    shape: 'rect',
    x,
    y,
    w: p.w / ratio,
    h: p.h / ratio,
    text: p.name,
    color,
    fill: p.role === 'canvas' ? 'none' : undefined,
    dash: p.role === 'canvas' || undefined,
    fontSize: 12,
    screen: { role: p.role },
  };
}

export const ROLE_LABEL: Record<ScreenSpec['role'], string> = { canvas: 'キャンバス', display: 'ディスプレイ', projector: 'プロジェクター', led: 'LED' };
