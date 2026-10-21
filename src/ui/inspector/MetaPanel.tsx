import { LABEL_SIZE, LABEL_SIZES } from '../../model/labels';
import { type BoardKind, KINDS, KIND_ORDER, kindOf } from '../../model/kinds';
import { useStore } from '../../model/store';
import { type Doc, type DocMeta, type Node } from '../../model/types';
import { useShallow } from 'zustand/react/shallow';
import { Revisions } from '../Revisions';
import { useBurst } from '../burst';
import { Field, Section } from './fields';

/** Pictures laid under the drawing (floor plans): they cannot be clicked, so they are managed here. */
function Underlays() {
  const list = useStore(useShallow((s) => s.doc.nodes.filter((n): n is Extract<Node, { type: 'image' }> => n.type === 'image' && !!n.under)));
  const patch = (id: string, p: Partial<Node>, record = false) => useStore.getState().updateNode(id, p, record);
  const burst = useBurst();
  if (!list.length) return null;
  return (
    <>
      <h4>下敷き</h4>
      {list.map((n) => (
        <div key={n.id} className="underlay">
          <span>{n.text || n.id}</span>
          <input type="range" min={0.1} max={1} step={0.05} value={n.opacity ?? 0.55} onChange={(e) => {
              burst();
              patch(n.id, { opacity: Number(e.target.value) });
            }} title="濃さ" />
          <button
            className="mini"
            onClick={() => {
              patch(n.id, { under: undefined }, true);
              useStore.getState().select([n.id]);
            }}
          >
            やめる
          </button>
        </div>
      ))}
    </>
  );
}

export function MetaPanel() {
  const meta = useStore((s) => s.doc.meta);
  const boardId = useStore((s) => s.doc.id);
  const kind = useStore((s) => kindOf(s.doc));
  const powerTags = useStore((s) => s.doc.powerTags !== false);
  const idLabels = useStore((s) => s.doc.cableIdLabels !== false);
  const lenLabels = useStore((s) => s.doc.lengthLabels !== false);
  const stackLabels = useStore((s) => s.doc.stackedLabels === true);
  const hops = useStore((s) => s.doc.hops === true);
  const labelSize = useStore((s) => s.doc.labelSize ?? LABEL_SIZE);
  // A board-wide choice applies to every line: per-line exceptions for it are cleared.
  const boardLabel = (change: Partial<Doc>, clear: 'showLength' | 'stacked') =>
    useStore.getState().mutate((d) => ({ ...d, ...change, edges: d.edges.map((x) => (x[clear] === undefined ? x : { ...x, [clear]: undefined })) }));
  const set = (k: keyof DocMeta) => (v: string) => useStore.getState().mutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }), false);
  return (
    <>
      <h3>ボード設定</h3>
      <p className="hint board-lead">何も選んでいないときは、このボード全体の設定が出ます。</p>
      <Section title="基本情報">
        <Field label="タイトル（図面名称）" value={meta.title} onChange={set('title')} />
        <Field label="案件名" value={meta.project} onChange={set('project')} />
        <label className="field">
          <span>ボードの種類</span>
          {/* Changing the kind changes what the board offers; what is drawn on it stays. */}
          <select value={kind.id} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, kind: e.target.value === 'system' ? undefined : (e.target.value as BoardKind) }))}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KINDS[k].label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">タイトルと案件名は、PDF・Excel の見出しに入ります。</p>
      </Section>
      <Section title="線とラベル" note="すべての線に適用">
        <label className="field">
          <span>ラベルの文字サイズ</span>
          <select value={labelSize} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, labelSize: Number(e.target.value) === LABEL_SIZE ? undefined : Number(e.target.value), edges: d.edges.map((x) => (x.fontSize === undefined ? x : { ...x, fontSize: undefined })) }))}>
            {LABEL_SIZES.map((o) => (
              <option key={o.size} value={o.size}>
                {o.label}（{o.size}px）
              </option>
            ))}
          </select>
        </label>
        {kind.cableOptions && (
          <>
            <span className="group-label">ラベルに出すもの</span>
            <label className="check">
              <input type="checkbox" checked={idLabels} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, cableIdLabels: e.target.checked, edges: d.edges.map((x) => (x.showId === undefined ? x : { ...x, showId: undefined })) }))} />
              ケーブル ID
            </label>
            <label className="check">
              <input type="checkbox" checked={lenLabels} onChange={(e) => boardLabel({ lengthLabels: e.target.checked }, 'showLength')} />
              ケーブルの長さ
            </label>
            <label className="check">
              <input type="checkbox" checked={stackLabels} onChange={(e) => boardLabel({ stackedLabels: e.target.checked }, 'stacked')} />
              項目を 1 行ずつに分ける
            </label>
            <span className="group-label">線の描き方</span>
            <label className="check">
              <input type="checkbox" checked={powerTags} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, powerTags: e.target.checked }))} />
              電源ケーブルは線を省略（両端に接続先だけ表示）
            </label>
          </>
        )}
        {kind.id === 'software' && (
          <label className="check">
            <input type="checkbox" checked={stackLabels} onChange={(e) => boardLabel({ stackedLabels: e.target.checked }, 'stacked')} />
            通信の種別・ポートと文を 1 行ずつに分ける
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={hops} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, hops: e.target.checked || undefined }))} />
          交差するところを跨ぎ線（小さな山）にする
        </label>
        <p className="hint">線ごとに変えたいときは、その線を選んで右パネルで設定できます（ここで変えると、線ごとの設定は解除されます）。</p>
      </Section>
      <Underlays />
      {/* Its own per board: a name half typed for one board's state never lands on another's. */}
      <Revisions key={boardId} />
      <p className="hint">
        <b>操作</b>
        <br />
        ダブルクリック: 文字編集 ／ 辺の●やポートをドラッグ: 接続 ／ スクロール: 移動 ／ ⌘+スクロール: ズーム ／ Space+ドラッグ: パン
      </p>
    </>
  );
}
