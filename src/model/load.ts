import { upgradeHistory } from './history';
import { KINDS } from './kinds';
import { upgradeOrder } from './lists';
import type { Doc, Edge, Node } from './types';
import { upgradeDoc } from './video';

/**
 * A board's kind as stored, made current: the layout, screen layout and experience flow boards of
 * old are free boards now; a kind this version does not know (a board from a newer keito, a hand
 * edit) is a system board.
 */
export function boardKind(kind: unknown): Doc['kind'] {
  if (kind === 'layout' || kind === 'screen' || kind === 'flow') return 'free';
  return typeof kind === 'string' && Object.hasOwn(KINDS, kind) && kind !== 'system' ? (kind as Doc['kind']) : undefined;
}

/** What a board's id may be, as its folder and the storage API take it (see server/store.ts). */
export const BOARD_ID = /^(?!.*__)[A-Za-z0-9_-]{1,64}$/;

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown, or = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : or);

/**
 * A board as written by hand or by another tool, made safe to draw: what is not a node or a line
 * at all is dropped, missing particulars are filled in, a second thing under an id already taken
 * gets one of its own, and a line to nothing is let go. A board keito wrote passes unchanged.
 */
function sanitize(d: Doc): void {
  const meta: Record<string, unknown> = isObject(d.meta) ? d.meta : {};
  d.meta = { ...meta, title: typeof meta.title === 'string' ? meta.title : '', project: typeof meta.project === 'string' ? meta.project : '' };
  const taken = new Set<string>();
  const fresh = (base: string): string => {
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
    taken.add(id);
    return id;
  };
  d.nodes = d.nodes
    .filter((n): n is Node => isObject(n) && typeof n.id === 'string' && typeof n.type === 'string')
    .map((n) => {
      const id = taken.has(n.id) ? fresh(n.id) : (taken.add(n.id), n.id);
      const box = { x: finite(n.x), y: finite(n.y), w: finite(n.w), h: finite(n.h) };
      const text = typeof n.text === 'string' ? n.text : '';
      const same = id === n.id && text === n.text && box.x === n.x && box.y === n.y && box.w === n.w && box.h === n.h;
      let out = same ? n : ({ ...n, id, text, ...box } as Node);
      if (out.type === 'device') {
        const ports = Array.isArray(out.ports) ? out.ports.filter((p) => isObject(p) && typeof p.id === 'string') : [];
        const fill = { maker: out.maker ?? '', model: out.model ?? '', category: out.category ?? '', note: out.note ?? '' };
        if (ports !== out.ports || Object.entries(fill).some(([k, v]) => (out as unknown as Record<string, unknown>)[k] !== v)) out = { ...out, ...fill, ports: ports.map((p) => ({ ...p, name: typeof p.name === 'string' ? p.name : '', side: p.side === 'left' ? 'left' : 'right', signal: typeof p.signal === 'string' ? p.signal : 'other' })) };
      }
      return out;
    });
  const nodes = new Set(d.nodes.map((n) => n.id));
  const end = (x: unknown) => isObject(x) && typeof x.node === 'string' && nodes.has(x.node);
  const lines = new Set<string>();
  d.edges = d.edges
    .filter((e): e is Edge => isObject(e) && end(e.from) && end(e.to))
    .map((e) => {
      let id = typeof e.id === 'string' && e.id ? e.id : 'e';
      if (lines.has(id) || nodes.has(id) || !(typeof e.id === 'string' && e.id)) {
        let i = 1;
        while (lines.has(`${id}_${i}`) || nodes.has(`${id}_${i}`)) i++;
        id = `${id}_${i}`;
      }
      lines.add(id);
      const fill = { signal: typeof e.signal === 'string' ? e.signal : 'flow', label: typeof e.label === 'string' ? e.label : '', note: typeof e.note === 'string' ? e.note : '', length: typeof e.length === 'number' && Number.isFinite(e.length) ? e.length : null, arrow: e.arrow === 'end' || e.arrow === 'both' ? e.arrow : 'none' };
      const same = id === e.id && Object.entries(fill).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v);
      return same ? e : ({ ...e, ...fill, id } as Edge);
    });
}

/**
 * A board as read from storage, made current: null when it is not a board at all; empty text
 * boxes (invisible, left behind by older versions) dropped; old forms brought up to date.
 * Shared by the app and the command line, so both read a board the same way.
 */
export function readBoard(v: unknown): Doc | null {
  const d = v as Doc | null;
  if (!d || typeof d !== 'object' || d.version !== 1 || typeof d.id !== 'string' || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) return null;
  sanitize(d);
  d.nodes = d.nodes.filter((n) => n.type !== 'text' || (n.text ?? '').trim() !== '');
  d.revisions = upgradeHistory(d.revisions);
  // Layout, screen layout and experience flow boards are no more: their drawings stay, as free boards.
  d.kind = boardKind(d.kind);
  const old = d as Doc & { scale?: unknown; pxScale?: unknown };
  delete old.scale;
  delete old.pxScale;
  // A screen board's content canvas lay under its outputs whatever its place in the list: it goes first, so it stays under.
  const isCanvas = (n: unknown) => (n as { type?: string; screen?: { role?: string } }).type === 'shape' && (n as { screen?: { role?: string } }).screen?.role === 'canvas';
  if (d.nodes.some(isCanvas)) d.nodes = [...d.nodes.filter(isCanvas), ...d.nodes.filter((n) => !isCanvas(n))];
  // So are the particulars only those boards used: real sizes, racks, screen regions, flow roles; and shared shapes.
  d.nodes = d.nodes.map((n) => {
    if (n.type !== 'shape') return n;
    const { dims, rack, screen, flow, shared, sharedAt, ...rest } = n as typeof n & Record<'dims' | 'rack' | 'screen' | 'flow' | 'shared' | 'sharedAt', unknown>;
    return dims === undefined && rack === undefined && screen === undefined && flow === undefined && shared === undefined && sharedAt === undefined ? n : rest;
  });
  return upgradeOrder(upgradeDoc(d));
}
