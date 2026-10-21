import { Document, isScalar, parse, visit } from 'yaml';
import { docBounds, frameOf } from './geometry';
import { autoLayout } from './layout';
import { JUNCTION, freshId, makeEdge, parsePort, presetOf, presetPorts } from './presets';
import { VIDEO_STANDARDS, currentSignal, customSignals, isBuiltInSignal, isSignal, registerSignals } from './signals';
import { cableKind } from './standards';
import { upgradeOrder } from './lists';
import { boardKind } from './load';
import { KINDS } from './kinds';
import { upgradeDoc } from './video';
import type { ColorKey, CustomSignal, DeviceNode, Doc, Edge, EdgeEnd, FillStyle, FrameNode, Node, ShapeKind } from './types';
import { PALETTE } from './signals';

/** Schema reference shown in the editor and given to the AI. */
export const DSL_GUIDE = `# keito YAML 書式
title: 図のタイトル
kind: system               # 任意。ボードの種類 system（システム図）/ software（ソフトウェア構成図）/ sequence / free
project: 案件名            # 任意
labelSize: 9               # 任意。線のラベルの文字サイズ（px、標準 10.5）
signals:                   # 任意。このボードだけの信号種別
  - { id: hdbt, label: HDBaseT, prefix: HDB, color: "#0d9488" }
listOrder:                 # 任意。表の並びを手で決めたとき（equipment / cables / summary / network ごとに id の順）
  equipment: [pc1, sw1]
areas:                     # 設置場所の枠（任意）
  - name: 制御室
    rect: [x, y, w, h]     # 省略すると所属機材から自動計算
    color: green           # 任意。枠の色。fontSize / bold でタイトルの大きさ・太字も指定可
devices:
  - id: pc1                # 英数字の短いID（"." は不可）。cables から参照する
    name: メインPC
    maker: Apple           # 任意
    model: Mac Studio      # 任意
    url: https://…         # 任意。型番のリンク先（製品ページなど）
    category: PC           # 任意
    area: 制御室           # 任意。自動レイアウト時にこの枠へまとめる
    note: 備考             # 任意
    watts: 120             # 任意。消費電力(W)
    capacity: 900          # 任意。UPS・電源タップが給電できる容量(W)
    price: 120000          # 任意。単価（円）。機材リストで数量を掛けて金額になる
    qty: 2                 # 任意。この 1 枠が表す台数（省略時は名前末尾の「x2」、なければ 1）
    vendor: 手配先          # 任意。手配先・担当（機材リストの「区分」になる）
    ip: 192.168.0.10       # 任意。IP アドレス / host でホスト名（ネットワーク表に出る）
    shared: sh_ab12cd34    # 任意。同じ案件のほかのボードと「同じもの」にするキー（同じキーどうしで名前・型番・IP などがそろう）
    runsOn: sh_ab12cd34    # 任意。ソフトウェア構成図の部品が動く機材の shared キー（ホスト名・IP がその機材に合う）
    color: blue            # 任意。機材の色分け（手配元・系統など）
    preset: pc             # 任意。in/out を省略したときの既定ポート
    in:  [LAN:lan, AC:power]          # 左側ポート "名前:種別"
    out: ["HDMI 1:video", DP:video]   # 右側ポート
    pos: [x, y]            # 省略すると自動レイアウト
cables:
  - from: pc1.HDMI 1       # 機材ID.ポート名（無いポートは自動追加。同じ名前のポートが複数あるときは IN#2 のように何番目かを付ける）
    to: pj1.HDMI
    type: video            # video(映像) lan usb audio power fiber dmx serial wireless other、または signals で足した種別。
                           # 映像の規格(HDMI / SDI …)や音声のコネクタ(XLR / TRS …)は spec かポート名で。
                           # ケーブルIDは HDMI-01 / XLR-01 のようにそこから付く
                           # ソフトウェア構成図（kind: software）では http websocket osc mqtt tcp udp ndi file data。ポートは spec に（例 7000/udp）
    cableId: V-01          # 任意。ケーブルIDを手で決める（省略で自動採番）。showId / showLength: false でラベルから隠す。stacked: true で項目を 1 行ずつに
    spec: 光 HDMI AOC      # 任意。品名・規格（線のラベルに出る）。maker / model / url も書ける
    length: 10             # m、任意
    label: メイン映像      # 任意
    labelAt: 0.3           # 任意。ラベルの位置（線の始点 0 〜 終点 1、既定は中央）
    color: "#dc2626"       # 任意。この線だけの色。種別ごとの色は先頭に colors: { video: "#eab308" } と書く
    # 電源(type: power)は線を省略し、両端に接続先だけ表示する。tag: true/false でケーブルごとに切替、
    # 全体は先頭の powerTags: false で線表示に。to をポートなしの機材IDにすると空きポートを自動で使う
shapes:                    # フローチャート・付箋
  - id: s1
    shape: rect            # rect round diamond ellipse cloud(雲) sticky(付箋 = コメント。done: true で解決済み) text
    text: 開始
    color: blue            # white gray blue green yellow orange red purple
    fontSize: 18           # 任意。文字サイズ(px)。shape: text は 20 以上で太字の見出しになる
    bold: true             # 任意。太字
    fill: solid            # 任意。tint(既定・淡色) solid(ベタ塗り。red で真っ赤) outline(白地) none(透過)
    dash: true             # 任意。枠を点線に（cables / flows でも dash: true で点線）
flows:                     # 矢印コネクタ（shapes / devices どちらも可）
  - { from: s1, to: s2, label: はい }   # toSide: left などで入る辺を固定（同じ辺に入る線は手前で合流する。fromSide も可）
images:                    # 埋め込み画像。データ本体は id で引き継がれる（src に data URL / URL も可）
  - { id: img1, name: logo, pos: [x, y], size: [w, h] }   # under: true で下敷き（一番下に薄く敷き、クリックで選ばれない）
legends:                   # 凡例。使っている線の色が自動で並ぶ。names で行の呼び名を付けられる
  - { id: legend1, pos: [x, y], title: 凡例, names: { "#ea7a2e": 映像系統 } }
junctions:                 # 分岐点（古いボードの形式。新しくは書かない。同じ to に向かう線は図で自動的に合流する）
  - { id: j1, pos: [x, y] }
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

const portKey = (name: string): string => name.normalize('NFKC').toLowerCase();

/**
 * A cable end as `device.port`. Ports are named, not numbered, so when a device has several
 * ports of one name the reference says which: `pc1.IN#2` is the second port called IN.
 */
const SIDES = ['left', 'right', 'top', 'bottom'] as const;

/** `fromSide` / `toSide`: the side of its box a port-less end is held to. */
function sidesOf(e: Edge): Obj {
  return { ...(e.from.side && !e.from.port ? { fromSide: e.from.side } : {}), ...(e.to.side && !e.to.port ? { toSide: e.to.side } : {}) };
}
function holdSides(e: Edge, v: Record<string, unknown>): void {
  const side = (x: unknown) => SIDES.find((s) => s === str(x));
  if (side(v.fromSide) && !e.from.port) e.from = { ...e.from, side: side(v.fromSide) };
  if (side(v.toSide) && !e.to.port) e.to = { ...e.to, side: side(v.toSide) };
}

function refOf(doc: Doc, end: EdgeEnd): string {
  const n = doc.nodes.find((x) => x.id === end.node);
  const port = n?.type === 'device' && end.port ? n.ports.find((p) => p.id === end.port) : undefined;
  if (!port || n?.type !== 'device') return end.node;
  const twins = n.ports.filter((p) => portKey(p.name) === portKey(port.name));
  return twins.length > 1 ? `${end.node}.${port.name}#${twins.indexOf(port) + 1}` : `${end.node}.${port.name}`;
}

export function toYaml(doc: Doc): string {
  const out: Obj = { title: doc.meta.title };
  if (doc.kind) out.kind = doc.kind;
  put(out, 'project', doc.meta.project);

  if (doc.powerTags === false) out.powerTags = false;
  if (doc.cableIdLabels === false) out.cableIdLabels = false;
  if (doc.lengthLabels === false) out.lengthLabels = false;
  if (doc.stackedLabels) out.stackedLabels = true;
  if (doc.hops) out.hops = true;
  if (doc.labelSize) out.labelSize = doc.labelSize;
  if (doc.listOrder && Object.keys(doc.listOrder).length) out.listOrder = doc.listOrder;
  if (doc.signals?.length) out.signals = doc.signals.map((s) => ({ ...s }));
  if (doc.signalColors) out.colors = doc.signalColors;

  const frames = doc.nodes.filter((n) => n.type === 'frame');
  if (frames.length) {
    out.areas = frames.map((f) => ({ name: f.text, rect: [r(f.x), r(f.y), r(f.w), r(f.h)], ...(f.type === 'frame' ? { ...(f.color && f.color !== 'gray' ? { color: f.color } : {}), ...(f.fontSize ? { fontSize: f.fontSize } : {}), ...(f.bold != null ? { bold: f.bold } : {}) } : {}) }));
  }

  const devices = doc.nodes.filter((n): n is DeviceNode => n.type === 'device');
  if (devices.length) {
    out.devices = devices.map((d) => {
      const o: Obj = { id: d.id, name: d.text };
      put(o, 'maker', d.maker);
      put(o, 'model', d.model);
      put(o, 'url', d.url);
      put(o, 'category', d.category);
      put(o, 'area', frameOf(doc, d)?.text);
      put(o, 'note', d.note);
      put(o, 'qty', d.qty);
      put(o, 'vendor', d.vendor);
      put(o, 'ip', d.ip);
      put(o, 'host', d.host);
      put(o, 'shared', d.shared);
      put(o, 'runsOn', d.runsOn);
      put(o, 'price', d.price);
      put(o, 'watts', d.watts);
      put(o, 'capacity', d.capacity);
      if (d.color && d.color !== 'gray') o.color = d.color;
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
      const o: Obj = { from: refOf(doc, e.from), to: refOf(doc, e.to), type: e.signal, ...sidesOf(e) };
      put(o, 'length', e.length);
      put(o, 'cableId', e.cableId);
      if (e.showId != null) o.showId = e.showId;
      if (e.showLength != null) o.showLength = e.showLength;
      if (e.stacked != null) o.stacked = e.stacked;
      put(o, 'spec', e.spec);
      put(o, 'maker', e.maker);
      put(o, 'model', e.model);
      put(o, 'url', e.url);
      put(o, 'label', e.label);
      put(o, 'note', e.note);
      if (e.arrow !== 'none') o.arrow = e.arrow;
      if (e.dash) o.dash = true;
      if (e.color) o.color = e.color;
      if (e.tag != null) o.tag = e.tag;
      if (e.labelAt != null) o.labelAt = e.labelAt;
      if (e.route?.length) o.route = e.route.map((p) => [r(p.x), r(p.y)]);
      return o;
    });
  }

  const shapes = doc.nodes.filter((n) => n.type === 'shape' || n.type === 'sticky' || n.type === 'text');
  if (shapes.length) {
    out.shapes = shapes.map((s) => {
      const o: Obj = { id: s.id, shape: s.type === 'shape' ? s.shape : s.type, text: s.text };
      if (s.type === 'sticky' && s.done) o.done = true;
      if (s.type !== 'text') put(o, 'color', s.color);
      if (s.fontSize) o.fontSize = s.fontSize;
      if (s.bold != null) o.bold = s.bold;
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
      const o: Obj = { from: refOf(doc, e.from), to: refOf(doc, e.to), ...sidesOf(e) };
      put(o, 'label', e.label);
      if (e.arrow !== 'end') o.arrow = e.arrow;
      if (e.color) o.color = e.color;
      if (e.dash) o.dash = true;
      if (e.labelAt != null) o.labelAt = e.labelAt;
      if (e.route?.length) o.route = e.route.map((p) => [r(p.x), r(p.y)]);
      return o;
    });
  }

  const seqs = doc.nodes.filter((n) => n.type === 'sequence');
  if (seqs.length) out.sequences = seqs.map((s) => ({ id: s.id, pos: [r(s.x), r(s.y)], ...(s.w > 0 || s.h > 0 ? { size: [r(s.w), r(s.h)] } : {}), ...(s.type === 'sequence' && s.fontSize ? { fontSize: s.fontSize } : {}), text: s.text }));

  // Pictures are listed without their data so the text stays readable; applying
  // the YAML keeps each picture by id.
  const images = doc.nodes.filter((n) => n.type === 'image');
  if (images.length) out.images = images.map((n) => ({ id: n.id, name: n.text, pos: [r(n.x), r(n.y)], size: [r(n.w), r(n.h)], ...(n.under ? { under: true } : {}), ...(n.opacity != null ? { opacity: n.opacity } : {}) }));

  const junctions = doc.nodes.filter((n) => n.type === 'junction');
  if (junctions.length) out.junctions = junctions.map((n) => ({ id: n.id, pos: [r(n.x + n.w / 2), r(n.y + n.h / 2)] }));

  const legends = doc.nodes.filter((n) => n.type === 'legend');
  if (legends.length) {
    out.legends = legends.map((n) => {
      const o: Obj = { id: n.id, pos: [r(n.x), r(n.y)], width: r(n.w), title: n.text };
      if (n.names && Object.keys(n.names).length) o.names = n.names;
      if (n.hidden?.length) o.hidden = n.hidden;
      return o;
    });
  }

  const y = new Document(out);
  // Keep coordinate pairs and port lists on one line.
  visit(y, {
    Seq(_, node) {
      if (node.items.length && node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
  return y.toString({ lineWidth: 0 });
}

const HEX = /^#[0-9a-f]{3,8}$/i;
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
 * `shared: key`: the node is one thing with the nodes of that key on the project's other boards.
 * When it was last changed is not written out; it is kept from the node as it was.
 */
function sharing(v: Record<string, unknown>, old: Node | undefined): { shared?: string; sharedAt?: number } {
  const shared = str(v.shared) || undefined;
  const at = old && old.type === 'device' && old.shared === shared ? old.sharedAt : undefined;
  return shared ? { shared, ...(at ? { sharedAt: at } : {}) } : {};
}

/** `listOrder: { equipment: [pc1, sw1], … }`: the hand-made order of each list, as ids. */
function readOrder(v: unknown): Record<string, string[]> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.fromEntries(Object.entries(v).filter(([, ids]) => Array.isArray(ids)).map(([k, ids]) => [k, (ids as unknown[]).map((id) => str(id)).filter(Boolean)]));
  return Object.keys(out).length ? out : undefined;
}

/**
 * Build a doc from YAML. Nodes without `pos` keep their position from `prev`
 * (matched by id) unless `relayout`; anything still unplaced is auto-laid-out.
 */
export function fromYaml(src: string, prev: Doc, relayout = false): Doc {
  // Reading the YAML registers its own signal types so cables can use them. The registry is
  // global, so it goes back to what it was afterwards, whether or not the YAML was valid: the
  // store registers the new ones itself if the result is applied.
  const before = customSignals();
  try {
    // Old type names (hdmi, sdi, dp) anywhere else in it, colours included, come out as 映像.
    return upgradeOrder(upgradeDoc(readYaml(src, prev, relayout)));
  } finally {
    registerSignals(before);
  }
}

function readYaml(src: string, prev: Doc, relayout: boolean): Doc {
  const root = parse(src);
  if (!isObj(root)) throw new Error('YAML のトップレベルはマップ（title: … など）にしてください');

  // The board's own signal types come first: cables and ports below may use them.
  const signals: CustomSignal[] | undefined = !Array.isArray(root.signals)
    ? prev.signals
    : root.signals.filter(isObj).flatMap((v) => {
        const id = str(v.id).normalize('NFKC').trim().toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(id) || isBuiltInSignal(id)) return [];
        return [{ id, label: str(v.label, id), prefix: str(v.prefix, id.toUpperCase().slice(0, 4)), color: HEX.test(str(v.color)) ? str(v.color) : '#475569' }];
      });
  registerSignals(signals);

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
      url: str(v.url) || undefined,
      category: str(v.category, preset?.category ?? ''),
      note: str(v.note),
      ports,
      watts: typeof v.watts === 'number' ? v.watts : undefined,
      capacity: typeof v.capacity === 'number' ? v.capacity : undefined,
      color: str(v.color) in PALETTE ? (str(v.color) as ColorKey) : undefined,
      qty: typeof v.qty === 'number' && v.qty >= 1 ? Math.round(v.qty) : undefined,
      vendor: str(v.vendor) || undefined,
      ip: str(v.ip) || undefined,
      host: str(v.host) || undefined,
      price: typeof v.price === 'number' ? v.price : undefined,
      listOrder: typeof v.order === 'number' ? v.order : undefined,
      ...sharing(v, old),
      runsOn: str(v.runsOn) || undefined,
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
    const fontSize = typeof v.fontSize === 'number' && v.fontSize >= 6 && v.fontSize <= 200 ? v.fontSize : undefined;
    const bold = typeof v.bold === 'boolean' ? v.bold : undefined;
    if (kind === 'sticky') {
      // When it was put on the board is not written out; it is kept from the sticky as it was.
      const was = prevById.get(id);
      nodes.push({ ...base, type: 'sticky', color: color ?? 'yellow', fontSize, bold, done: v.done === true || undefined, at: was?.type === 'sticky' ? was.at : Date.now(), ...(was?.type === 'sticky' && was.on ? { on: was.on } : {}) });
    }
    else if (kind === 'text') nodes.push({ ...base, type: 'text', fontSize, bold });
    else {
      const fill = ['solid', 'outline', 'none'].includes(str(v.fill)) ? (str(v.fill) as FillStyle) : undefined;
      nodes.push({ ...base, type: 'shape', shape: SHAPES.includes(kind as ShapeKind) ? (kind as ShapeKind) : 'rect', color: color ?? 'white', fill, dash: v.dash === true || undefined, fontSize, bold });
    }
    if (v.area) areaHint.set(id, str(v.area));
  });

  arr(root.junctions).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`junctions[${i}]: マップではありません`);
    const id = claim(v.id, 'j', `junctions[${i}]`);
    const at = place(id, v.pos);
    nodes.push({ id, type: 'junction', x: at.x - JUNCTION / 2, y: at.y - JUNCTION / 2, w: JUNCTION, h: JUNCTION, text: '分岐' });
  });

  arr(root.legends).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`legends[${i}]: マップではありません`);
    const id = claim(v.id, 'legend', `legends[${i}]`);
    const names = isObj(v.names) ? Object.fromEntries(Object.entries(v.names).map(([k, name]) => [k.toLowerCase(), str(name)]).filter(([, name]) => name)) : {};
    nodes.push({ id, type: 'legend', ...place(id, v.pos), w: typeof v.width === 'number' ? v.width : 200, h: 64, text: typeof v.title === 'string' ? v.title : '凡例', names: Object.keys(names).length ? names : undefined, hidden: arr(v.hidden).map((c) => str(c).toLowerCase()).filter(Boolean).length ? arr(v.hidden).map((c) => str(c).toLowerCase()).filter(Boolean) : undefined });
  });

  arr(root.sequences).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`sequences[${i}]: マップではありません`);
    const id = claim(v.id, 'seq', `sequences[${i}]`);
    const size = nums(v.size, 2);
    nodes.push({ id, type: 'sequence', ...place(id, v.pos), w: size?.[0] ?? 0, h: size?.[1] ?? 0, text: str(v.text).trimEnd(), fontSize: typeof v.fontSize === 'number' ? v.fontSize : undefined });
  });

  arr(root.images).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`images[${i}]: マップではありません`);
    const old = prevById.get(str(v.id));
    const src = str(v.src) || (old?.type === 'image' ? old.src : '');
    if (!src) return;
    const id = claim(v.id, 'img', `images[${i}]`);
    const size = nums(v.size, 2) ?? (old ? [old.w, old.h] : [200, 150]);
    nodes.push({ id, type: 'image', ...place(id, v.pos), w: size[0], h: size[1], text: str(v.name), src, under: v.under === true || undefined, opacity: typeof v.opacity === 'number' ? v.opacity : undefined });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: Edge[] = [];
  const resolve = (ref: unknown, where: string, side: 'left' | 'right', signal: string, base?: string): EdgeEnd => {
    // NFKC folds full-width alphanumerics / spaces / dots typed with an IME.
    const s = str(ref).normalize('NFKC').trim();
    const dot = s.indexOf('.');
    const nodeId = dot < 0 ? s : s.slice(0, dot);
    const portName = dot < 0 ? '' : s.slice(dot + 1).trim();
    const node = byId.get(nodeId);
    if (!node) throw new Error(`${where}: "${nodeId}" という id の要素がありません`);
    if (node.type === 'device' && !portName && signal !== 'other' && signal !== 'flow') {
      // No port named: use a free port of that signal, adding one when all are taken.
      const used = new Set(edges.flatMap((e) => [e.from.node === nodeId ? e.from.port : undefined, e.to.node === nodeId ? e.to.port : undefined]));
      let free = node.ports.find((p) => p.signal === signal && p.side === side && !used.has(p.id));
      if (!free) {
        free = { id: freshId(new Set(node.ports.map((p) => p.id)), 'p'), name: `${base ?? (signal === 'power' ? 'AC' : signal === 'video' ? 'HDMI' : signal.toUpperCase())} ${node.ports.filter((p) => p.signal === signal && p.side === side).length + 1}`, side, signal };
        node.ports.push(free);
      }
      return { node: nodeId, port: free.id };
    }
    if (node.type !== 'device' || !portName) return { node: nodeId };
    let port = node.ports.find((p) => portKey(p.name) === portKey(portName));
    // `IN#2`: the second port called IN, unless a port is really called "IN#2".
    const nth = /^(.*?)#(\d+)$/.exec(portName);
    if (nth && !port) port = node.ports.filter((p) => portKey(p.name) === portKey(nth[1]))[Number(nth[2]) - 1];
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
    const typed = str(v.type).normalize('NFKC').trim().toLowerCase();
    if (typed && !isSignal(typed)) throw new Error(`${where}: 種別 "${typed}" は使えません`);
    // The old video types (type: sdi) are 映像, and the standard they named names any port added.
    const named = VIDEO_STANDARDS[typed] as string | undefined;
    const given = typed && currentSignal(typed);
    const from = resolve(v.from, where, 'right', given || 'other', named);
    const to = resolve(v.to, where, 'left', given || portSignal(from) || 'other', named);
    const e = makeEdge(taken, from, to, given || portSignal(from) || portSignal(to) || 'other');
    e.length = typeof v.length === 'number' ? v.length : null;
    e.label = str(v.label);
    e.note = str(v.note);
    e.cableId = str(v.cableId) || undefined;
    if (typeof v.showId === 'boolean') e.showId = v.showId;
    if (typeof v.showLength === 'boolean') e.showLength = v.showLength;
    if (typeof v.stacked === 'boolean') e.stacked = v.stacked;
    e.spec = str(v.spec) || undefined;
    if (named && !e.spec && !cableKind(nodes, e)) e.spec = named;
    e.maker = str(v.maker) || undefined;
    e.model = str(v.model) || undefined;
    e.url = str(v.url) || undefined;
    if (v.arrow === 'end' || v.arrow === 'both') e.arrow = v.arrow;
    if (v.dash === true) e.dash = true;
    if (HEX.test(str(v.color))) e.color = str(v.color);
    if (typeof v.tag === 'boolean') e.tag = v.tag;
    if (typeof v.labelAt === 'number') e.labelAt = Math.min(0.96, Math.max(0.04, v.labelAt));
    // Hand-placed bends only make sense while the layout they were drawn for is kept.
    const bends = relayout ? [] : arr(v.route).map((p) => nums(p, 2)).filter((p): p is number[] => !!p);
    if (bends.length >= 2) e.route = bends.map(([x, y]) => ({ x, y }));
    holdSides(e, v);
    edges.push(e);
  });
  arr(root.flows).forEach((v, i) => {
    if (!isObj(v)) throw new Error(`flows[${i}]: マップではありません`);
    const where = `flows[${i}]`;
    const e = makeEdge(taken, resolve(v.from, where, 'right', 'other'), resolve(v.to, where, 'left', 'other'), 'flow');
    e.label = str(v.label);
    if (v.arrow === 'none' || v.arrow === 'both') e.arrow = v.arrow;
    if (HEX.test(str(v.color))) e.color = str(v.color);
    if (v.dash === true) e.dash = true;
    if (typeof v.labelAt === 'number') e.labelAt = Math.min(0.96, Math.max(0.04, v.labelAt));
    // Hand-placed bends, as for cables (and dropped the same way by a fresh layout).
    const bends = relayout ? [] : arr(v.route).map((p) => nums(p, 2)).filter((p): p is number[] => !!p);
    if (bends.length >= 2) e.route = bends.map(([x, y]) => ({ x, y }));
    holdSides(e, v);
    edges.push(e);
  });

  // Frames: explicit rect, else previous rect by name, else from the layout.
  const frames: FrameNode[] = [];
  const prevFrames = prev.nodes.filter((n): n is FrameNode => n.type === 'frame');
  const addFrame = (name: string, rect: { x: number; y: number; w: number; h: number }) => {
    const old = prevFrames.find((f) => f.text === name && !taken.has(f.id));
    const id = old ? old.id : freshId(taken, 'area');
    taken.add(id);
    // An area listed in the YAML takes its look from there; one that only exists through
    // a device's `area:` keeps the look it already had.
    const look = areaLook.get(name) ?? { color: old?.color, fontSize: old?.fontSize, bold: old?.bold };
    frames.push({ id, type: 'frame', text: name, ...rect, ...look });
  };
  const areaLook = new Map<string, { color?: ColorKey; fontSize?: number; bold?: boolean }>();
  const pendingAreas = new Set<string>();
  arr(root.areas).forEach((v) => {
    const name = isObj(v) ? str(v.name) : str(v);
    if (!name) return;
    areaLook.set(name, {
      color: isObj(v) && str(v.color) in PALETTE ? (str(v.color) as ColorKey) : undefined,
      fontSize: isObj(v) && typeof v.fontSize === 'number' ? v.fontSize : undefined,
      bold: isObj(v) && typeof v.bold === 'boolean' ? v.bold : undefined,
    });
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
      // Power feeds don't describe signal flow, so they must not shape the layout.
      edges.filter((e) => e.signal !== 'power' && unplaced.has(e.from.node) && unplaced.has(e.to.node)),
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
  for (const k of ['title', 'project'] as const) {
    if (root[k] != null) meta[k] = str(root[k]);
  }
  const powerTags = typeof root.powerTags === 'boolean' ? root.powerTags : prev.powerTags;
  // Per-board colours for signal types: `colors: { video: "#eab308" }`.
  // Leaving `colors` out keeps the board's current choices; `colors: {}` clears them.
  const picked = isObj(root.colors) ? Object.entries(root.colors).filter(([k, v]) => isSignal(k) && HEX.test(str(v))) : null;
  const signalColors = !picked ? prev.signalColors : picked.length ? Object.fromEntries(picked.map(([k, v]) => [k, str(v)])) : undefined;
  // Revision history is not part of the text form; it stays with the board.
  // A kind known now, or an old one that is a free board now (see boardKind); anything else keeps the board's.
  const kind = typeof root.kind === 'string' && (Object.hasOwn(KINDS, root.kind) || ['layout', 'screen', 'flow'].includes(root.kind)) ? boardKind(root.kind) : prev.kind;
  return { version: 1, id: prev.id, kind, meta, nodes: [...frames, ...nodes], edges, powerTags, signalColors, signals: signals?.length ? signals : undefined, cableIdLabels: typeof root.cableIdLabels === 'boolean' ? root.cableIdLabels : prev.cableIdLabels, lengthLabels: typeof root.lengthLabels === 'boolean' ? root.lengthLabels : prev.lengthLabels, stackedLabels: typeof root.stackedLabels === 'boolean' ? root.stackedLabels : prev.stackedLabels, hops: typeof root.hops === 'boolean' ? root.hops || undefined : prev.hops, labelSize: typeof root.labelSize === 'number' && root.labelSize > 0 ? root.labelSize : prev.labelSize, listOrder: readOrder(root.listOrder) ?? prev.listOrder, revisions: prev.revisions };
}
