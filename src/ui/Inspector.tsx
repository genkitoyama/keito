import { useRef, useState } from 'react';
import { isTagged } from '../model/geometry';
import { LINE_COLORS, lineColor, paintLine } from '../model/lineColor';
import { freshId } from '../model/presets';
import { COLOR_KEYS, PALETTE, SIGNALS, STICKY } from '../model/signals';
import { readImageFile } from '../platform/storage';
import { align, storeImage, useStore } from '../model/store';
import type { Arrow, DeviceNode, DocMeta, Edge, Node, Port, ShapeKind } from '../model/types';
import { FILLS, FillPreview, SHAPES } from './icons';

/** Text input that records one undo step per editing burst instead of per keystroke. */
function Field({ label, value, onChange, multiline, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; type?: string; placeholder?: string }) {
  const dirty = useRef(false);
  const props = {
    value,
    placeholder,
    onFocus: () => (dirty.current = false),
    onChange: (e: { target: { value: string } }) => {
      if (!dirty.current) {
        dirty.current = true;
        useStore.getState().checkpoint();
      }
      onChange(e.target.value);
    },
  };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea rows={multiline ? 4 : 1} {...props} /> : <input type={type} {...props} />}
    </label>
  );
}

function Colors({ value, onPick, sticky }: { value: string; onPick: (c: (typeof COLOR_KEYS)[number]) => void; sticky?: boolean }) {
  const palette = sticky ? STICKY : PALETTE;
  return (
    <div className="swatches">
      {COLOR_KEYS.map((c) => (
        <button key={c} className={c === value ? 'on' : ''} style={{ background: palette[c].fill, borderColor: palette[c].stroke }} onClick={() => onPick(c)} title={c} />
      ))}
    </div>
  );
}

const SignalSelect = ({ value, onChange, flow }: { value: string; onChange: (v: string) => void; flow?: boolean }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}>
    {SIGNALS.filter((s) => flow || s.id !== 'flow').map((s) => (
      <option key={s.id} value={s.id}>{s.label}</option>
    ))}
  </select>
);

function MetaPanel() {
  const meta = useStore((s) => s.doc.meta);
  const powerTags = useStore((s) => s.doc.powerTags !== false);
  const set = (k: keyof DocMeta) => (v: string) => useStore.getState().mutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }), false);
  return (
    <>
      <h3>ボード情報</h3>
      <Field label="タイトル（図面名称）" value={meta.title} onChange={set('title')} />
      <Field label="案件名" value={meta.project} onChange={set('project')} />
      <Field label="図番" value={meta.drawingNo} onChange={set('drawingNo')} />
      <Field label="作成者" value={meta.author} onChange={set('author')} />
      <Field label="REV" value={meta.rev} onChange={set('rev')} />
      <Field label="会社" value={meta.company} onChange={set('company')} />
      <label className="check">
        <input type="checkbox" checked={powerTags} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, powerTags: e.target.checked }))} />
        電源ケーブルは線を省略（両端に接続先だけ表示）
      </label>
      <p className="hint">
        これらは CAD 風エクスポートの表題欄に入ります。
        <br />
        <br />
        <b>操作</b>
        <br />
        ダブルクリック: 文字編集 ／ 辺の●やポートをドラッグ: 接続 ／ スクロール: 移動 ／ ⌘+スクロール: ズーム ／ Space+ドラッグ: パン
      </p>
    </>
  );
}

const num = (v: string): number | undefined => (v === '' || isNaN(Number(v)) ? undefined : Number(v));

function DevicePanel({ n }: { n: DeviceNode }) {
  const st = useStore.getState;
  const patch = (p: Partial<DeviceNode>, record = false) => st().updateNode(n.id, p, record);
  const setPort = (id: string, p: Partial<Port>, record: boolean) => patch({ ports: n.ports.map((x) => (x.id === id ? { ...x, ...p } : x)) }, record);
  const addPort = (side: Port['side']) =>
    patch({ ports: [...n.ports, { id: freshId(new Set(n.ports.map((p) => p.id)), 'p'), name: side === 'left' ? 'IN' : 'OUT', side, signal: 'hdmi' }] }, true);
  const removePort = (id: string) =>
    st().mutate((d) => ({
      ...d,
      nodes: d.nodes.map((x) => (x.id === n.id ? { ...n, ports: n.ports.filter((p) => p.id !== id) } : x)),
      edges: d.edges.filter((e) => !((e.from.node === n.id && e.from.port === id) || (e.to.node === n.id && e.to.port === id))),
    }));
  const move = (id: string, dir: -1 | 1) => {
    const port = n.ports.find((p) => p.id === id)!;
    const same = n.ports.filter((p) => p.side === port.side);
    const other = same[same.indexOf(port) + dir];
    if (!other) return;
    patch({ ports: n.ports.map((p) => (p === port ? other : p === other ? port : p)) }, true);
  };
  return (
    <>
      <h3>機材 <code>{n.id}</code></h3>
      <Field label="名称" value={n.text} onChange={(v) => patch({ text: v })} />
      <Field label="メーカー" value={n.maker} onChange={(v) => patch({ maker: v })} />
      <Field label="型番" value={n.model} onChange={(v) => patch({ model: v })} />
      <Field label="カテゴリ" value={n.category} onChange={(v) => patch({ category: v })} />
      <Field label="備考" value={n.note} onChange={(v) => patch({ note: v })} />
      <label className="field">
        <span>色分け（手配元・系統など）</span>
        <Colors value={n.color ?? 'gray'} onPick={(color) => patch({ color }, true)} />
      </label>
      <div className="grid2">
        <Field label="消費電力 (W)" type="number" value={n.watts == null ? '' : String(n.watts)} onChange={(v) => patch({ watts: num(v) })} />
        <Field label="給電容量 (W)" type="number" placeholder="UPS・タップ" value={n.capacity == null ? '' : String(n.capacity)} onChange={(v) => patch({ capacity: num(v) })} />
      </div>
      {(['left', 'right'] as const).map((side) => (
        <div key={side}>
          <h4>
            {side === 'left' ? '入力ポート（左）' : '出力ポート（右）'}
            <button className="mini" onClick={() => addPort(side)}>＋追加</button>
          </h4>
          {n.ports
            .filter((p) => p.side === side)
            .map((p) => (
              <div className="port-row" key={p.id}>
                <PortName value={p.name} onChange={(v) => setPort(p.id, { name: v }, false)} />
                <SignalSelect value={p.signal} onChange={(v) => setPort(p.id, { signal: v }, true)} />
                <button className="mini" onClick={() => move(p.id, -1)} title="上へ">↑</button>
                <button className="mini" onClick={() => move(p.id, 1)} title="下へ">↓</button>
                <button className="mini" onClick={() => setPort(p.id, { side: side === 'left' ? 'right' : 'left' }, true)} title="反対側へ">⇄</button>
                <button className="mini danger" onClick={() => removePort(p.id)} title="削除">×</button>
              </div>
            ))}
        </div>
      ))}
    </>
  );
}

function PortName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const dirty = useRef(false);
  return (
    <input
      value={value}
      onFocus={() => (dirty.current = false)}
      onChange={(e) => {
        if (!dirty.current) {
          dirty.current = true;
          useStore.getState().checkpoint();
        }
        onChange(e.target.value);
      }}
    />
  );
}


function NodePanel({ n }: { n: Node }) {
  const patch = (p: Partial<Node>, record = false) => useStore.getState().updateNode(n.id, p, record);
  if (n.type === 'device') return <DevicePanel n={n} />;
  if (n.type === 'sequence') {
    return (
      <>
        <h3>シーケンス図</h3>
        <Field label="ソース" value={n.text} onChange={(v) => patch({ text: v })} multiline />
        <p className="hint">
          <code>A -&gt; B: メッセージ</code>　実線
          <br />
          <code>B --&gt; A: 応答</code>　破線
          <br />
          <code>participant A as 表示名</code>
          <br />
          <code>note over A: メモ</code>　／　<code>title: 題名</code>
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
          alert(e instanceof Error ? e.message : String(e));
        }
      };
      input.click();
    };
    return (
      <>
        <h3>画像 <code>{n.id}</code></h3>
        <Field label="名前" value={n.text} onChange={(v) => patch({ text: v })} />
        <p className="hint">
          {Math.round(n.w)} × {Math.round(n.h)} px{n.src.startsWith('asset:') ? ` ／ ${n.src.slice(6)}` : ''}
          <br />
          角をドラッグで比率を保ったまま拡縮（Shift で自由変形）。
        </p>
        <button onClick={replace}>画像を差し替え</button>
      </>
    );
  }
  return (
    <>
      <h3>{n.type === 'shape' ? '図形' : n.type === 'sticky' ? '付箋' : n.type === 'frame' ? 'エリア枠' : 'テキスト'} <code>{n.id}</code></h3>
      <Field label={n.type === 'frame' ? 'エリア名（機材リストの設置場所になります）' : 'テキスト'} value={n.text} onChange={(v) => patch({ text: v })} multiline={n.type !== 'frame'} />
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
      {(n.type === 'shape' || n.type === 'sticky') && <Colors sticky={n.type === 'sticky'} value={n.color} onPick={(color) => patch({ color }, true)} />}
    </>
  );
}

function EdgePanel({ e }: { e: Edge }) {
  const tagged = useStore((s) => isTagged(s.doc, e));
  const color = useStore((s) => lineColor(s.doc, e));
  const custom = useStore((s) => !!s.doc.signalColors?.[e.signal]);
  // Cables are colour-coded by type; arrows one by one.
  const [all, setAll] = useState(e.signal !== 'flow');
  const paint = (c: string | null) => useStore.getState().mutate((d) => paintLine(d, e.id, c, all));
  const patch = (p: Partial<Edge>, record = false) => useStore.getState().updateEdge(e.id, p, record);
  return (
    <>
      <h3>{e.signal === 'flow' ? 'コネクタ' : 'ケーブル'}</h3>
      <label className="field">
        <span>種別</span>
        <SignalSelect flow value={e.signal} onChange={(signal) => patch({ signal, arrow: signal === 'flow' ? 'end' : e.arrow }, true)} />
      </label>
      <div className="field">
        <span>線の色</span>
        <div className="line-colors">
          {LINE_COLORS.map((c) => (
            <button key={c} className={color.toLowerCase() === c ? 'on' : ''} style={{ background: c }} aria-label={c} onClick={() => paint(c)} />
          ))}
          <input type="color" value={color} onChange={(ev) => paint(ev.target.value)} title="ほかの色を選ぶ" />
        </div>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(ev) => setAll(ev.target.checked)} />
          同じ種別（{SIGNALS.find((s) => s.id === e.signal)?.label}）の線すべてに適用
        </label>
        {(e.color || custom) && (
          <button className="mini" onClick={() => paint(null)}>
            既定の色に戻す
          </button>
        )}
      </div>
      <Field label="ラベル" value={e.label} onChange={(v) => patch({ label: v })} />
      {e.signal !== 'flow' && (
        <Field label="長さ (m)" type="number" value={e.length == null ? '' : String(e.length)} onChange={(v) => patch({ length: v === '' || isNaN(Number(v)) ? null : Number(v) })} />
      )}
      <label className="field">
        <span>矢印</span>
        <select value={e.arrow} onChange={(ev) => patch({ arrow: ev.target.value as Arrow }, true)}>
          <option value="none">なし</option>
          <option value="end">終点</option>
          <option value="both">両端</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={!!e.dash} onChange={(ev) => patch({ dash: ev.target.checked }, true)} />
        点線にする
      </label>
      {e.signal !== 'flow' && (
        <label className="check">
          <input type="checkbox" checked={tagged} onChange={(ev) => patch({ tag: ev.target.checked, route: undefined }, true)} />
          線を省略（両端に接続先だけ表示）
        </label>
      )}
      {e.route && <button onClick={() => patch({ route: undefined }, true)}>経路を自動に戻す</button>}
      <Field label="備考" value={e.note} onChange={(v) => patch({ note: v })} />
      <button onClick={() => patch({ from: e.to, to: e.from }, true)}>向きを反転</button>
    </>
  );
}

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const remove = () => useStore.getState().removeIds(selection);
  let body;
  if (selection.length === 0) body = <MetaPanel />;
  else if (selection.length === 1) {
    const node = doc.nodes.find((n) => n.id === selection[0]);
    const edge = doc.edges.find((e) => e.id === selection[0]);
    body = node ? <NodePanel key={node.id} n={node} /> : edge ? <EdgePanel key={edge.id} e={edge} /> : null;
  } else {
    body = (
      <>
        <h3>{selection.length} 個を選択中</h3>
        <div className="grid2">
          <button onClick={() => align('left')}>左揃え</button>
          <button onClick={() => align('top')}>上揃え</button>
          <button onClick={() => align('hcenter')}>左右中央</button>
          <button onClick={() => align('vcenter')}>上下中央</button>
          <button onClick={() => align('hspace')}>横に等間隔</button>
          <button onClick={() => align('vspace')}>縦に等間隔</button>
        </div>
      </>
    );
  }
  return (
    <aside className="inspector">
      {body}
      {selection.length > 0 && <button className="danger wide" onClick={remove}>削除</button>}
    </aside>
  );
}
