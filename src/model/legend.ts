import { lineColor } from './lineColor';
import { allSignals, signalOf } from './signals';
import type { Doc, LegendNode } from './types';

/** Layout of a legend block: padding, the height of a row and of the title line. */
export const LEGEND = { pad: 10, row: 22, title: 20, sample: 40 };

export interface LegendRow {
  /** Left out of the drawn legend; still listed in the panel so it can be brought back. */
  hidden: boolean;
  /** The line colour this row stands for (lower-case hex), and the key of its custom name. */
  color: string;
  name: string;
  /** What the row is called when no name was given: the signal types drawn in this colour. */
  usual: string;
}

/**
 * One row per line colour in use on the board. Signal types sharing a colour share a row, so a
 * board coloured by system (video, audio, network) gets one row per system.
 */
export function legendRows(doc: Doc, n: LegendNode): LegendRow[] {
  const order = allSignals().map((s) => s.id);
  const groups = new Map<string, Set<string>>();
  for (const e of doc.edges) {
    if (e.signal === 'flow') continue;
    const color = lineColor(doc, e).toLowerCase();
    groups.set(color, (groups.get(color) ?? new Set()).add(e.signal));
  }
  const first = (signals: Set<string>) => Math.min(...[...signals].map((s) => (order.indexOf(s) < 0 ? order.length : order.indexOf(s))));
  return [...groups]
    .sort((a, b) => first(a[1]) - first(b[1]))
    .map(([color, signals]) => {
      const usual = [...signals].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((s) => signalOf(s).label).join(' / ');
      return { color, usual, name: n.names?.[color]?.trim() || usual, hidden: !!n.hidden?.includes(color) };
    });
}

/** The rows actually drawn. */
export const shownRows = (doc: Doc, n: LegendNode): LegendRow[] => legendRows(doc, n).filter((r) => !r.hidden);

export const legendHeight = (doc: Doc, n: LegendNode): number => LEGEND.pad * 2 + (n.text.trim() ? LEGEND.title : 0) + Math.max(1, shownRows(doc, n).length) * LEGEND.row;

/** Legends grow and shrink with the colours in use: keep each one's stored height in step with its rows. */
export function fitLegends(doc: Doc): Doc {
  if (!doc.nodes.some((n) => n.type === 'legend' && n.h !== legendHeight(doc, n))) return doc;
  return { ...doc, nodes: doc.nodes.map((n) => (n.type === 'legend' ? { ...n, h: legendHeight(doc, n) } : n)) };
}
