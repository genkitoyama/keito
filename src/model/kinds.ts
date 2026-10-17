import type { Signal } from './signals';
import type { Tool } from './store';
import type { Doc } from './types';

/**
 * Kinds of board. Each project holds boards of several kinds (the system, its software, its
 * sequences, a free board for notes); a kind decides what the board offers — its tools, its
 * library, the types of line, the fields of a device, its lists and checks — so each stays as
 * simple as what it is for. The drawing underneath is the same everywhere.
 */
export type BoardKind = NonNullable<Doc['kind']>;

/** The lists a board can have, by key (see lists.ts). */
export type ListKey = 'equipment' | 'cables' | 'summary' | 'power' | 'network' | 'comms' | 'fixtures' | 'outputs' | 'transitions' | 'check';

export interface KindSpec {
  id: BoardKind;
  label: string;
  /** What it is for, in a line (shown where a board is made). */
  hint: string;
  tools: Tool[];
  /** The library at the side, and what its items are called; none on a board without one. */
  library: { label: string; search: string; set: 'equipment' | 'software' | 'furniture' | 'screens' | 'flow' } | null;
  /** The types a line (or a port) can take on this board. */
  lines: (s: Signal) => boolean;
  /** Lists in the order shown; none, no lists button. */
  lists: ListKey[];
  /** What the lists button says. */
  listsLabel: string;
  /** Board-wide label settings (power lines, cable IDs, lengths …) apply. */
  cableOptions: boolean;
}

const DRAW: Tool[] = ['select', 'pan', 'rect', 'round', 'diamond', 'ellipse', 'cloud', 'sticky', 'text', 'frame'];

export const KINDS: Record<BoardKind, KindSpec> = {
  system: {
    id: 'system',
    label: 'システム図',
    hint: '機材・配線・電源。機材リスト・ケーブル表・電源系統つき',
    tools: [...DRAW, 'sequence'],
    library: { label: '機材', search: '機材を検索…', set: 'equipment' },
    lines: (s) => !s.protocol,
    lists: ['equipment', 'cables', 'summary', 'power', 'network', 'check'],
    listsLabel: '機材・ケーブル表',
    cableOptions: true,
  },
  software: {
    id: 'software',
    label: 'ソフトウェア構成図',
    hint: 'アプリ・サーバー・サービスと、その間の通信（HTTP・OSC・MQTT …）。通信一覧つき',
    tools: [...DRAW, 'sequence'],
    library: { label: '部品', search: 'ソフト部品を検索…', set: 'software' },
    lines: (s) => s.id === 'flow' || !!s.protocol,
    lists: ['comms', 'network', 'check'],
    listsLabel: '通信一覧',
    cableOptions: false,
  },
  sequence: {
    id: 'sequence',
    label: 'シーケンス図',
    hint: '起動手順や通信のやりとりを、テキストで書いて図にする',
    tools: ['select', 'pan', 'sequence', 'sticky', 'text', 'frame'],
    library: null,
    lines: (s) => s.id === 'flow',
    lists: [],
    listsLabel: '',
    cableOptions: false,
  },
  layout: {
    id: 'layout',
    label: '配置図',
    hint: 'バックヤードや会場の平面図。縮尺つきで、机・ラック・機材の位置を実寸で置く',
    tools: ['select', 'pan', 'rect', 'ellipse', 'round', 'cloud', 'sticky', 'text', 'frame'],
    library: { label: '什器', search: '什器を検索…', set: 'furniture' },
    lines: (s) => s.id === 'flow',
    lists: ['fixtures'],
    listsLabel: '配置物一覧',
    cableOptions: false,
  },
  screen: {
    id: 'screen',
    label: '画面レイアウト図',
    hint: 'LED・モニター・プロジェクターの解像度と並び、コンテンツのどの領域をどの出力に送るか',
    tools: ['select', 'pan', 'rect', 'sticky', 'text', 'frame'],
    library: { label: '画面', search: '画面を検索…', set: 'screens' },
    lines: (s) => s.id === 'flow',
    lists: ['outputs'],
    listsLabel: '出力一覧',
    cableOptions: false,
  },
  flow: {
    id: 'flow',
    label: '体験フロー',
    hint: 'インスタレーションの状態と切り替わり（待機 → 検知 → 再生 → 終了）、そのきっかけ',
    tools: ['select', 'pan', 'cloud', 'sticky', 'text', 'frame'],
    library: { label: '状態', search: '', set: 'flow' },
    lines: (s) => s.id === 'flow',
    lists: ['transitions', 'check'],
    listsLabel: '状態遷移表',
    cableOptions: false,
  },
  free: {
    id: 'free',
    label: '自由ボード',
    hint: '種類を決めないホワイトボード。打ち合わせのメモやラフに',
    tools: [...DRAW, 'sequence'],
    library: null,
    lines: (s) => s.id === 'flow',
    lists: [],
    listsLabel: '',
    cableOptions: false,
  },
};

export const KIND_ORDER: BoardKind[] = ['system', 'software', 'sequence', 'flow', 'layout', 'screen', 'free'];

export const kindOf = (doc: Pick<Doc, 'kind'>): KindSpec => KINDS[doc.kind ?? 'system'] ?? KINDS.system;
