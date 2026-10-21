// What the canvas is in the middle of (a drag, its ghost, a planned connection) and the small helpers its parts share.
import { type Dir } from '../model/geometry';
import { useStore } from '../model/store';
import { type Doc, type EdgeEnd, type Node, type Pt, type Rect } from '../model/types';

export type Corner = 'nw' | 'ne' | 'sw' | 'se' | 'e';

export type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  /** `dup`: an Alt-drag, which moves copies away and leaves the originals (made once it really moves). */
  | { kind: 'move'; start: Pt; orig: Map<string, Pt>; routes: Map<string, Pt[]>; lead: string; moved: boolean; dup?: boolean }
  | { kind: 'segment'; id: string; seg: number; horizontal: boolean; start: Pt; route: Pt[]; moved: boolean }
  | { kind: 'reconnect'; id: string; end: 'from' | 'to'; other: Pt }
  | { kind: 'label'; id: string; start: Pt; moved: boolean }
  | { kind: 'marquee'; start: Pt; base: string[] }
  | { kind: 'resize'; id: string; corner: Corner; start: Pt; orig: Rect; moved: boolean; lock?: number }
  | { kind: 'connect'; from: EdgeEnd; at: Pt; side?: Dir; sx: number; sy: number; trail: Pt[] }
  | { kind: 'place'; start: Pt };

export type ConnectDrag = Extract<Drag, { kind: 'connect' }>;

export type ReconnectDrag = Extract<Drag, { kind: 'reconnect' }>;

/** While a line is pulled: what letting go here would make (`plan`), else a plain rubber band. */
export type Ghost = null | { kind: 'marquee'; rect: Rect } | { kind: 'size'; rect: Rect } | { kind: 'connect'; a: Pt; b: Pt; plan: Plan | null };

/**
 * A small link mark on what is shared with other boards of the project (screen only: an export
 * shows the drawing, not how it is kept).
 */
/** What letting go of a pulled line would make: the board with the line in it, and what it lands on. */
export interface Plan {
  doc: Doc;
  edge: string;
  /** The box it goes into, and the side it is held to (when let go on one of the box's dots, or on its edge). */
  box?: string;
  side?: Dir;
  /** Where along that side, when let go on the edge away from the dot. */
  at?: number;
  /** The line it merges with. */
  line?: string;
  /** The box made for it, let go on empty canvas. */
  made?: string;
  /** The same key, the same plan: what it lands on, and where. */
  key: string;
}

export const SIDES: Dir[] = ['left', 'right', 'top', 'bottom'];

export const ACCENT = '#2563eb';

type Flowable = Extract<Node, { type: 'shape' | 'sticky' | 'text' }>;

export const canConnect = (n: Node): n is Flowable => n.type === 'shape' || n.type === 'sticky' || n.type === 'text';

export const st = useStore.getState;

export const portOf = (doc: Doc, end: EdgeEnd) => {
  const n = doc.nodes.find((x) => x.id === end.node);
  return n?.type === 'device' ? n.ports.find((p) => p.id === end.port) : undefined;
};
