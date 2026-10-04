export type SignalId = string;
export type PortSide = 'left' | 'right';
export type ShapeKind = 'rect' | 'round' | 'diamond' | 'ellipse';
export type ColorKey = 'white' | 'gray' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'purple';
export type Arrow = 'none' | 'end' | 'both';

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
}
export interface StickyNode extends Base {
  type: 'sticky';
  color: ColorKey;
}
export interface TextNode extends Base {
  type: 'text';
}
/** Area / location group. Devices whose centre is inside it report it as their location. */
export interface FrameNode extends Base {
  type: 'frame';
}
/** `text` is the device name. Height is derived from the port count. */
export interface DeviceNode extends Base {
  type: 'device';
  maker: string;
  model: string;
  category: string;
  note: string;
  ports: Port[];
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
export type Node = ShapeNode | StickyNode | TextNode | FrameNode | DeviceNode | SequenceNode | ImageNode;
/** Nodes whose `text` is edited in place on the canvas. */
export const hasText = (n: Node): boolean => n.type !== 'sequence' && n.type !== 'image';
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
}

export interface DocMeta {
  title: string;
  project: string;
  drawingNo: string;
  author: string;
  rev: string;
  company: string;
}

export interface Doc {
  version: 1;
  id: string;
  meta: DocMeta;
  nodes: Node[];
  edges: Edge[];
}

export const emptyMeta = (title = '無題のボード'): DocMeta => ({
  title,
  project: '',
  drawingNo: '',
  author: '',
  rev: 'A',
  company: '',
});
