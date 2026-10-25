import { isTagged } from './geometry';
import { lineColor, lineDashed } from './lineColor';
import { colourKey } from './lists';
import { COLOR_NAME, PALETTE, allSignals, signalOf } from './signals';
import type { ColorKey, DeviceNode, Doc, LegendNode } from './types';

/** Layout of a legend block: padding, the height of a row and of the title line. */
export const LEGEND = { pad: 12, row: 22, title: 24, sample: 40, section: 20, column: 180, gap: 20 };

export interface LegendRow {
  /** Left out of the drawn legend; still listed in the panel so it can be brought back. */
  hidden: boolean;
  /** The line colour this row stands for (lower-case hex), and the key of its custom name. */
  color: string;
  name: string;
  /** What the row is called when no name was given: the signal types drawn in this colour. */
  usual: string;
  /** How the lines of this colour are drawn, for the sample: dashed, and as tags beside the ports rather than lines. */
  dashed: boolean;
  tagged: boolean;
}

/**
 * One row per line colour in use on the board. Signal types sharing a colour share a row, so a
 * board coloured by system (video, audio, network) gets one row per system.
 */
export function legendRows(doc: Doc, n: LegendNode): LegendRow[] {
  const order = allSignals().map((s) => s.id);
  const groups = new Map<string, Set<string>>();
  // A sample is drawn as the lines are only when every line of the colour is drawn that way.
  const dashed = new Map<string, boolean>();
  const tagged = new Map<string, boolean>();
  for (const e of doc.edges) {
    if (e.signal === 'flow') continue;
    const color = lineColor(doc, e).toLowerCase();
    groups.set(color, (groups.get(color) ?? new Set()).add(e.signal));
    dashed.set(color, (dashed.get(color) ?? true) && lineDashed(e));
    tagged.set(color, (tagged.get(color) ?? true) && isTagged(doc, e));
  }
  const first = (signals: Set<string>) => Math.min(...[...signals].map((s) => (order.indexOf(s) < 0 ? order.length : order.indexOf(s))));
  return [...groups]
    .sort((a, b) => first(a[1]) - first(b[1]))
    .map(([color, signals]) => {
      const usual = [...signals].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((s) => signalOf(s).label).join(' / ');
      return { color, usual, name: n.names?.[color]?.trim() || usual, hidden: !!n.hidden?.includes(color), dashed: !!dashed.get(color), tagged: !!tagged.get(color) };
    });
}

/** The rows actually drawn. */
export const shownRows = (doc: Doc, n: LegendNode): LegendRow[] => legendRows(doc, n).filter((r) => !r.hidden);

/** The key a device row's custom name and hiding are kept under, beside the line colours'. */
export const deviceKey = (c: ColorKey | 'venue'): string => `device:${c}`;

export interface DeviceRow {
  /** Left out of the drawn legend; still listed in the panel so it can be brought back. */
  hidden: boolean;
  /** The device colour this row stands for, or the venue's own equipment. */
  color: ColorKey | 'venue';
  key: string;
  name: string;
  /** What the row is called when no name was given: the board's hand-made key, the devices' supplier, else the colour. */
  usual: string;
}

/**
 * One row per device colour in use, for who supplies what, then one for what the venue has
 * (striped, whatever its colour). A device colour reads the same on venue equipment: the one
 * looking after it. Plain gray is listed only once something names it.
 */
export function deviceRows(doc: Doc, n: LegendNode): DeviceRow[] {
  if (!n.devices) return [];
  const devices = doc.nodes.filter((d): d is DeviceNode => d.type === 'device');
  const key = colourKey(doc);
  const out: DeviceRow[] = [];
  for (const c of Object.keys(PALETTE) as ColorKey[]) {
    const mine = devices.filter((d) => (d.color ?? 'gray') === c);
    if (!mine.length) continue;
    const vendors = new Set(mine.map((d) => d.vendor?.trim() ?? ''));
    const vendor = vendors.size === 1 ? [...vendors][0] : '';
    // A plain device and a white key shape are both the board's unmarked look.
    const named = key.get(c) ?? (c === 'gray' ? key.get('white') : undefined) ?? vendor;
    const own = n.names?.[deviceKey(c)]?.trim();
    if (c === 'gray' && !named && !own) continue;
    const usual = named || `${COLOR_NAME[c]}の機材`;
    out.push({ color: c, key: deviceKey(c), usual, name: own || usual, hidden: !!n.hidden?.includes(deviceKey(c)) });
  }
  // Colours alone say nothing until there are two of them, or a venue row to set them against.
  const venue = devices.some((d) => d.venue);
  if (out.length === 1 && !venue && !n.names?.[out[0].key]?.trim()) out.length = 0;
  if (venue) {
    const k = deviceKey('venue');
    out.push({ color: 'venue', key: k, usual: '会場の設備', name: n.names?.[k]?.trim() || '会場の設備', hidden: !!n.hidden?.includes(k) });
  }
  return out;
}

export const shownDeviceRows = (doc: Doc, n: LegendNode): DeviceRow[] => deviceRows(doc, n).filter((r) => !r.hidden);

/** Where each part of a legend goes, relative to its top-left corner. */
export interface LegendLayout {
  lines: { x: number; y: number; w: number; rows: LegendRow[]; heading: boolean };
  devices: { x: number; y: number; w: number; rows: DeviceRow[]; heading: boolean };
  h: number;
}

/**
 * Lines first, then devices: side by side when the legend is wide enough for two columns,
 * else one above the other. A part with nothing in it takes no room, and with only one part
 * shown it needs no heading.
 */
export function legendLayout(doc: Doc, n: LegendNode): LegendLayout {
  const lines = shownRows(doc, n);
  const devices = shownDeviceRows(doc, n);
  const both = lines.length > 0 && devices.length > 0;
  const top = LEGEND.pad + (n.text.trim() ? LEGEND.title : 0);
  const inner = n.w - LEGEND.pad * 2;
  const tall = (count: number) => (both ? LEGEND.section : 0) + count * LEGEND.row;
  // Nothing to show still leaves a row for the hint of what will come.
  const lineRows = lines.length || !devices.length ? Math.max(1, lines.length) : 0;
  if (both && inner >= LEGEND.column * 2 + LEGEND.gap) {
    const w = (inner - LEGEND.gap) / 2;
    return {
      lines: { x: LEGEND.pad, y: top, w, rows: lines, heading: true },
      devices: { x: LEGEND.pad + w + LEGEND.gap, y: top, w, rows: devices, heading: true },
      h: top + Math.max(tall(lines.length), tall(devices.length)) + LEGEND.pad,
    };
  }
  const below = top + (lineRows ? tall(lineRows) + (both ? LEGEND.pad / 2 : 0) : 0);
  return {
    lines: { x: LEGEND.pad, y: top, w: inner, rows: lines, heading: both },
    devices: { x: LEGEND.pad, y: below, w: inner, rows: devices, heading: both },
    h: below + (devices.length ? tall(devices.length) : 0) + LEGEND.pad,
  };
}

export const legendHeight = (doc: Doc, n: LegendNode): number => legendLayout(doc, n).h;

/** Legends grow and shrink with the colours in use: keep each one's stored height in step with its rows. */
export function fitLegends(doc: Doc): Doc {
  if (!doc.nodes.some((n) => n.type === 'legend' && n.h !== legendHeight(doc, n))) return doc;
  return { ...doc, nodes: doc.nodes.map((n) => (n.type === 'legend' ? { ...n, h: legendHeight(doc, n) } : n)) };
}
