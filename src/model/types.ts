export type SignalId = string;
export type PortSide = 'left' | 'right';
export type ShapeKind = 'rect' | 'round' | 'diamond' | 'ellipse' | 'cloud';
export type ColorKey = 'white' | 'gray' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'purple';
export type Arrow = 'none' | 'end' | 'both';
/** tint: pale fill + coloured border (default) / solid: full-strength fill / outline: white fill / none: see-through. */
export type FillStyle = 'tint' | 'solid' | 'outline' | 'none';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect extends Pt {
  w: number;
  h: number;
}

export interface Port {
  id: string;
  name: string;
  side: PortSide;
  signal: SignalId;
}

interface Base extends Rect {
  id: string;
  text: string;
}
export interface ShapeNode extends Base {
  type: 'shape';
  shape: ShapeKind;
  color: ColorKey;
  /** Font size in px (default 14). */
  fontSize?: number;
  /** Bold text; unset = this kind of node's usual weight. */
  bold?: boolean;
  fill?: FillStyle;
  /** Dashed border. */
  dash?: boolean;
}
export interface StickyNode extends Base {
  type: 'sticky';
  color: ColorKey;
  /** Font size in px (default 13.5). */
  fontSize?: number;
  /** Bold text; unset = this kind of node's usual weight. */
  bold?: boolean;
}
export interface TextNode extends Base {
  type: 'text';
  /** Font size in px (default 14); 20 and up is bold unless `bold` says otherwise. */
  fontSize?: number;
  /** Bold text; unset = this kind of node's usual weight. */
  bold?: boolean;
}
/** Area / location group. Devices whose centre is inside it report it as their location. */
export interface FrameNode extends Base {
  type: 'frame';
  /** Tint of the frame's outline, wash and title; unset or gray is the neutral look. */
  color?: ColorKey;
  /** Title font size in px (default 13). */
  fontSize?: number;
  /** Title weight; unset = bold. */
  bold?: boolean;
}
/** `text` is the device name. Height is derived from the port count. */
export interface DeviceNode extends Base {
  type: 'device';
  maker: string;
  model: string;
  category: string;
  note: string;
  ports: Port[];
  /** Power draw in watts. */
  watts?: number;
  /** Power this device can supply (UPS, power strip) in watts. */
  capacity?: number;
  /** Web page for this model (product page, manual …), as typed. */
  url?: string;
  /** Tint for colour-coding devices (who supplies it, which system it belongs to …). */
  color?: ColorKey;
}
/** `text` is the sequence source. Size is derived from the parsed diagram. */
export interface SequenceNode extends Base {
  type: 'sequence';
}
/** Embedded picture (raster or SVG) as a data URL. `text` is its name. */
export interface ImageNode extends Base {
  type: 'image';
  src: string;
}
/** A dot where lines meet: a line splits here into several, or several join into one. */
export interface JunctionNode extends Base {
  type: 'junction';
}
export type Node = ShapeNode | StickyNode | TextNode | FrameNode | DeviceNode | SequenceNode | ImageNode | JunctionNode;
/** Nodes whose `text` is edited in place on the canvas. */
export const hasText = (n: Node): boolean => n.type !== 'sequence' && n.type !== 'image' && n.type !== 'junction';
export type NodeType = Node['type'];

export interface EdgeEnd {
  node: string;
  port?: string;
}
export interface Edge {
  id: string;
  from: EdgeEnd;
  to: EdgeEnd;
  signal: SignalId;
  label: string;
  /** Cable length in metres. */
  length: number | null;
  arrow: Arrow;
  note: string;
  /** Dashed line on the board (e.g. optional / future connections). */
  dash?: boolean;
  /** Cable ID typed by hand; unset = numbered automatically (HDMI-01 …). */
  cableId?: string;
  /** Whether the cable ID is part of the line's label; unset = the board's setting. */
  showId?: boolean;
  /** Whether the length is part of the label; unset = the board's setting. */
  showLength?: boolean;
  /** Label items (ID, spec, text, length) each on a line of their own; unset = the board's setting. */
  stacked?: boolean;
  /** What the cable is: product name or standard ("光 HDMI AOC", "Cat6A STP"). Shown in its label. */
  spec?: string;
  maker?: string;
  model?: string;
  /** Web page for the cable (product page …), as typed. */
  url?: string;
  /** Colour of this line alone (hex); unset = the colour of its signal type. */
  color?: string;
  /** Where the label sits along the line, 0–1 from the start (default: the middle). */
  labelAt?: number;
  /** Hand-placed bend points between the two ends; absent = routed automatically. */
  route?: Pt[];
  /** Draw as a pair of labelled tags instead of a line. Unset: power cables follow the board setting. */
  tag?: boolean;
}

export interface DocMeta {
  title: string;
  project: string;
  drawingNo: string;
  author: string;
  rev: string;
  company: string;
}

/** A device the user saved to reuse: everything about it except where it sits. */
export interface UserPreset {
  id: string;
  name: string;
  category: string;
  maker: string;
  model: string;
  note: string;
  w: number;
  ports: Port[];
  watts?: number;
  capacity?: number;
  url?: string;
  color?: ColorKey;
}

/** A signal type defined on one board, beside the built-in ones (HDBaseT, Dante, 12G-SDI …). */
export interface CustomSignal {
  id: SignalId;
  label: string;
  /** Cable ID prefix, e.g. HDB-01. */
  prefix: string;
  color: string;
}

/** One recorded revision of a board. The drawing as it stood is kept beside the board, under `id`. */
export interface Revision {
  id: string;
  /** Revision mark shown on the drawing (A, B, …). */
  rev: string;
  /** YYYY-MM-DD. */
  date: string;
  note: string;
  author: string;
}

export interface Doc {
  version: 1;
  id: string;
  meta: DocMeta;
  nodes: Node[];
  edges: Edge[];
  /** Cable IDs in line labels (default on); a line's own `showId` wins. */
  cableIdLabels?: boolean;
  /** Cable lengths in line labels (default on); a line's own `showLength` wins. */
  lengthLabels?: boolean;
  /** Label items one per line instead of side by side (default off); a line's own `stacked` wins. */
  stackedLabels?: boolean;
  /** Signal types added on this board. */
  signals?: CustomSignal[];
  /** Recorded revisions, oldest first. */
  revisions?: Revision[];
  /** Colours chosen on this board for signal types, by signal id (hex). */
  signalColors?: Record<string, string>;
  /** Show power cables as tags at both ends rather than lines (default on). */
  powerTags?: boolean;
}

export const emptyMeta = (title = '無題のボード'): DocMeta => ({
  title,
  project: '',
  drawingNo: '',
  author: '',
  rev: 'A',
  company: '',
});
