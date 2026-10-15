import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { SCREEN, edgeTags, textHeightFor, textWeight } from '../canvas/render';
import { docBounds, isTagged, labelPoint, routeEdges } from '../model/geometry';
import { LINE_COLORS, lineColor, paintLine } from '../model/lineColor';
import { COLOR_KEYS, PALETTE, STICKY, STRONG, signalOf } from '../model/signals';
import { splitEdge } from '../model/presets';
import { copySelection, pasteClipboard, useStore } from '../model/store';
import { type ColorKey, type Node, hasText } from '../model/types';
import { safeUrl } from '../model/url';
import { COLOR_NAME, FILLS, FillPreview, ICON, SHAPES, shapeIcon, sizesFor } from './icons';

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
  const edge = nodes.length ? undefined : doc.edges.find((e) => ids.has(e.id));
  const box = nodes.length ? docBounds(doc, new Set(nodes.map((n) => n.id))) : null;
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
    top = clamp(top, 6, host.clientHeight - h - 6);
    el.style.left = `${clamp(view.x + anchor.x * view.k, w / 2 + 6, host.clientWidth - w / 2 - 6)}px`;
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
  const editId = one ? (hasText(one) ? one.id : undefined) : edge?.id;
  const deviceLink = one?.type === 'device' ? safeUrl(one.url) : undefined;
  const tagged = edge ? isTagged(doc, edge) : false;
  const toggle = (m: 'shape' | 'color' | 'size' | 'line') => () => setMenu(menu === m ? null : m);
  // Cables are colour-coded by type, so a new colour goes to the whole type unless told otherwise; arrows are coloured one by one.
  const all = wide ?? (!!edge && edge.signal !== 'flow');
  const paint = (c: string | null, close = true) => {
    if (edge) st().setDoc(paintLine(doc, edge.id, c, all));
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
          <Btn tip="実線" on={!edge.dash} onClick={() => st().updateEdge(edge.id, { dash: false })}>
            {ICON.lineSolid}
          </Btn>
          <Btn tip="点線" on={!!edge.dash} onClick={() => st().updateEdge(edge.id, { dash: true })}>
            {ICON.lineDashed}
          </Btn>
        </>
      )}
      {edge && edge.signal !== 'flow' && (
        <Btn className="labeled" tip={tagged ? '線を引いて表示する' : '線を引かず、両端に接続先だけ表示する'} on={tagged} onClick={() => st().updateEdge(edge.id, { tag: !tagged, route: undefined })}>
          {ICON.omit}
          <span>線を省略</span>
        </Btn>
      )}
      {edge && !tagged && (
        <Btn
          className="labeled"
          tip="この線の途中に分岐点を入れる（点から別の機材へ線を引けます。線の上に線をドロップしても分岐します）"
          onClick={() => {
            // The middle of the longest straight run: clear of the bends and of both ends.
            const pts = routeEdges(doc).get(edge.id) ?? [];
            const runs = pts.slice(1).map((q, i) => ({ p: pts[i], q, len: Math.hypot(q.x - pts[i].x, q.y - pts[i].y) }));
            const run = runs.sort((a, b) => b.len - a.len)[0];
            const cut = run && splitEdge(doc, edge.id, { x: (run.p.x + run.q.x) / 2, y: (run.p.y + run.q.y) / 2 });
            if (!cut) return;
            st().setDoc(cut.doc);
            st().select([cut.junction]);
          }}
        >
          {ICON.branch}
          <span>分岐</span>
        </Btn>
      )}
      {edge?.route && !tagged && (
        <Btn className="labeled" tip="手で動かした曲がりを消して、自動の経路に戻す" onClick={() => st().updateEdge(edge.id, { route: undefined })}>
          {ICON.reset}
          <span>自動経路に</span>
        </Btn>
      )}
      {edge && <i />}

      {deviceLink && (
        <Btn className="labeled" tip={deviceLink} onClick={() => window.open(deviceLink, '_blank', 'noopener')}>
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
