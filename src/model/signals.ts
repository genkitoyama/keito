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
  /** A protocol between pieces of software (software boards), rather than a cable. */
  protocol?: boolean;
  /** Drawn dashed unless a line says otherwise: what travels without a cable. */
  dashed?: boolean;
  /** Where it is listed when a type is picked (see SIGNAL_GROUPS). */
  group: SignalGroup;
  /** Added after boards could define types of their own: a board's own type of the same id keeps winning. */
  late?: boolean;
}

/**
 * The headings a type is picked under. Most cable types say what the connectors at either end are
 * for (video, LAN …); fibre and radio say only how it travels, whatever it carries.
 */
export type SignalGroup = 'flow' | 'cable' | 'medium' | 'other' | 'protocol' | 'custom';
export const SIGNAL_GROUPS: { id: SignalGroup; label: string }[] = [
  { id: 'flow', label: '図の矢印' },
  { id: 'cable', label: 'ケーブル（端子の種類）' },
  { id: 'medium', label: '光・無線（中身は問わない）' },
  { id: 'other', label: 'その他' },
  { id: 'custom', label: 'このボードで追加した種別' },
  { id: 'protocol', label: '通信（ソフトウェアどうし）' },
];

export const SIGNALS: Signal[] = [
  { id: 'flow', label: 'フロー（矢印）', prefix: '', color: '#76869a', dash: '', cable: false, group: 'flow' },
  // One type for every video cable, as for audio: the standard (HDMI, SDI …) is the cable's spec.
  // Its cable IDs still read HDMI-01, SDI-01 …, taken from the spec or the ports (see video.ts).
  { id: 'video', label: '映像', prefix: 'VID', color: '#2563eb', dash: '', cable: true, group: 'cable' },
  { id: 'lan', label: 'LAN', prefix: 'LAN', color: '#d97706', dash: '2 3', cable: true, group: 'cable' },
  { id: 'usb', label: 'USB', prefix: 'USB', color: '#0891b2', dash: '10 3 2 3 2 3', cable: true, group: 'cable' },
  { id: 'audio', label: '音声', prefix: 'AUD', color: '#db2777', dash: '5 3', cable: true, group: 'cable' },
  { id: 'power', label: '電源', prefix: 'PWR', color: '#dc2626', dash: '14 4', cable: true, group: 'cable' },
  { id: 'fiber', label: '光ファイバー', prefix: 'FBR', color: '#ea580c', dash: '14 3 4 3', cable: true, group: 'medium' },
  { id: 'dmx', label: 'DMX', prefix: 'DMX', color: '#9333ea', dash: '6 2 1 2', cable: true, group: 'cable' },
  { id: 'serial', label: 'シリアル/GPIO', prefix: 'SER', color: '#65a30d', dash: '3 2', cable: true, group: 'cable' },
  // Genlock, LTC, word clock: what keeps devices in step, run on its own cable.
  { id: 'sync', label: '同期（Genlock・LTC）', prefix: 'SYNC', color: '#0d9488', dash: '12 2 2 2 2 2', cable: true, group: 'cable', late: true },
  // Antenna leads (wireless mic receivers, GPS, TV): coax carrying radio.
  { id: 'rf', label: 'RF（アンテナ）', prefix: 'RF', color: '#a16207', dash: '8 4', cable: true, group: 'cable', late: true },
  { id: 'wireless', label: '無線', prefix: 'WL', color: '#64748b', dash: '1 4', cable: false, dashed: true, group: 'medium' },
  { id: 'other', label: 'その他ケーブル', prefix: 'CBL', color: '#1f2937', dash: '', cable: true, group: 'other' },
  // Software boards: how pieces of software talk. Not cables; their port goes in the line's spec.
  { id: 'http', label: 'HTTP(S)', prefix: 'HTTP', color: '#2563eb', dash: '', cable: false, protocol: true, group: 'protocol' },
  { id: 'websocket', label: 'WebSocket', prefix: 'WS', color: '#7c3aed', dash: '', cable: false, protocol: true, group: 'protocol' },
  { id: 'osc', label: 'OSC', prefix: 'OSC', color: '#db2777', dash: '5 3', cable: false, protocol: true, group: 'protocol' },
  { id: 'mqtt', label: 'MQTT', prefix: 'MQTT', color: '#0d9488', dash: '9 3', cable: false, protocol: true, group: 'protocol' },
  { id: 'tcp', label: 'TCP', prefix: 'TCP', color: '#d97706', dash: '', cable: false, protocol: true, group: 'protocol' },
  { id: 'udp', label: 'UDP', prefix: 'UDP', color: '#ea580c', dash: '2 3', cable: false, protocol: true, group: 'protocol' },
  { id: 'ndi', label: 'NDI / 映像ストリーム', prefix: 'NDI', color: '#16a34a', dash: '9 3 2 3', cable: false, protocol: true, group: 'protocol' },
  { id: 'file', label: 'ファイル共有', prefix: 'FILE', color: '#64748b', dash: '1 4', cable: false, protocol: true, group: 'protocol' },
  { id: 'data', label: 'その他の通信', prefix: 'DATA', color: '#1f2937', dash: '6 2 1 2', cable: false, protocol: true, group: 'protocol' },
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
  custom = new Map((list ?? []).filter((s) => !isBuiltInSignal(s.id)).map((s, i) => [s.id, { ...s, dash: DASHES[i % DASHES.length], cable: true, group: 'custom' as const }]));
}
/** The types registered now, in a form `registerSignals` takes back. */
export const customSignals = (): CustomSignal[] => [...custom.values()].map(({ id, label, prefix, color }) => ({ id, label, prefix, color }));
export const signalOf = (id: SignalId): Signal => custom.get(id) ?? byId.get(currentSignal(id)) ?? byId.get('other')!;
export const isSignal = (id: string): boolean => custom.has(id) || byId.has(currentSignal(id));
/**
 * Whether an id is taken by a built-in type a board may not redefine. The protocols of software
 * boards came later than boards' own types: a board that already had a type called "ndi" or "osc"
 * keeps its own, so they do not count here.
 */
export const isBuiltInSignal = (id: string): boolean => {
  const s = byId.get(currentSignal(id));
  return !!s && !s.protocol && !s.late;
};
/** Every type on offer: the built-in ones (less any a board has redefined), then the board's own. */
export const allSignals = (): Signal[] => [...SIGNALS.filter((s) => !custom.has(s.id)), ...custom.values()];

/** Types under their headings, in the order they are offered; headings with nothing in them left out. */
export const groupSignals = (list: Signal[]): { label: string; items: Signal[] }[] =>
  SIGNAL_GROUPS.map((g) => ({ label: g.label, items: list.filter((s) => s.group === g.id) })).filter((g) => g.items.length);

export const PALETTE: Record<ColorKey, { fill: string; stroke: string }> = {
  white: { fill: '#ffffff', stroke: '#b4bfcc' },
  gray: { fill: '#f1f5f9', stroke: '#64748b' },
  blue: { fill: '#dbeafe', stroke: '#3b82f6' },
  green: { fill: '#dcfce7', stroke: '#22c55e' },
  yellow: { fill: '#fef3c7', stroke: '#eab308' },
  orange: { fill: '#ffedd5', stroke: '#f97316' },
  red: { fill: '#fee2e2', stroke: '#ef4444' },
  purple: { fill: '#fae8ff', stroke: '#c026d3' },
};
/** A device with no colour: its header and outline. */
export const PLAIN_DEVICE = { fill: '#e8edf3', stroke: '#334155' };
/** A device's header and outline in a colour: gray is the plain look. */
export const deviceTint = (c: ColorKey): { fill: string; stroke: string } => (c === 'gray' ? PLAIN_DEVICE : PALETTE[c]);
/** What each colour is called in the editor. */
export const COLOR_NAME: Record<ColorKey, string> = {
  white: '白',
  gray: 'グレー',
  blue: '青',
  green: '緑',
  yellow: '黄',
  orange: 'オレンジ',
  red: '赤',
  purple: '紫',
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
  purple: { fill: '#b5179e', text: '#ffffff' },
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
  purple: { fill: '#f3b8f0', stroke: '#d47fcf' },
};
export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[];
