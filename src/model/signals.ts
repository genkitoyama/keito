import type { ColorKey, CustomSignal, SignalId } from './types';

export interface Signal {
  id: SignalId;
  label: string;
  /** Cable ID prefix, e.g. HDMI-01. */
  prefix: string;
  color: string;
  /** Dash pattern used to tell signals apart on monochrome drawings. */
  dash: string;
  /** Physical cable (appears in the cable list). */
  cable: boolean;
}

export const SIGNALS: Signal[] = [
  { id: 'flow', label: 'フロー（矢印）', prefix: '', color: '#76869a', dash: '', cable: false },
  // One type for every video cable, as for audio: the standard (HDMI, SDI …) is the cable's spec.
  // Its cable IDs still read HDMI-01, SDI-01 …, taken from the spec or the ports (see video.ts).
  { id: 'video', label: '映像', prefix: 'VID', color: '#2563eb', dash: '', cable: true },
  { id: 'lan', label: 'LAN', prefix: 'LAN', color: '#d97706', dash: '2 3', cable: true },
  { id: 'usb', label: 'USB', prefix: 'USB', color: '#0891b2', dash: '10 3 2 3 2 3', cable: true },
  { id: 'audio', label: '音声', prefix: 'AUD', color: '#db2777', dash: '5 3', cable: true },
  { id: 'power', label: '電源', prefix: 'PWR', color: '#dc2626', dash: '14 4', cable: true },
  { id: 'fiber', label: '光ファイバー', prefix: 'FBR', color: '#ea580c', dash: '14 3 4 3', cable: true },
  { id: 'dmx', label: 'DMX', prefix: 'DMX', color: '#9333ea', dash: '6 2 1 2', cable: true },
  { id: 'serial', label: 'シリアル/GPIO', prefix: 'SER', color: '#65a30d', dash: '3 2', cable: true },
  { id: 'wireless', label: '無線', prefix: 'WL', color: '#64748b', dash: '1 4', cable: false },
  { id: 'other', label: 'その他ケーブル', prefix: 'CBL', color: '#1f2937', dash: '', cable: true },
];

const byId = new Map(SIGNALS.map((s) => [s.id, s]));

/** Video standards that were types of their own before 映像 took them in, by their old ids. */
export const VIDEO_STANDARDS: Record<string, string> = { hdmi: 'HDMI', sdi: 'SDI', dp: 'DisplayPort' };
/** The type an id stands for today: an old video id is 映像. */
export const currentSignal = (id: SignalId): SignalId => (Object.prototype.hasOwnProperty.call(VIDEO_STANDARDS, id) ? 'video' : id);

// Signal types a board adds for itself. They are looked up from so many places that the board in
// use registers them here (the store does it whenever the board changes) instead of every caller
// passing the board along.
let custom = new Map<SignalId, Signal>();
/** Dash patterns handed to custom types in turn, so they stay distinguishable on monochrome sheets. */
const DASHES = ['11 3 3 3', '7 3 1 3 1 3', '4 2', '16 3 2 3 2 3', '9 2 3 2'];
export function registerSignals(list: CustomSignal[] | undefined): void {
  custom = new Map((list ?? []).filter((s) => !isBuiltInSignal(s.id)).map((s, i) => [s.id, { ...s, dash: DASHES[i % DASHES.length], cable: true }]));
}
/** The types registered now, in a form `registerSignals` takes back. */
export const customSignals = (): CustomSignal[] => [...custom.values()].map(({ id, label, prefix, color }) => ({ id, label, prefix, color }));
export const signalOf = (id: SignalId): Signal => custom.get(id) ?? byId.get(currentSignal(id)) ?? byId.get('other')!;
export const isSignal = (id: string): boolean => custom.has(id) || byId.has(currentSignal(id));
export const isBuiltInSignal = (id: string): boolean => byId.has(currentSignal(id));
/** Every type on offer: the built-in ones, then the board's own. */
export const allSignals = (): Signal[] => [...SIGNALS, ...custom.values()];

export const PALETTE: Record<ColorKey, { fill: string; stroke: string }> = {
  white: { fill: '#ffffff', stroke: '#b4bfcc' },
  gray: { fill: '#f1f5f9', stroke: '#64748b' },
  blue: { fill: '#dbeafe', stroke: '#3b82f6' },
  green: { fill: '#dcfce7', stroke: '#22c55e' },
  yellow: { fill: '#fef3c7', stroke: '#eab308' },
  orange: { fill: '#ffedd5', stroke: '#f97316' },
  red: { fill: '#fee2e2', stroke: '#ef4444' },
  purple: { fill: '#f3e8ff', stroke: '#a855f7' },
};
/** Full-strength colours for solid fills and for the border of outline / see-through shapes. */
export const STRONG: Record<ColorKey, { fill: string; text: string }> = {
  white: { fill: '#64748b', text: '#ffffff' },
  gray: { fill: '#475569', text: '#ffffff' },
  blue: { fill: '#1d6ff2', text: '#ffffff' },
  green: { fill: '#12a150', text: '#ffffff' },
  yellow: { fill: '#ffd60a', text: '#27323f' },
  orange: { fill: '#ff7a00', text: '#ffffff' },
  red: { fill: '#e60012', text: '#ffffff' },
  purple: { fill: '#8b2ff0', text: '#ffffff' },
};

/** Sticky notes use paper colours: more saturated than shapes, with a darker shade for the curl. */
export const STICKY: Record<ColorKey, { fill: string; stroke: string }> = {
  white: { fill: '#fffdf2', stroke: '#e6dfc0' },
  gray: { fill: '#e3e7ec', stroke: '#b9c1cb' },
  blue: { fill: '#a9dcff', stroke: '#6fb8ea' },
  green: { fill: '#b5efb0', stroke: '#7fcf7a' },
  yellow: { fill: '#ffe872', stroke: '#e8c93a' },
  orange: { fill: '#ffc27a', stroke: '#eb9a40' },
  red: { fill: '#ffaec0', stroke: '#ee7f98' },
  purple: { fill: '#d6bdff', stroke: '#b08cf0' },
};
export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[];
