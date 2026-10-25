import { useState } from 'react';
import { isTagged } from '../../model/geometry';
import { safeUrl } from '../../model/url';
import { LINE_COLORS, lineColor, lineDashed, paintLine } from '../../model/lineColor';
import { cableIds, idShown, labelStacked, lengthShown } from '../../model/lists';
import { kindOf } from '../../model/kinds';
import { signalOf } from '../../model/signals';
import { linkClick } from '../../platform/io';
import { useStore } from '../../model/store';
import { type Arrow, type Edge } from '../../model/types';
import { useBurst } from '../burst';
import { Field, Section, Head, SignalSelect, SignalHowTo, NewSignal, LabelSizeField } from './fields';

export function EdgePanel({ e }: { e: Edge }) {
  const tagged = useStore((s) => isTagged(s.doc, e));
  const shown = useStore((s) => idShown(s.doc, e));
  const lenShown = useStore((s) => lengthShown(s.doc, e));
  const stacked = useStore((s) => labelStacked(s.doc, e));
  // What the ID would be if left to the automatic numbering.
  const autoId = useStore((s) => cableIds({ ...s.doc, edges: s.doc.edges.map((x) => (x.id === e.id ? { ...x, cableId: undefined } : x)) }).get(e.id) ?? '');
  const color = useStore((s) => lineColor(s.doc, e));
  const custom = useStore((s) => !!s.doc.signalColors?.[e.signal]);
  // Cables are colour-coded by type; arrows one by one.
  const [all, setAll] = useState(e.signal !== 'flow');
  const burst = useBurst();
  // A swatch is one step; the picker, dragged round, sends colour after colour: one step for them all.
  const paint = (c: string | null, picker = false) => {
    if (picker) burst();
    useStore.getState().mutate((d) => paintLine(d, e.id, c, all), !picker);
  };
  const patch = (p: Partial<Edge>, record = false) => useStore.getState().updateEdge(e.id, p, record);
  const cable = signalOf(e.signal).cable;
  const protocol = !!signalOf(e.signal).protocol;
  const kind = useStore((s) => kindOf(s.doc));
  return (
    <>
      <Head title={cable ? 'ケーブル' : protocol ? '通信' : 'コネクタ'} />
      <Section title={cable ? 'ケーブル情報' : '種別'}>
        <label className="field">
          <span>種別</span>
          <SignalSelect flow value={e.signal} onChange={(signal) => patch({ signal, arrow: signal === 'flow' || signalOf(signal).protocol ? 'end' : signalOf(signal).cable ? 'none' : e.arrow }, true)} />
        </label>
        {/* Types of one's own are cables; a software board's protocols are the set offered. */}
        {kind.cableOptions && <NewSignal onAdd={(signal) => patch({ signal, arrow: 'none' })} />}
        {cable && <SignalHowTo />}
        {protocol && <Field label="ポート" placeholder="例: 443/tcp、7000/udp" value={e.spec ?? ''} onChange={(v) => patch({ spec: v || undefined })} />}
        {cable && (
          <>
            <div className="grid2">
              <Field label="ケーブル ID" placeholder={`自動: ${autoId}`} value={e.cableId ?? ''} onChange={(v) => patch({ cableId: v || undefined })} />
              <Field label="長さ (m)" type="number" value={e.length == null ? '' : String(e.length)} onChange={(v) => patch({ length: v === '' || isNaN(Number(v)) ? null : Number(v) })} />
            </div>
            <Field label="品名・規格" placeholder="例: 光 HDMI AOC / Cat6A STP" value={e.spec ?? ''} onChange={(v) => patch({ spec: v || undefined })} />
            <div className="grid2">
              <Field label="メーカー" value={e.maker ?? ''} onChange={(v) => patch({ maker: v || undefined })} />
              <Field label="型番" value={e.model ?? ''} onChange={(v) => patch({ model: v || undefined })} />
            </div>
            <Field label="リンク（製品ページなど）" placeholder="https://…" value={e.url ?? ''} onChange={(v) => patch({ url: v || undefined })} />
            {e.url &&
              (safeUrl(e.url) ? (
                <a className="open-link" href={safeUrl(e.url)} target="_blank" rel="noopener noreferrer" onClick={linkClick(safeUrl(e.url))}>
                  {safeUrl(e.url)!.replace(/^https?:\/\/(www\.)?/, '')} を開く ↗
                </a>
              ) : (
                <p className="error">Web のアドレス（https://…）として読めません。</p>
              ))}
          </>
        )}
        <Field wrap label="備考" value={e.note} onChange={(v) => patch({ note: v })} />
      </Section>
      <Section title="ラベル">
        <Field wrap label="文（改行できます）" value={e.label} onChange={(v) => patch({ label: v })} />
        {cable && (
          <>
            <span className="group-label">ラベルに出すもの（品名・規格は書いてあれば出ます）</span>
            <label className="check">
              <input type="checkbox" checked={shown} onChange={(ev) => patch({ showId: ev.target.checked }, true)} />
              ケーブル ID
            </label>
            <label className="check">
              <input type="checkbox" checked={lenShown} onChange={(ev) => patch({ showLength: ev.target.checked }, true)} />
              長さ
            </label>
            <label className="check">
              <input type="checkbox" checked={stacked} onChange={(ev) => patch({ stacked: ev.target.checked }, true)} />
              項目（ID・品名・文・長さ）を 1 行ずつに分ける
            </label>
          </>
        )}
        {protocol && (
          <label className="check">
            <input type="checkbox" checked={stacked} onChange={(ev) => patch({ stacked: ev.target.checked }, true)} />
            種別・ポートと文を 1 行ずつに分ける
          </label>
        )}
        <LabelSizeField edges={[e]} />
      </Section>
      <Section title="線の見た目">
        <div className="field">
          <span>線の色</span>
          <div className="line-colors">
            {LINE_COLORS.map((c) => (
              <button key={c} className={color.toLowerCase() === c ? 'on' : ''} style={{ background: c }} aria-label={c} onClick={() => paint(c)} />
            ))}
            <input type="color" value={color} onChange={(ev) => paint(ev.target.value, true)} title="ほかの色を選ぶ" />
          </div>
          <label className="check">
            <input type="checkbox" checked={all} onChange={(ev) => setAll(ev.target.checked)} />
            同じ種別（{signalOf(e.signal).label}）の線すべてに適用
          </label>
          {(e.color || custom) && (
            <button className="mini" onClick={() => paint(null)}>
              既定の色に戻す
            </button>
          )}
        </div>
        {/* A cable's direction is its From → To; arrowheads are for flow lines (or to take one off a cable). */}
        {(!cable || e.arrow !== 'none') && (
          <label className="field">
            <span>矢印</span>
            <select value={e.arrow} onChange={(ev) => patch({ arrow: ev.target.value as Arrow }, true)}>
              <option value="none">なし</option>
              <option value="end">終点</option>
              <option value="both">両端</option>
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={lineDashed(e)} onChange={(ev) => patch({ dash: ev.target.checked }, true)} />
          点線にする
        </label>
        {cable && (
          <label className="check">
            <input type="checkbox" checked={tagged} onChange={(ev) => patch({ tag: ev.target.checked, route: undefined }, true)} />
            線を省略（両端に接続先だけ表示）
          </label>
        )}
      </Section>
      <div className="row panel-actions">
        {e.route && <button onClick={() => patch({ route: undefined }, true)}>経路を自動に戻す</button>}
        <button
          onClick={() =>
            // Hand-placed bends and the label position run from end to end: turn them round too.
            patch({ from: e.to, to: e.from, route: e.route && [...e.route].reverse(), labelAt: e.labelAt == null ? undefined : 1 - e.labelAt }, true)
          }
        >
          向きを反転
        </button>
      </div>
    </>
  );
}
