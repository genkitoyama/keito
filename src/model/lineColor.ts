import { signalOf } from './signals';
import type { Doc, Edge, SignalId } from './types';

/** Colours offered for lines: strong enough to read as a thin stroke on a light board. */
export const LINE_COLORS = ['#475569', '#dc2626', '#ea580c', '#eab308', '#16a34a', '#0d9488', '#0891b2', '#2563eb', '#a21caf', '#db2777'];

/** Colour of a signal type on this board: its own choice if it has made one, else the built-in colour. */
export const signalColor = (doc: Pick<Doc, 'signalColors'> | undefined, id: SignalId): string => doc?.signalColors?.[id] ?? signalOf(id).color;

/** Blend a hex colour towards another: `t` = 0 keeps it, 1 gives `to`. */
export function mix(hex: string, to: string, t: number): string {
  const rgb = (h: string): number[] => {
    const s = h.replace('#', '');
    const full = s.length < 6 ? [...s.slice(0, 3)].map((c) => c + c).join('') : s.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  };
  const a = rgb(hex);
  const b = rgb(to);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Colour a line is drawn in: its own, else its signal type's. */
export const lineColor = (doc: Doc, e: Edge): string => e.color ?? signalColor(doc, e.signal);

/** Whether a line is drawn dashed: as it says, else as its type is (radio, by default). */
export const lineDashed = (e: Edge): boolean => e.dash ?? !!signalOf(e.signal).dashed;

/**
 * Recolour a line (`color` null = back to the default). With `all`, the colour
 * goes to the line's whole signal type on this board — every HDMI cable, say —
 * and lines of that type drop their individual colours to follow it.
 */
export function paintLine(doc: Doc, id: string, color: string | null, all: boolean): Doc {
  const e = doc.edges.find((x) => x.id === id);
  if (!e) return doc;
  if (!all) return { ...doc, edges: doc.edges.map((x) => (x.id === id ? { ...x, color: color ?? undefined } : x)) };
  const signalColors = { ...doc.signalColors };
  if (color) signalColors[e.signal] = color;
  else delete signalColors[e.signal];
  return {
    ...doc,
    signalColors: Object.keys(signalColors).length ? signalColors : undefined,
    edges: doc.edges.map((x) => (x.signal === e.signal && x.color ? { ...x, color: undefined } : x)),
  };
}
