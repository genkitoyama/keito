import type { ColorKey, DeviceNode, Doc, Edge, Node, Port, ShapeKind } from './types';

export interface Preset {
  key: string;
  name: string;
  category: string;
  /** Ports as "名前:種別". `in` goes on the left, `out` on the right. */
  in: string[];
  out: string[];
}

export const PRESETS: Preset[] = [
  { key: 'pc', name: 'PC', category: 'PC', in: ['LAN:lan', 'USB:usb', 'AC:power'], out: ['HDMI 1:hdmi', 'HDMI 2:hdmi', 'DP:dp'] },
  { key: 'mac', name: 'Mac', category: 'PC', in: ['LAN:lan', 'USB-C:usb', 'AC:power'], out: ['HDMI:hdmi', 'TB 1:dp', 'TB 2:dp'] },
  { key: 'player', name: 'メディアプレーヤー', category: '再生機', in: ['LAN:lan', 'AC:power'], out: ['HDMI:hdmi', 'AUDIO:audio'] },
  { key: 'pj', name: 'プロジェクター', category: '映像表示', in: ['HDMI:hdmi', 'SDI:sdi', 'HDBaseT:lan', 'LAN:lan', 'AC:power'], out: [] },
  { key: 'display', name: 'ディスプレイ', category: '映像表示', in: ['HDMI 1:hdmi', 'HDMI 2:hdmi', 'RS-232C:serial', 'AC:power'], out: [] },
  { key: 'ledproc', name: 'LEDプロセッサ', category: '映像表示', in: ['HDMI:hdmi', 'SDI:sdi', 'LAN:lan', 'AC:power'], out: ['PORT 1:lan', 'PORT 2:lan', 'PORT 3:lan', 'PORT 4:lan'] },
  { key: 'led', name: 'LEDウォール', category: '映像表示', in: ['DATA:lan', 'AC:power'], out: [] },
  { key: 'switcher', name: 'スイッチャー', category: '映像処理', in: ['IN 1:hdmi', 'IN 2:hdmi', 'IN 3:hdmi', 'IN 4:hdmi', 'LAN:lan'], out: ['PGM:hdmi', 'AUX:hdmi', 'MV:hdmi'] },
  { key: 'matrix', name: 'マトリクススイッチャー', category: '映像処理', in: ['IN 1:hdmi', 'IN 2:hdmi', 'IN 3:hdmi', 'IN 4:hdmi', 'LAN:lan'], out: ['OUT 1:hdmi', 'OUT 2:hdmi', 'OUT 3:hdmi', 'OUT 4:hdmi'] },
  { key: 'da', name: '分配器', category: '映像処理', in: ['IN:hdmi'], out: ['OUT 1:hdmi', 'OUT 2:hdmi', 'OUT 3:hdmi', 'OUT 4:hdmi'] },
  { key: 'conv', name: 'コンバーター', category: '映像処理', in: ['SDI IN:sdi'], out: ['HDMI OUT:hdmi'] },
  { key: 'tx', name: 'エクステンダー TX', category: '延長器', in: ['HDMI IN:hdmi'], out: ['HDBaseT:lan'] },
  { key: 'rx', name: 'エクステンダー RX', category: '延長器', in: ['HDBaseT:lan'], out: ['HDMI OUT:hdmi'] },
  { key: 'capture', name: 'キャプチャー', category: '映像処理', in: ['HDMI IN:hdmi'], out: ['USB:usb', 'LOOP:hdmi'] },
  { key: 'cam', name: 'カメラ', category: 'カメラ', in: ['LAN:lan', 'DC:power'], out: ['SDI:sdi', 'HDMI:hdmi'] },
  { key: 'webcam', name: 'Webカメラ', category: 'カメラ', in: [], out: ['USB:usb'] },
  { key: 'depth', name: '深度カメラ', category: 'センサー', in: ['DC:power'], out: ['USB:usb'] },
  { key: 'lidar', name: 'LiDAR', category: 'センサー', in: ['DC:power'], out: ['LAN:lan'] },
  { key: 'sensor', name: 'センサー', category: 'センサー', in: ['DC:power'], out: ['SIG:serial'] },
  { key: 'mcu', name: 'マイコン', category: '制御', in: ['USB:usb', 'GPIO IN:serial'], out: ['GPIO OUT:serial', 'DMX:dmx'] },
  { key: 'sw', name: 'L2スイッチ', category: 'ネットワーク', in: ['UPLINK:lan', 'AC:power'], out: ['PORT 1:lan', 'PORT 2:lan', 'PORT 3:lan', 'PORT 4:lan', 'PORT 5:lan', 'PORT 6:lan', 'PORT 7:lan'] },
  { key: 'router', name: 'ルーター', category: 'ネットワーク', in: ['WAN:lan', 'AC:power'], out: ['LAN 1:lan', 'LAN 2:lan', 'LAN 3:lan', 'LAN 4:lan'] },
  { key: 'ap', name: 'Wi-Fi AP', category: 'ネットワーク', in: ['LAN/PoE:lan'], out: ['Wi-Fi:wireless'] },
  { key: 'tablet', name: 'タブレット', category: '操作端末', in: ['Wi-Fi:wireless', 'USB-C:usb'], out: [] },
  { key: 'touch', name: 'タッチモニター', category: '操作端末', in: ['HDMI:hdmi', 'AC:power'], out: ['USB:usb'] },
  { key: 'streamdeck', name: 'Stream Deck', category: '操作端末', in: [], out: ['USB:usb'] },
  { key: 'audioif', name: 'オーディオIF', category: '音響', in: ['USB:usb', 'MIC 1:audio', 'MIC 2:audio'], out: ['OUT L:audio', 'OUT R:audio'] },
  { key: 'mixer', name: 'ミキサー', category: '音響', in: ['CH 1:audio', 'CH 2:audio', 'CH 3:audio', 'CH 4:audio', 'USB:usb'], out: ['MAIN L:audio', 'MAIN R:audio', 'AUX:audio'] },
  { key: 'amp', name: 'パワーアンプ', category: '音響', in: ['IN L:audio', 'IN R:audio', 'AC:power'], out: ['SP L:audio', 'SP R:audio'] },
  { key: 'speaker', name: 'スピーカー', category: '音響', in: ['IN:audio', 'AC:power'], out: [] },
  { key: 'mic', name: 'マイク', category: '音響', in: [], out: ['OUT:audio'] },
  { key: 'dmxnode', name: 'DMXノード', category: '照明', in: ['LAN:lan', 'AC:power'], out: ['DMX 1:dmx', 'DMX 2:dmx'] },
  { key: 'light', name: '照明器具', category: '照明', in: ['DMX IN:dmx', 'AC:power'], out: ['DMX THRU:dmx'] },
  { key: 'tap', name: '電源タップ', category: '電源', in: ['AC IN:power'], out: ['AC 1:power', 'AC 2:power', 'AC 3:power', 'AC 4:power', 'AC 5:power', 'AC 6:power'] },
  { key: 'ups', name: 'UPS', category: '電源', in: ['AC IN:power'], out: ['AC 1:power', 'AC 2:power', 'AC 3:power', 'AC 4:power'] },
  { key: 'blank', name: '機材', category: '', in: ['IN:other'], out: ['OUT:other'] },
];

export const presetOf = (key: string): Preset | undefined => PRESETS.find((p) => p.key === key);

export const allIds = (doc: Doc): Set<string> => {
  const ids = new Set<string>();
  for (const n of doc.nodes) {
    ids.add(n.id);
    if (n.type === 'device') for (const p of n.ports) ids.add(`${n.id}/${p.id}`);
  }
  for (const e of doc.edges) ids.add(e.id);
  return ids;
};

/** Short human-readable id (also used as the handle in the YAML text form). */
export function freshId(taken: Set<string>, prefix: string): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

export const randomId = (): string => Math.random().toString(36).slice(2, 10);

/** "HDMI 1:hdmi" → port. */
export function parsePort(spec: string, side: Port['side'], id: string): Port {
  const i = spec.lastIndexOf(':');
  const name = (i < 0 ? spec : spec.slice(0, i)).trim();
  const signal = i < 0 ? 'other' : spec.slice(i + 1).trim().toLowerCase();
  return { id, name, side, signal };
}

export function presetPorts(p: Preset): Port[] {
  let n = 0;
  return [
    ...p.in.map((s) => parsePort(s, 'left', `p${++n}`)),
    ...p.out.map((s) => parsePort(s, 'right', `p${++n}`)),
  ];
}

export function makeDevice(preset: Preset, x: number, y: number, taken: Set<string>): DeviceNode {
  return {
    id: freshId(taken, preset.key === 'blank' ? 'dev' : preset.key),
    type: 'device',
    x,
    y,
    w: 180,
    h: 0,
    text: preset.name,
    maker: '',
    model: '',
    category: preset.category,
    note: '',
    ports: presetPorts(preset),
  };
}

export type CreateKind = ShapeKind | 'sticky' | 'text' | 'frame' | 'sequence';

const SIZE: Record<CreateKind, [number, number]> = {
  rect: [140, 60],
  round: [140, 50],
  diamond: [150, 90],
  ellipse: [140, 70],
  sticky: [160, 120],
  text: [160, 40],
  frame: [460, 320],
  sequence: [0, 0],
};

export function makeNode(kind: CreateKind, cx: number, cy: number, taken: Set<string>, text = '', color?: ColorKey): Node {
  const [w, h] = SIZE[kind];
  const base = { x: cx - w / 2, y: cy - h / 2, w, h, text };
  if (kind === 'sticky') return { ...base, id: freshId(taken, 'note'), type: 'sticky', color: color ?? 'yellow' };
  if (kind === 'text') return { ...base, id: freshId(taken, 'txt'), type: 'text' };
  if (kind === 'frame') return { ...base, id: freshId(taken, 'area'), type: 'frame', text: text || 'エリア' };
  if (kind === 'sequence') return { ...base, x: cx, y: cy, id: freshId(taken, 'seq'), type: 'sequence' };
  return { ...base, id: freshId(taken, 'n'), type: 'shape', shape: kind, color: color ?? 'white' };
}

export function makeEdge(taken: Set<string>, from: Edge['from'], to: Edge['to'], signal: string): Edge {
  return {
    id: freshId(taken, 'e'),
    from,
    to,
    signal,
    label: '',
    length: null,
    arrow: signal === 'flow' ? 'end' : 'none',
    note: '',
  };
}
