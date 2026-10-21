import { pinLabel } from '../../model/comments';
import { legendRows } from '../../model/legend';
import { readImageFile } from '../../platform/storage';
import { tell } from '../../platform/io';
import { storeImage, useStore } from '../../model/store';
import { type Node, type ShapeKind, type StickyNode } from '../../model/types';
import { FILLS, FillPreview, SHAPES, sizesFor } from '../icons';
import { useBurst } from '../burst';
import { Field, Section, Head, Colors, TextStyle } from './fields';
import { DevicePanel } from './DevicePanel';

export function NodePanel({ n }: { n: Node }) {
  const patch = (p: Partial<Node>, record = false) => useStore.getState().updateNode(n.id, p, record);
  const burst = useBurst();
  if (n.type === 'device') return <DevicePanel key={n.id} n={n} />;
  if (n.type === 'sequence') {
    return (
      <>
        <Head title="シーケンス図" id={n.id} />
        <Section title="ソース">
          <div className="seq-source">
            <Field label="テキストで書きます" value={n.text} onChange={(v) => patch({ text: v })} multiline />
          </div>
          <details className="howto">
            <summary>書き方</summary>
            <p className="hint">
              <code>A -&gt; B: メッセージ</code>　実線
              <br />
              <code>B --&gt; A: 応答</code>　破線
              <br />
              <code>participant A as 表示名</code>
              <br />
              <code>note over A: メモ</code>　／　<code>title: 題名</code>
              <br />
              <code>loop 3回</code> … <code>end</code>　／　<code>alt 条件</code> … <code>else</code> … <code>end</code>　枠で囲む
              <br />
              Mermaid（<code>sequenceDiagram</code>）や PlantUML（<code>@startuml</code>）のシーケンス図をそのまま貼っても読めます。
            </p>
          </details>
        </Section>
        <Section title="見た目">
          <TextStyle n={n} />
          <p className="hint">角をドラッグで大きさを変えられます（列と行の間隔が広がります）。文字を大きくすると、図全体がそれに合わせて大きくなります。</p>
          {(n.w > 0 || n.h > 0) && <button onClick={() => patch({ w: 0, h: 0 }, true)}>大きさを自動に戻す</button>}
        </Section>
      </>
    );
  }
  if (n.type === 'legend') {
    const doc = useStore.getState().doc;
    const rows = legendRows(doc, n);
    return (
      <>
        <Head title="凡例" id={n.id} />
        <Section title="見出し">
          <Field label="空にすると見出しを出しません" value={n.text} onChange={(v) => patch({ text: v })} />
        </Section>
        <Section title="並べる行" note="チェックを外すと出しません">
          {rows.map((row) => (
            <div key={row.color} className={`legend-row${row.hidden ? ' off' : ''}`}>
              <input
                type="checkbox"
                checked={!row.hidden}
                title={row.hidden ? 'この行を凡例に出す' : 'この行を凡例から外す'}
                onChange={(e) => {
                  const hidden = e.target.checked ? (n.hidden ?? []).filter((c) => c !== row.color) : [...(n.hidden ?? []), row.color];
                  patch({ hidden: hidden.length ? hidden : undefined }, true);
                }}
              />
              <span className="swatch" style={{ background: row.color }} />
              <input
                value={n.names?.[row.color] ?? ''}
                placeholder={row.usual}
                onChange={(e) => {
                  burst();
                  const names = { ...n.names, [row.color]: e.target.value };
                  if (!e.target.value) delete names[row.color];
                  patch({ names: Object.keys(names).length ? names : undefined });
                }}
              />
            </div>
          ))}
          <p className="hint">
            このボードで使っている線の色が 1 行ずつ並びます。同じ色の種別は 1 行にまとまり、名前を書くとその行の呼び名になります（空なら種別の名前）。線の色を変えると自動で追従します。
          </p>
        </Section>
      </>
    );
  }
  if (n.type === 'junction') {
    const lines = useStore.getState().doc.edges.filter((e) => e.from.node === n.id || e.to.node === n.id).length;
    return (
      <>
        <Head title="分岐点" id={n.id} />
        <p className="hint">
          {lines} 本の線がここでつながっています。
          <br />
          点を選ぶと出る ● をドラッグすると、ここから別の機材へ線を引けます。
        </p>
      </>
    );
  }
  if (n.type === 'image') {
    const replace = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.svg';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          const img = await readImageFile(f);
          // Keep the width the picture already has on the board; follow the new proportions.
          patch({ src: await storeImage(img.src), text: img.name, h: Math.round((n.w * img.h) / img.w) }, true);
        } catch (e) {
          void tell(e instanceof Error ? e.message : String(e));
        }
      };
      input.click();
    };
    return (
      <>
        <Head title="画像" id={n.id} />
        <Section title="画像">
          <Field label="名前" value={n.text} onChange={(v) => patch({ text: v })} />
          <p className="hint">
            {Math.round(n.w)} × {Math.round(n.h)} px{n.src.startsWith('asset:') ? ` ／ ${n.src.slice(6)}` : ''}
            <br />
            角をドラッグで比率を保ったまま拡縮（Shift で自由変形）。
          </p>
          <button onClick={replace}>画像を差し替え</button>
        </Section>
        <Section title="キャプション">
          <Field label="テキスト（画像の上か下に出ます）" value={n.caption ?? ''} onChange={(v) => patch({ caption: v || undefined })} multiline />
          <div className="grid2">
            <label className="field">
              <span>位置</span>
              <select value={n.captionAt ?? 'bottom'} onChange={(e) => patch({ captionAt: e.target.value === 'top' ? 'top' : undefined }, true)}>
                <option value="bottom">画像の下</option>
                <option value="top">画像の上</option>
              </select>
            </label>
            <label className="field">
              <span>文字の大きさ</span>
              <select value={String(n.fontSize ?? '')} onChange={(e) => patch({ fontSize: e.target.value ? Number(e.target.value) : undefined }, true)}>
                {sizesFor('image').map((o) => (
                  <option key={o.label} value={o.px ?? ''}>{o.label}</option>
                ))}
                {n.fontSize != null && !sizesFor('image').some((o) => o.px === n.fontSize) && <option value={n.fontSize}>{n.fontSize}px</option>}
              </select>
            </label>
          </div>
        </Section>
        <button className="wide" data-tip="平面図などを一番下に敷き、クリックで選ばれないようにします（戻すのはボード設定から）" onClick={() => patch({ under: true }, true)}>
          下敷きにする
        </button>
      </>
    );
  }
  return (
    <>
      <Head title={n.type === 'shape' ? '図形' : n.type === 'sticky' ? '付箋（コメント）' : n.type === 'frame' ? 'エリア枠' : 'テキスト'} id={n.id} />
      <Section title={n.type === 'sticky' ? 'コメント' : '内容'}>
        <Field label={n.type === 'frame' ? 'エリア名（機材リストの設置場所になります）' : 'テキスト'} value={n.text} onChange={(v) => patch({ text: v })} multiline={n.type !== 'frame'} />
        {n.type === 'sticky' && (
          <>
            <PinNote n={n} />
            {n.done ? (
              <div className="row">
                <span className="settled">✓ 解決済み</span>
                <button onClick={() => patch({ done: undefined }, true)}>未解決に戻す</button>
              </div>
            ) : (
              <button className="primary wide" onClick={() => patch({ done: true }, true)}>
                ✓ 解決済みにする
              </button>
            )}
            <p className="hint">付箋はコメントとして上の「コメント」に一覧で並びます。書き出しには、エクスポートで選んだときだけ入ります。</p>
          </>
        )}
      </Section>
      <Section title="見た目">
        {n.type === 'shape' && (
          <label className="field">
            <span>形</span>
            <select value={n.shape} onChange={(e) => patch({ shape: e.target.value as ShapeKind }, true)}>
              {SHAPES.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </label>
        )}
        {n.type === 'shape' && (
          <>
            <div className="field">
              <span>塗り</span>
              <div className="fills">
                {FILLS.map((f) => (
                  <button key={f.id} className={(n.fill ?? 'tint') === f.id ? 'on' : ''} data-tip={f.label} onClick={() => patch({ fill: f.id }, true)}>
                    <FillPreview fill={f.id} color={n.color} dash={n.dash} />
                    <small>{f.short}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={!!n.dash} onChange={(e) => patch({ dash: e.target.checked }, true)} />
              枠を点線にする
            </label>
          </>
        )}
        {(n.type === 'shape' || n.type === 'sticky' || n.type === 'text' || n.type === 'frame') && <TextStyle n={n} />}
        {n.type === 'frame' && <Colors value={n.color ?? 'gray'} onPick={(color) => patch({ color }, true)} />}
        {(n.type === 'shape' || n.type === 'sticky') && <Colors sticky={n.type === 'sticky'} value={n.color} onPick={(color) => patch({ color }, true)} />}
      </Section>
    </>
  );
}

/** Which sequence item a comment is pinned to, if any: set by where the sticky is put. */
function PinNote({ n }: { n: StickyNode }) {
  const doc = useStore((s) => s.doc);
  const pin = pinLabel(doc, n);
  if (!pin) return <p className="hint">シーケンス図の矢印やノートの上に置くと、その処理へのコメントになり、書き換えても付いていきます。</p>;
  return <p className={`pin-note${pin.lost ? ' lost' : ''}`}>{pin.lost ? '対象の処理がシーケンス図から消えました。別の処理の上に置き直すと付け直せます。' : `対象: ${pin.text}`}</p>;
}
