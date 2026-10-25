import { powerLoads } from './lists';
import { MONO_FONT, UI_FONT, measure } from './text';
import type { DeviceNode, Doc, Rect } from './types';

// The tags drawn above a device (its address, the load on a power source), sized here so the
// drawing, the export bounds and the tidy-up all agree on where they reach.

export const IP_SIZE = 10.5;

/** Load summary above a power source: how many devices it feeds and how many watts they draw. */
export function loadBadgeText(doc: Doc, n: DeviceNode): string {
  const load = powerLoads(doc).get(n.id);
  if (!load) return '';
  const watts = load.capacity != null ? `${load.watts} / ${load.capacity}W` : load.watts ? `${load.watts}W` : '';
  return [`⚡ ${load.ids.length}台`, watts, load.over ? '容量超過' : ''].filter(Boolean).join(' · ');
}
export const LOAD_SIZE = 10.5;
export const loadBadgeWidth = (doc: Doc, n: DeviceNode): number => {
  const text = loadBadgeText(doc, n);
  return text ? measure(text, `600 ${LOAD_SIZE}px ${UI_FONT}`) + 12 : 0;
};

/** Width of a device's address tag; 0 when it has no address. */
export function ipBadgeWidth(n: DeviceNode): number {
  const ip = n.ip?.trim();
  const host = n.host?.trim();
  if (!ip && !host) return 0;
  const gap = ip && host ? IP_SIZE * 0.8 : 0;
  return (ip ? measure(ip, `700 ${IP_SIZE}px ${MONO_FONT}`) : 0) + gap + (host ? measure(host, `400 ${IP_SIZE}px ${MONO_FONT}`) : 0) + 12;
}

/**
 * Whether a device's address tag and power tag are too wide to share the row above it. Then the
 * two stack, address on top, and both line up on the device's left edge instead of one on each
 * side, which would leave them staggered.
 */
export function tagsStacked(doc: Doc, n: DeviceNode): boolean {
  const ip = ipBadgeWidth(n);
  const load = loadBadgeWidth(doc, n);
  return !!ip && !!load && ip + load + 4 > n.w;
}

/** Where the tags over a device are drawn (its address, its power load): an exported picture takes them in. */
export function deviceTagRects(doc: Doc, n: DeviceNode): Rect[] {
  const out: Rect[] = [];
  const stacked = tagsStacked(doc, n);
  const ip = ipBadgeWidth(n);
  if (ip) out.push({ x: n.x, y: n.y - 20 - (stacked ? 18 : 0), w: ip, h: 16 });
  const load = loadBadgeWidth(doc, n);
  if (load) out.push({ x: stacked ? n.x : n.x + n.w - load, y: n.y - 20, w: load, h: 16 });
  return out;
}
