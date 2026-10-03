import type { ColorKey, SignalId } from './types';

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
  { id: 'hdmi', label: 'HDMI', prefix: 'HDMI', color: '#2563eb', dash: '', cable: true },
  { id: 'sdi', label: 'SDI', prefix: 'SDI', color: '#16a34a', dash: '9 3', cable: true },
  { id: 'dp', label: 'DisplayPort', prefix: 'DP', color: '#7c3aed', dash: '9 3 2 3', cable: true },
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
export const signalOf = (id: SignalId): Signal => byId.get(id) ?? byId.get('other')!;
export const isSignal = (id: string): boolean => byId.has(id);

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
export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[];
