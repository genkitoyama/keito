import { Document, isScalar, parse, visit } from 'yaml';
import { docBounds, frameOf } from './geometry';
import { autoLayout } from './layout';
import { freshId, makeEdge, parsePort, presetOf, presetPorts } from './presets';
import { isSignal } from './signals';
import type { ColorKey, DeviceNode, Doc, Edge, EdgeEnd, FillStyle, FrameNode, Node, ShapeKind } from './types';
import { PALETTE } from './signals';

/** Schema reference shown in the editor and given to the AI. */
export const DSL_GUIDE = `# keito YAML 書式
title: 図のタイトル
project: 案件名            # 任意。drawingNo / author / rev / company も同様
areas:                     # 設置場所の枠（任意）
  - name: 制御室
    rect: [x, y, w, h]     # 省略すると所属機材から自動計算
devices:
  - id: pc1                # 英数字の短いID（"." は不可）。cables から参照する
    name: メインPC
    maker: Apple           # 任意
    model: Mac Studio      # 任意
    category: PC           # 任意
    area: 制御室           # 任意。自動レイアウト時にこの枠へまとめる
    note: 備考             # 任意
    preset: pc             # 任意。in/out を省略したときの既定ポート
    in:  [LAN:lan, AC:power]          # 左側ポート "名前:種別"
    out: ["HDMI 1:hdmi", DP:dp]       # 右側ポート
    pos: [x, y]            # 省略すると自動レイアウト
cables:
  - from: pc1.HDMI 1       # 機材ID.ポート名（無いポートは自動追加）
    to: pj1.HDMI
    type: hdmi             # hdmi sdi dp lan usb audio power fiber dmx serial wireless other
    length: 10             # m、任意
    label: メイン映像      # 任意
shapes:                    # フローチャート・付箋
  - id: s1
    shape: rect            # rect round diamond ellipse cloud(コメント用の雲) sticky text
    text: 開始
    color: blue            # white gray blue green yellow orange red purple
    fill: solid            # 任意。tint(既定・淡色) solid(ベタ塗り。red で真っ赤) outline(白地) none(透過)
    dash: true             # 任意。枠を点線に（cables / flows でも dash: true で点線）
flows:                     # 矢印コネクタ（shapes / devices どちらも可）
  - { from: s1, to: s2, label: はい }
images:                    # 埋め込み画像。データ本体は id で引き継がれる（src に data URL / URL も可）
  - { id: img1, name: logo, pos: [x, y], size: [w, h] }
sequences:
  - id: seq1
    text: |
      title: 起動シーケンス
      participant PC as 制御PC
      PC -> PJ: 電源ON
      PJ --> PC: OK
      note over PJ: ウォームアップ
`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (v == null ? d : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nums = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => typeof x === 'number' && isFinite(x))
    ? (v.slice(0, n) as number[])
    : null;
const put = (o: Obj, key: string, v: unknown): void => {
  if (v !== '' && v != null) o[key] = v;
};
const r = Math.round;

function refOf(doc: Doc, end: EdgeEnd): string {
  const n = doc.nodes.find((x) => x.id === end.node);
  const port = n?.type === 'device' && end.port ? n.ports.find((p) => p.id === end.port) : undefined;
  return port ? `${end.node}.${port.name}` : end.node;
}

export function toYaml(doc: Doc): string {
  const out: Obj = { title: doc.meta.title };
  for (const k of ['project', 'drawingNo', 'author', 'rev', 'company'] as const) put(out, k, doc.meta[k]);

  const frames = doc.nodes.filter((n) => n.type === 'frame');
  if (frames.length) out.areas = frames.map((f) => ({ name: f.text, rect: [r(f.x), r(f.y), r(f.w), r(f.h)] }));

  const devices = doc.nodes.filter((n): n is DeviceNode => n.type === 'device');
  if (devices.length) {
    out.devices = devices.map((d) => {
      const o: Obj = { id: d.id, name: d.text };
      put(o, 'maker', d.maker);
      put(o, 'model', d.model);
      put(o, 'category', d.category);
      put(o, 'area', frameOf(doc, d)?.text);
      put(o, 'note', d.note);
      o.in = d.ports.filter((p) => p.side === 'left').map((p) => `${p.name}:${p.signal}`);
      o.out = d.ports.filter((p) => p.side === 'right').map((p) => `${p.name}:${p.signal}`);
      o.pos = [r(d.x), r(d.y)];
      if (d.w !== 180) o.width = r(d.w);
      return o;
    });
  }

  const cables = doc.edges.filter((e) => e.signal !== 'flow');
  if (cables.length) {
    out.cables = cables.map((e) => {
      const o: Obj = { from: refOf(doc, e.from), to: refOf(doc, e.to), type: e.signal };
      put(o, 'length', e.length);
      put(o, 'label', e.label);
      put(o, 'note', e.note);
      if (e.arrow !== 'none') o.arrow = e.arrow;
      if (e.dash) o.dash = true;
      return o;
    });
  }

  const shapes = doc.nodes.filter((n) => n.type === 'shape' || n.type === 'sticky' || n.type === 'text');
  if (shapes.length) {
    out.shapes = shapes.map((s) => {
      const o: Obj = { id: s.id, shape: s.type === 'shape' ? s.shape : s.type, text: s.text };
      if (s.type !== 'text') put(o, 'color', s.color);
      if (s.type === 'shape') {
        if (s.fill && s.fill !== 'tint') o.fill = s.fill;
        if (s.dash) o.dash = true;
      }
      o.pos = [r(s.x), r(s.y)];
      o.size = [r(s.w), r(s.h)];
      return o;
    });
  }

  const flows = doc.edges.filter((e) => e.signal === 'flow');
  if (flows.length) {
    out.flows = flows.map((e) => {
      const o: Obj = { from: refOf(doc, e.from), to: refOf(doc, e.to) };
      put(o, 'label', e.label);
      if (e.arrow !== 'end') o.arrow = e.arrow;
      if (e.dash) o.dash = true;
      return o;
    });
  }

  const seqs = doc.nodes.filter((n) => n.type === 'sequence');
  if (seqs.length) out.sequences = seqs.map((s) => ({ id: s.id, pos: [r(s.x), r(s.y)], text: s.text }));

  // Pictures are listed without their data so the text stays readable; applying
  // the YAML keeps each picture by id.
  const images = doc.nodes.filter((n) => n.type === 'image');
  if (images.length) out.images = images.map((n) => ({ id: n.id, name: n.text, pos: [r(n.x), r(n.y)], size: [r(n.w), r(n.h)] }));

  const y = new Document(out);
  // Keep coordinate pairs and port lists on one line.
  visit(y, {
    Seq(_, node) {
      if (node.items.length && node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
  return y.toString({ lineWidth: 0 });
}

const SHAPES: ShapeKind[] = ['rect', 'round', 'diamond', 'ellipse', 'cloud'];
const DEFAULT_SIZE: Record<string, [number, number]> = {
  rect: [140, 60],
  round: [140, 50],
  diamond: [150, 90],
  ellipse: [140, 70],
  cloud: [180, 100],
  sticky: [160, 160],
  text: [160, 40],
};

/**
 * Build a doc from YAML. Nodes without `pos` keep their position from `prev`
 * (matched by id) unless `relayout`; anything still unplaced is auto-laid-out.
 */
export function fromYaml(src: string, prev: Doc, relayout = false): Doc {
  const root = parse(src);
  if (!isObj(root)) throw new Error('YAML のトップレベルはマップ（title: … など）にしてください');

  const taken = new Set<string>();
  const prevById = new Map(prev.nodes.map((n) => [n.id, n]));
  const nodes: Node[] = [];
  const unplaced = new Set<string>();
  const areaHint = new Map<string, string>();

  const claim = (raw: unknown, prefix: string, where: string): string => {
    let id = str(raw).trim();
    if (!id) return freshId(taken, prefix);
    if (id.includes('.')) id = id.replace(/\./g, '_');
    if (taken.has(id)) throw new Error(`${where}: id "${id}" が重複しています`);
    taken.add(id);
    return id;
  };
  const place = (id: string, pos: unknown): { x: number; y: number } => {
    const p = relayout ? null : nums(pos, 2);
    if (p) return { x: p[0], y: p[1] };
    const old = relayout ? undefined : prevById.get(id);
    if (old) return { x: old.x, y: old.y };
    unplaced.add(id);
    return { x: 0, y: 0 };
  };

  arr(root.devices).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`devices[${i}]: マップではありません`);
    const preset = presetOf(str(v.preset));
    const id = claim(v.id, preset?.key ?? 'dev', `devices[${i}]`);
    let n = 0;
    const ports =
      v.in === undefined && v.out === undefined && preset
        ? presetPorts(preset)
        : [
            ...arr(v.in).map((s) => parsePort(str(s), 'left', `p${++n}`)),
            ...arr(v.out).map((s) => parsePort(str(s), 'right', `p${++n}`)),
          ];
    const old = prevById.get(id);
    nodes.push({
      id,
      type: 'device',
      ...place(id, v.pos),
      w: typeof v.width === 'number' ? v.width : old?.type === 'device' ? old.w : 180,
      h: 0,
      text: str(v.name, preset?.name ?? id),
      maker: str(v.maker),
      model: str(v.model),
      category: str(v.category, preset?.category ?? ''),
      note: str(v.note),
      ports,
    });
    if (v.area) areaHint.set(id, str(v.area));
  });

  arr(root.shapes).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`shapes[${i}]: マップではありません`);
    const kind = str(v.shape, 'rect');
    const id = claim(v.id, kind === 'sticky' ? 'note' : 'n', `shapes[${i}]`);
    const old = relayout ? undefined : prevById.get(id);
    const size = nums(v.size, 2) ?? (old && old.type !== 'device' && old.type !== 'image' ? [old.w, old.h] : DEFAULT_SIZE[kind] ?? DEFAULT_SIZE.rect);
    const base = { id, ...place(id, v.pos), w: size[0], h: size[1], text: str(v.text) };
    const color = (str(v.color) in PALETTE ? str(v.color) : undefined) as ColorKey | undefined;
    if (kind === 'sticky') nodes.push({ ...base, type: 'sticky', color: color ?? 'yellow' });
    else if (kind === 'text') nodes.push({ ...base, type: 'text' });
    else {
      const fill = ['solid', 'outline', 'none'].includes(str(v.fill)) ? (str(v.fill) as FillStyle) : undefined;
      nodes.push({ ...base, type: 'shape', shape: SHAPES.includes(kind as ShapeKind) ? (kind as ShapeKind) : 'rect', color: color ?? 'white', fill, dash: v.dash === true || undefined });
    }
    if (v.area) areaHint.set(id, str(v.area));
  });

  arr(root.sequences).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`sequences[${i}]: マップではありません`);
    const id = claim(v.id, 'seq', `sequences[${i}]`);
    nodes.push({ id, type: 'sequence', ...place(id, v.pos), w: 0, h: 0, text: str(v.text).trimEnd() });
  });

  arr(root.images).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`images[${i}]: マップではありません`);
    const old = prevById.get(str(v.id));
    const src = str(v.src) || (old?.type === 'image' ? old.src : '');
    if (!src) return;
    const id = claim(v.id, 'img', `images[${i}]`);
    const size = nums(v.size, 2) ?? (old ? [old.w, old.h] : [200, 150]);
    nodes.push({ id, type: 'image', ...place(id, v.pos), w: size[0], h: size[1], text: str(v.name), src });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: Edge[] = [];
  const resolve = (ref: unknown, where: string, side: 'left' | 'right', signal: string): EdgeEnd => {
    // NFKC folds full-width alphanumerics / spaces / dots typed with an IME.
    const s = str(ref).normalize('NFKC').trim();
    const dot = s.indexOf('.');
    const nodeId = dot < 0 ? s : s.slice(0, dot);
    const portName = dot < 0 ? '' : s.slice(dot + 1).trim();
    const node = byId.get(nodeId);
    if (!node) throw new Error(`${where}: "${nodeId}" という id の要素がありません`);
    if (node.type !== 'device' || !portName) return { node: nodeId };
    let port = node.ports.find((p) => p.name.normalize('NFKC').toLowerCase() === portName.toLowerCase());
    if (!port) {
      port = { id: freshId(new Set(node.ports.map((p) => p.id)), 'p'), name: portName, side, signal };
      node.ports.push(port);
    }
    return { node: nodeId, port: port.id };
  };
  const portSignal = (end: EdgeEnd): string | undefined => {
    const n = byId.get(end.node);
    return n?.type === 'device' ? n.ports.find((p) => p.id === end.port)?.signal : undefined;
  };

  arr(root.cables).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`cables[${i}]: マップではありません`);
    const where = `cables[${i}]`;
    const given = str(v.type).normalize('NFKC').trim().toLowerCase();
    if (given && !isSignal(given)) throw new Error(`${where}: 種別 "${given}" は使えません`);
    const from = resolve(v.from, where, 'right', given || 'other');
    const to = resolve(v.to, where, 'left', given || portSignal(from) || 'other');
    const e = makeEdge(taken, from, to, given || portSignal(from) || portSignal(to) || 'other');
    e.length = typeof v.length === 'number' ? v.length : null;
    e.label = str(v.label);
    e.note = str(v.note);
    if (v.arrow === 'end' || v.arrow === 'both') e.arrow = v.arrow;
    if (v.dash === true) e.dash = true;
    edges.push(e);
  });
  arr(root.flows).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`flows[${i}]: マップではありません`);
    const where = `flows[${i}]`;
    const e = makeEdge(taken, resolve(v.from, where, 'right', 'other'), resolve(v.to, where, 'left', 'other'), 'flow');
    e.label = str(v.label);
    if (v.arrow === 'none' || v.arrow === 'both') e.arrow = v.arrow;
    if (v.dash === true) e.dash = true;
    edges.push(e);
  });

  // Frames: explicit rect, else previous rect by name, else from the layout.
  const frames: FrameNode[] = [];
  const prevFrames = prev.nodes.filter((n): n is FrameNode => n.type === 'frame');
  const addFrame = (name: string, rect: { x: number; y: number; w: number; h: number }) => {
    const old = prevFrames.find((f) => f.text === name && !taken.has(f.id));
    const id = old ? old.id : freshId(taken, 'area');
    taken.add(id);
    frames.push({ id, type: 'frame', text: name, ...rect });
  };
  const pendingAreas = new Set<string>();
  arr(root.areas).forEach((v) => {
    const name = isObj(v) ? str(v.name) : str(v);
    if (!name) return;
    const rect = relayout || !isObj(v) ? null : nums(v.rect, 4);
    const old = relayout ? undefined : prevFrames.find((f) => f.text === name);
    if (rect) addFrame(name, { x: rect[0], y: rect[1], w: rect[2], h: rect[3] });
    else if (old) addFrame(name, { x: old.x, y: old.y, w: old.w, h: old.h });
    else pendingAreas.add(name);
  });

  if (unplaced.size) {
    const placed: Doc = { ...prev, nodes: [...frames, ...nodes.filter((n) => !unplaced.has(n.id))], edges: [] };
    const box = docBounds(placed);
    const todo = nodes.filter((n) => unplaced.has(n.id));
    const { pos, areas } = autoLayout(
      todo,
      edges.filter((e) => unplaced.has(e.from.node) && unplaced.has(e.to.node)),
      (id) => areaHint.get(id) ?? '',
      { x: box ? box.x : 80, y: box ? box.y + box.h + 100 : 80 },
    );
    for (const n of todo) Object.assign(n, pos.get(n.id));
    for (const [name, rect] of areas) if (!frames.some((f) => f.text === name)) addFrame(name, rect);
  }
  // Declared areas that ended up with neither a rect nor any member.
  for (const name of pendingAreas) {
    if (frames.some((f) => f.text === name)) continue;
    const box = docBounds({ ...prev, nodes: [...frames, ...nodes], edges: [] });
    addFrame(name, { x: box ? box.x : 80, y: box ? box.y + box.h + 60 : 80, w: 460, h: 320 });
  }

  const meta = { ...prev.meta };
  for (const k of ['title', 'project', 'drawingNo', 'author', 'rev', 'company'] as const) {
    if (root[k] != null) meta[k] = str(root[k]);
  }
  return { version: 1, id: prev.id, meta, nodes: [...frames, ...nodes], edges };
}
