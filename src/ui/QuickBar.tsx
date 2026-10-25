import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { SCREEN, edgeTags, textHeightFor, textWeight } from '../canvas/render';
import { docBounds, isTagged, labelPoint, routeEdges } from '../model/geometry';
import { LABEL_SIZE, LABEL_SIZES } from '../model/labels';
import { LINE_COLORS, lineColor, lineDashed, paintLine } from '../model/lineColor';
import { COLOR_KEYS, PALETTE, STICKY, STRONG, signalOf } from '../model/signals';
import { copySelection, pasteClipboard, useStore } from '../model/store';
import { type ColorKey, type Edge, type Node, hasText } from '../model/types';
import { safeUrl } from '../model/url';
import { COLOR_NAME, FILLS, FillPreview, ICON, SHAPES, shapeIcon, sizesFor } from './icons';
import { useBurst } from './burst';
import { openLink } from '../platform/io';

const st = useStore.getState;
const CHECKER = 'repeating-conic-gradient(#c3ccd8 0% 25%, #fff 0% 50%) 50% / 8px 8px';

/** Swatch as the colour will actually appear with the node's current fill style. */
function swatch(n: Node, c: ColorKey): CSSProperties {
  if (n.type === 'sticky') return { background: STICKY[c].fill, borderColor: STICKY[c].stroke };
  if (n.type === 'device' && c === 'gray') return { background: '#e8edf3', borderColor: '#334155' };
  if (n.type === 'frame') return c === 'gray' ? { background: '#eef1f5', borderColor: '#94a3b8' } : { background: PALETTE[c].fill, borderColor: c === 'white' ? PALETTE.white.stroke : STRONG[c].fill };
  const style = n.type === 'shape' ? (n.fill ?? 'tint') : 'tint';
  if (style === 'tint') return { background: PALETTE[c].fill, borderColor: PALETTE[c].stroke };
  if (style === 'solid') return { background: STRONG[c].fill, borderColor: STRONG[c].fill };
  return { background: style === 'none' ? CHECKER : '#fff', borderColor: STRONG[c].fill };
}

/** Bar button. `tip` is shown instantly on hover — icons alone are never the only explanation. */
function Btn({ tip, on, onClick, children, className = '' }: { tip: string; on?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button className={`${className}${on ? ' on' : ''}`} data-tip={tip} aria-label={tip} onClick={onClick}>
      {children}
    </button>
  );
}

/** Floating toolbar above the selection: the edits you reach for right after placing something. */
export function QuickBar() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const view = useStore((s) => s.view);
  const [menu, setMenu] = useState<'shape' | 'color' | 'size' | 'line' | null>(null);
  // Whether a colour picked for a line goes to its whole signal type; set once the selected line is known.
  const [wide, setWide] = useState<boolean | null>(null);
  const ids = new Set(selection);
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  // Lines alone (one, or several taken with a drag): the bar's line settings go to all of them.
  const edges = nodes.length ? [] : doc.edges.filter((e) => ids.has(e.id));
  const edge = edges[0];
  // A line's label size: its own, else the board's. Picking the board's size leaves it following the board.
  const boardSize = doc.labelSize ?? LABEL_SIZE;
  const lineSize = edge?.fontSize ?? boardSize;
  const sizeName = (px: number): string => LABEL_SIZES.find((o) => o.size === px)?.label ?? `${px}px`;
  const setEdges = (p: Partial<Edge>) => st().mutate((d) => ({ ...d, edges: d.edges.map((e) => (ids.has(e.id) ? { ...e, ...p } : e)) }));
  const box = nodes.length ? docBounds(doc, new Set(nodes.map((n) => n.id))) : null;
  // Dragged out of the way by its grip: an offset in screen pixels. The bar is keyed by the
  // selection, so it comes back to its usual place as soon as something else is selected.
  const [moved, setMoved] = useState<{ dx: number; dy: number } | null>(null);
  const shift = moved ?? { dx: 0, dy: 0 };
  const grab = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const start = { x: e.clientX - shift.dx, y: e.clientY - shift.dy };
    const move = (ev: PointerEvent) => setMoved({ dx: ev.clientX - start.x, dy: ev.clientY - start.y });
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };
  let anchor: { x: number; top: number; bottom: number } | null = null;
  if (box) anchor = { x: box.x + box.w / 2, top: box.y, bottom: box.y + box.h };
  else if (edge) {
    const tag = isTagged(doc, edge) ? edgeTags(doc, edge, SCREEN)[0] : undefined;
    const p = tag ? { x: tag.x + tag.w / 2, y: tag.y + tag.h / 2 } : labelPoint(routeEdges(doc).get(edge.id) ?? [{ x: 0, y: 0 }], edge.labelAt);
    anchor = { x: p.x, top: p.y - 14, bottom: p.y + 14 };
  }
  // Keep the bar on screen: above the selection, else below it, and always inside
  // the canvas — when zoomed in, the selection's edges can be far outside the view.
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || !anchor) return;
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(Math.max(lo, hi), v));
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = view.y + anchor.top * view.k - h - 14;
    const above = top >= 6;
    if (!above) top = view.y + anchor.bottom * view.k + 14;
    top = clamp(top + shift.dy, 6, host.clientHeight - h - 6);
    el.style.left = `${clamp(view.x + anchor.x * view.k + shift.dx, w / 2 + 6, host.clientWidth - w / 2 - 6)}px`;
    el.style.top = `${top}px`;
    // Tooltips and menus open away from the selection when there is room, so they don't cover it.
    el.classList.toggle('tips-down', top < 44);
    const open = el.querySelector<HTMLElement>('.qb-menu');
    if (open) {
      const roomUp = top - 12;
      const roomDown = host.clientHeight - top - h - 12;
      const need = open.offsetHeight;
      open.classList.toggle('up', above ? roomUp >= need || roomUp >= roomDown : roomDown < need && roomUp > roomDown);
    }
  });
  if (!anchor) return null;
  const one = nodes.length === 1 ? nodes[0] : undefined;
  const patch = (p: Partial<Node>) => {
    if (one) st().updateNode(one.id, p);
    setMenu(null);
  };
  const editId = one ? (hasText(one) ? one.id : undefined) : edges.length === 1 ? edge.id : undefined;
  const deviceLink = one?.type === 'device' ? safeUrl(one.url) : undefined;
  const tagged = edge ? isTagged(doc, edge) : false;
  const toggle = (m: 'shape' | 'color' | 'size' | 'line') => () => setMenu(menu === m ? null : m);
  // Cables are colour-coded by type, so a new colour goes to the whole type unless told otherwise; arrows are coloured one by one.
  const all = wide ?? (!!edge && edge.signal !== 'flow');
  const burst = useBurst();
  // A colour from the picker arrives over and over while it is dragged round: one undo step for it all.
  const paint = (c: string | null, close = true) => {
    if (!close) burst();
    if (edges.length) st().setDoc(edges.reduce((d, e) => paintLine(d, e.id, c, all), doc), close);
    if (close) setMenu(null);
  };
  // Shapes, stickies, devices and area frames can be colour-coded; one without a colour shows as gray.
  const tinted = one?.type === 'shape' || one?.type === 'sticky' || one?.type === 'device' || one?.type === 'frame' ? one : undefined;
  const color: ColorKey = tinted ? (tinted.color ?? 'gray') : 'gray';
  const sized = one?.type === 'text' || one?.type === 'shape' || one?.type === 'sticky' || one?.type === 'frame' || one?.type === 'sequence' ? one : undefined;
  const sizes = sized ? sizesFor(sized.type) : [];
  // The built-in size of this kind of node; an unset fontSize means exactly this.
  const baseSize = sized?.type === 'sticky' ? 13.5 : sized?.type === 'frame' ? 13 : sized?.type === 'sequence' ? 11 : 14;
  const isBold = !!sized && sized.type !== 'sequence' && textWeight(sized) === 700;
  const fontSize = sized?.fontSize ?? baseSize;
  // Apply a text style, letting the box follow so the text never spills out of it.
  const restyle = (change: { fontSize?: number; bold?: boolean }) => {
    if (!sized) return;
    // Areas and sequence diagrams size themselves around their text.
    if (sized.type === 'frame' || sized.type === 'sequence') return patch(change);
    const need = textHeightFor({ ...sized, ...change }, sized.text);
    // Free text hugs its words; a shape or sticky only ever grows, since its size was chosen by hand.
    patch({ ...change, h: sized.type === 'text' ? need : Math.max(sized.h, need) });
  };
  return (
    <div ref={ref} className="quickbar" onPointerDown={(e) => e.stopPropagation()}>
      <div
        className={`qb-grip${moved ? ' moved' : ''}`}
        data-tip={moved ? 'ドラッグで移動・ダブルクリックで元の位置へ' : 'ドラッグでツールバーをずらす'}
        onPointerDown={grab}
        onDoubleClick={() => setMoved(null)}
      >
        <svg viewBox="0 0 6 14" width="6" height="14" aria-hidden>
          {[2, 7, 12].flatMap((y) => [<circle key={`a${y}`} cx="1.5" cy={y} r="1.1" />, <circle key={`b${y}`} cx="4.5" cy={y} r="1.1" />])}
        </svg>
      </div>
      {one?.type === 'shape' && (
        <div className={`qb-drop${menu === 'shape' ? ' open' : ''}`}>
          <Btn className="drop" tip="形を変える" on={menu === 'shape'} onClick={toggle('shape')}>
            {shapeIcon(one.shape)}
            {ICON.caret}
          </Btn>
          {menu === 'shape' && (
            <div className="qb-menu">
              {SHAPES.map((s) => (
                <button key={s.id} className={one.shape === s.id ? 'on' : ''} onClick={() => patch({ shape: s.id })}>
                  {s.icon}
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {tinted && (
        <div className={`qb-drop${menu === 'color' ? ' open' : ''}`}>
          <Btn className="drop" tip={`色：${COLOR_NAME[color]}`} on={menu === 'color'} onClick={toggle('color')}>
            <span className="dot" style={swatch(tinted, color)} />
            {ICON.caret}
          </Btn>
          {menu === 'color' && (
            <div className="qb-menu grid">
              {COLOR_KEYS.map((c) => (
                <button key={c} className={color === c ? 'on' : ''} data-tip={COLOR_NAME[c]} aria-label={COLOR_NAME[c]} onClick={() => patch({ color: c })}>
                  <span className="dot" style={swatch(tinted, c)} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {sized && (
        <div className={`qb-drop${menu === 'size' ? ' open' : ''}`}>
          <Btn className="drop labeled" tip="文字の大きさ" on={menu === 'size'} onClick={toggle('size')}>
            {ICON.size}
            <span>{sizes.find((t) => (t.px ?? baseSize) === fontSize)?.label ?? `${fontSize}px`}</span>
            {ICON.caret}
          </Btn>
          {menu === 'size' && (
            <div className="qb-menu">
              {sizes.map((t) => (
                <button key={t.label} className={(t.px ?? baseSize) === fontSize ? 'on' : ''} onClick={() => restyle({ fontSize: t.px })}>
                  <span style={{ fontSize: `${0.75 + (t.px ?? 14) / 48}em` }}>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {sized && sized.type !== 'sequence' && (
        <Btn tip={isBold ? '太字をやめる' : '太字にする'} on={isBold} onClick={() => restyle({ bold: !isBold })}>
          {ICON.bold}
        </Btn>
      )}
      {one?.type === 'shape' && (
        <>
          <i />
          {FILLS.map((f) => (
            <Btn key={f.id} tip={f.label} on={(one.fill ?? 'tint') === f.id} onClick={() => patch({ fill: f.id })}>
              <FillPreview fill={f.id} color={one.color} />
            </Btn>
          ))}
          <Btn tip={one.dash ? '枠を実線に戻す' : '枠を点線にする'} on={!!one.dash} onClick={() => patch({ dash: !one.dash })}>
            {ICON.dashedBox}
          </Btn>
        </>
      )}
      {(tinted || sized) && <i />}

      {edge && (
        <div className={`qb-drop${menu === 'line' ? ' open' : ''}`}>
          <Btn className="drop" tip="線の色" on={menu === 'line'} onClick={toggle('line')}>
            <span className="dot" style={{ background: lineColor(doc, edge), borderColor: lineColor(doc, edge) }} />
            {ICON.caret}
          </Btn>
          {menu === 'line' && (
            <div className="qb-menu">
              <div className="qb-swatches">
                {LINE_COLORS.map((c) => (
                  <button key={c} className={lineColor(doc, edge).toLowerCase() === c ? 'on' : ''} aria-label={c} onClick={() => paint(c)}>
                    <span className="dot" style={{ background: c, borderColor: c }} />
                  </button>
                ))}
                <label className="qb-custom" data-tip="ほかの色を選ぶ">
                  <input type="color" value={lineColor(doc, edge)} onChange={(e) => paint(e.target.value, false)} />
                </label>
              </div>
              <div className="qb-scope">
                <button className={all ? 'on' : ''} onClick={() => setWide(true)}>
                  {signalOf(edge.signal).label} すべて
                </button>
                <button className={all ? '' : 'on'} onClick={() => setWide(false)}>
                  この線だけ
                </button>
              </div>
              <button onClick={() => paint(null)}>既定の色に戻す</button>
            </div>
          )}
        </div>
      )}
      {edge && !tagged && (
        <>
          <Btn tip="実線" on={!lineDashed(edge)} onClick={() => setEdges({ dash: false })}>
            {ICON.lineSolid}
          </Btn>
          <Btn tip="点線" on={lineDashed(edge)} onClick={() => setEdges({ dash: true })}>
            {ICON.lineDashed}
          </Btn>
        </>
      )}
      {edge && (
        <div className={`qb-drop${menu === 'size' ? ' open' : ''}`}>
          <Btn
            className="drop labeled"
            tip={edge.fontSize ? 'ラベルの文字サイズ（この線だけ変えています）' : 'ラベルの文字サイズ（ボード全体のサイズのまま）'}
            on={menu === 'size'}
            onClick={toggle('size')}
          >
            {ICON.size}
            <span>{sizeName(lineSize)}</span>
            {ICON.caret}
          </Btn>
          {menu === 'size' && (
            <div className="qb-menu">
              {LABEL_SIZES.map((o) => (
                <button
                  key={o.size}
                  className={lineSize === o.size ? 'on' : ''}
                  onClick={() => {
                    setEdges({ fontSize: o.size === boardSize ? undefined : o.size });
                    setMenu(null);
                  }}
                >
                  <span style={{ fontSize: `${o.size + 2}px` }}>{o.label}</span>
                  {o.size === boardSize && <em>ボード全体と同じ</em>}
                </button>
              ))}
              <p className="qb-note">ボード全体のサイズは、何も選ばずに右の「ボード設定」で変えられます。</p>
            </div>
          )}
        </div>
      )}
      {edge && edge.signal !== 'flow' && (
        <Btn className="labeled" tip={tagged ? '線を引いて表示する' : '線を引かず、両端に接続先だけ表示する'} on={tagged} onClick={() => setEdges({ tag: !tagged, route: undefined })}>
          {ICON.omit}
          <span>線を省略</span>
        </Btn>
      )}
      {edges.some((e) => e.route) && !tagged && (
        <Btn className="labeled" tip="手で動かした曲がりを消して、自動の経路に戻す" onClick={() => setEdges({ route: undefined })}>
          {ICON.reset}
          <span>自動経路に</span>
        </Btn>
      )}
      {edge && <i />}

      {deviceLink && (
        <Btn className="labeled" tip={deviceLink} onClick={() => openLink(deviceLink)}>
          {ICON.link}
          <span>型番のページ</span>
        </Btn>
      )}
      {editId && (
        <Btn tip={edge ? 'ラベルを編集 (Enter)' : '文字を編集 (Enter)'} onClick={() => st().setEditing(editId)}>
          {ICON.text}
        </Btn>
      )}
      {nodes.length > 0 && (
        <Btn
          tip="複製 (⌘D)"
          onClick={() => {
            copySelection();
            pasteClipboard();
          }}
        >
          {ICON.duplicate}
        </Btn>
      )}
      <Btn tip="削除 (Delete)" onClick={() => st().removeIds(selection)}>
        {ICON.trash}
      </Btn>
    </div>
  );
}
