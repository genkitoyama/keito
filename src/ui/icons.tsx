import type { ReactNode } from 'react';
import { PALETTE, STRONG } from '../model/signals';
import type { ColorKey, FillStyle, Node, ShapeKind } from '../model/types';

/** 20×20 line icon drawn in the current text colour. */
export const ico = (d: ReactNode) => (
  <svg className="ico" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

export const SHAPES: { id: ShapeKind; label: string; icon: ReactNode }[] = [
  { id: 'rect', label: '四角', icon: ico(<rect x="3" y="5" width="14" height="10" rx="1.5" />) },
  { id: 'round', label: '開始・終了（角丸）', icon: ico(<rect x="3" y="6" width="14" height="8" rx="4" />) },
  { id: 'diamond', label: '判断', icon: ico(<path d="M10 3l7 7-7 7-7-7z" />) },
  { id: 'ellipse', label: '楕円', icon: ico(<ellipse cx="10" cy="10" rx="7" ry="5" />) },
  { id: 'cloud', label: '雲', icon: ico(<path d="M6 15a3.5 3.5 0 0 1-.6-6.95A4.5 4.5 0 0 1 14 7.2 3.9 3.9 0 0 1 14.2 15z" />) },
];
export const shapeIcon = (id: ShapeKind): ReactNode => SHAPES.find((s) => s.id === id)?.icon;

export const ICON = {
  undo: ico(<path d="M7 11.5L3 7.5l4-4M3 7.5h9a4.5 4.5 0 0 1 0 9H9" />),
  redo: ico(<path d="M13 11.5l4-4-4-4M17 7.5H8a4.5 4.5 0 0 0 0 9h3" />),
  hand: ico(
    <g transform="scale(0.8333)" strokeWidth="1.9">
      <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </g>,
  ),
  text: ico(<path d="M4.5 5.5V4h11v1.5M10 4v12M8 16h4" />),
  /** A small and a large letter: text size. */
  size: ico(<path d="M2.5 15l2.4-6 2.4 6M3.4 12.8h3M9 15l3.6-10 3.6 10M10.3 11.5h4.6" />),
  link: ico(<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />),
  bold: ico(<path d="M6 4h5a3 3 0 0 1 0 6H6zM6 10h6a3 3 0 0 1 0 6H6z" strokeWidth="2.2" />),
  duplicate: ico(
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
      <path d="M12.5 7.5V5A1.5 1.5 0 0 0 11 3.5H5A1.5 1.5 0 0 0 3.5 5v6A1.5 1.5 0 0 0 5 12.5h2.5" />
    </>,
  ),
  trash: ico(<path d="M3.5 6h13M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6M8.5 9v5M11.5 9v5" />),
  dashedBox: ico(<rect x="3.5" y="4.5" width="13" height="11" rx="1.5" strokeDasharray="3 2.4" />),
  lineSolid: ico(<path d="M3 10h14" strokeWidth="2" />),
  lineDashed: ico(<path d="M3 10h14" strokeWidth="2" strokeDasharray="3 2.6" />),
  /** A line cut in two: "don't draw this cable, just name what is at each end". */
  omit: ico(<path d="M2.5 10h4.5M7 7v6M13 7v6M13 10h4.5" />),
  plus: ico(<path d="M10 4v12M4 10h12" />),
  folder: ico(<path d="M2.5 6V4.5a1 1 0 0 1 1-1h4l1.5 2h7.5a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" />),
  table: ico(
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M2.5 8h15M2.5 12.25h15M7.5 8v8.5" />
    </>,
  ),
  comment: ico(<path d="M3.5 4.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-3.5 3v-3h-2a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />),
  tidy: ico(<path d="M3 5h9M3 10h14M3 15h6M15 3l.6 1.4L17 5l-1.4.6L15 7l-.6-1.4L13 5l1.4-.6zM13.5 13l.45 1.05L15 14.5l-1.05.45L13.5 16l-.45-1.05L12 14.5l1.05-.45z" />),
  download: ico(<path d="M10 3v9.5M6 8.5l4 4 4-4M4 15.5v1h12v-1" />),
  close: ico(<path d="M5 5l10 10M15 5L5 15" />),
  reset: ico(<path d="M2.5 10a7.5 7.5 0 1 0 7.5-7.5 8.1 8.1 0 0 0-5.6 2.3L2.5 6.7M2.5 2.5v4.2h4.2" />),
  caret: (
    <svg className="caret" width="8" height="5" viewBox="0 0 8 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l3 3 3-3" />
    </svg>
  ),
};

export { COLOR_NAME } from '../model/signals';

/** Font sizes on offer. `px: undefined` is the node's built-in size. */
export interface SizeOption {
  px: number | undefined;
  label: string;
}
/** Free text doubles as headings; text inside shapes and stickies just gets smaller or larger. */
export const sizesFor = (type: Node['type']): SizeOption[] =>
  type === 'sequence'
    ? [
        { px: undefined, label: '標準' },
        { px: 14, label: '大' },
        { px: 18, label: '特大' },
        { px: 24, label: 'タイトル' },
      ]
    : type === 'text'
    ? [
        { px: undefined, label: '標準' },
        { px: 20, label: '中見出し' },
        { px: 28, label: '大見出し' },
        { px: 40, label: 'タイトル' },
      ]
    : type === 'frame'
      ? [
          { px: undefined, label: '標準' },
          { px: 18, label: '大' },
          { px: 24, label: '特大' },
          { px: 32, label: 'タイトル' },
        ]
      : [
        { px: 11, label: '小' },
        { px: undefined, label: '標準' },
        { px: 18, label: '大' },
        { px: 24, label: '特大' },
      ];

export const FILLS: { id: FillStyle; label: string; short: string }[] = [
  { id: 'tint', label: '淡い塗り', short: '淡い' },
  { id: 'solid', label: 'ベタ塗り', short: 'ベタ' },
  { id: 'outline', label: '白地に枠線', short: '白地' },
  { id: 'none', label: '塗りなし（透過）', short: '透過' },
];

/**
 * A miniature of the shape as it will look with this fill, in its own colour:
 * the checkerboard is the see-through one, and the letter shows what happens
 * to the text. Reads at a glance where an abstract glyph does not.
 */
export function FillPreview({ fill, color, dash }: { fill: FillStyle; color: ColorKey; dash?: boolean }) {
  const strong = STRONG[color];
  const c = fill === 'tint' ? PALETTE[color] : fill === 'solid' ? { fill: strong.fill, stroke: strong.fill } : { fill: '#ffffff', stroke: strong.fill };
  const cells: ReactNode[] = [];
  if (fill === 'none') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) cells.push(<rect key={`${i}${j}`} x={2 + i * 5} y={2 + j * 4.67} width={5} height={4.67} fill="#c3ccd8" />);
  }
  return (
    <svg className="fill-preview" width="24" height="18" viewBox="0 0 24 18">
      <rect x="1.5" y="1.5" width="21" height="15" rx="3" fill={c.fill} />
      {cells}
      <rect x="1.5" y="1.5" width="21" height="15" rx="3" fill="none" stroke={c.stroke} strokeWidth="1.8" strokeDasharray={dash ? '3.2 2.4' : undefined} />
      <text x="12" y="12.5" textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="-apple-system, sans-serif" fill={fill === 'solid' ? strong.text : '#27323f'}>
        A
      </text>
    </svg>
  );
}
