import { legendRows } from '../model/legend';
import { useRef, useState } from 'react';
import { isTagged } from '../model/geometry';
import { safeUrl } from '../model/url';
import { LINE_COLORS, lineColor, paintLine } from '../model/lineColor';
import { cableIds, colourKey, idShown, labelStacked, lengthShown, quantityOf } from '../model/lists';
import { PRESETS, freshId } from '../model/presets';
import { COLOR_KEYS, PALETTE, STICKY, allSignals, signalOf } from '../model/signals';
import { readImageFile } from '../platform/storage';
import { align, storeImage, useStore } from '../model/store';
import { type Arrow, type DeviceNode, type Doc, type DocMeta, type Edge, type Node, type Port, type ShapeKind, latestRev } from '../model/types';
import { FILLS, FillPreview, SHAPES, sizesFor } from './icons';
import { textHeightFor, textWeight } from '../canvas/render';
import { useShallow } from 'zustand/react/shallow';
import { Revisions } from './Revisions';

/** Text input that records one undo step per editing burst instead of per keystroke. */
function Field({ label, value, onChange, multiline, wrap, type = 'text', placeholder, onPasteText, list }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; wrap?: boolean; type?: string; placeholder?: string; onPasteText?: (text: string) => boolean; list?: string }) {
  const dirty = useRef(false);
  const props = {
    value,
    placeholder,
    // Lets a field hand pasted text to another one (a URL pasted into the model field, say).
    onPaste: (e: { clipboardData: DataTransfer; preventDefault: () => void }) => {
      if (onPasteText?.(e.clipboardData.getData('text/plain'))) e.preventDefault();
    },
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
      {/* `wrap`: a box that grows with its text, so a long note is all in view and selecting in it never scrolls the field. */}
      {wrap ? <textarea className="wrap" rows={1} {...props} /> : multiline ? <textarea rows={4} {...props} /> : <input type={type} list={list} {...props} />}
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
    {allSignals().filter((s) => flow || s.id !== 'flow').map((s) => (
      <option key={s.id} value={s.id}>{s.label}</option>
    ))}
  </select>
);

function MetaPanel() {
  const meta = useStore((s) => s.doc.meta);
  // While an old revision is on screen, that revision is the one shown.
  const rev = useStore((s) => s.viewing?.entry.rev ?? latestRev(s.doc));
  const powerTags = useStore((s) => s.doc.powerTags !== false);
  const idLabels = useStore((s) => s.doc.cableIdLabels !== false);
  const lenLabels = useStore((s) => s.doc.lengthLabels !== false);
  const stackLabels = useStore((s) => s.doc.stackedLabels === true);
  const hops = useStore((s) => s.doc.hops === true);
  // A board-wide choice applies to every line: per-line exceptions for it are cleared.
  const boardLabel = (change: Partial<Doc>, clear: 'showLength' | 'stacked') =>
    useStore.getState().mutate((d) => ({ ...d, ...change, edges: d.edges.map((x) => (x[clear] === undefined ? x : { ...x, [clear]: undefined })) }));
  const set = (k: keyof DocMeta) => (v: string) => useStore.getState().mutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }), false);
  return (
    <>
      <h3>ボード情報</h3>
      <Field label="タイトル（図面名称）" value={meta.title} onChange={set('title')} />
      <Field label="案件名" value={meta.project} onChange={set('project')} />
      <div className="field">
        <span>REV（改訂履歴の最新の版）</span>
        <output className="readout">{rev || '—（版を記録すると付きます）'}</output>
      </div>
      <Revisions />
      <label className="check">
        <input type="checkbox" checked={powerTags} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, powerTags: e.target.checked }))} />
        電源ケーブルは線を省略（両端に接続先だけ表示）
      </label>
      <label className="check">
        <input type="checkbox" checked={idLabels} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, cableIdLabels: e.target.checked, edges: d.edges.map((x) => (x.showId === undefined ? x : { ...x, showId: undefined })) }))} />
        ケーブル ID を線のラベルに表示
      </label>
      <label className="check">
        <input type="checkbox" checked={lenLabels} onChange={(e) => boardLabel({ lengthLabels: e.target.checked }, 'showLength')} />
        ケーブルの長さを線のラベルに表示
      </label>
      <label className="check">
        <input type="checkbox" checked={stackLabels} onChange={(e) => boardLabel({ stackedLabels: e.target.checked }, 'stacked')} />
        ラベルの項目を 1 行ずつに分ける
      </label>
      <label className="check">
        <input type="checkbox" checked={hops} onChange={(e) => useStore.getState().mutate((d) => ({ ...d, hops: e.target.checked || undefined }))} />
        線が交差するところを跨ぎ線（小さな山）にする
      </label>
      <p className="hint">
        タイトル・案件名・REV は、PDF エクスポートの見出しに入ります。
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
  const link = safeUrl(n.url);
  const saved = useStore((s) => s.presets.some((p) => p.name === n.text && p.maker === n.maker && p.model === n.model));
  const setPort = (id: string, p: Partial<Port>, record: boolean) => patch({ ports: n.ports.map((x) => (x.id === id ? { ...x, ...p } : x)) }, record);
  const addPort = (side: Port['side']) => {
    // A name of its own (IN, IN 2, IN 3 …), so a cable can always tell its port from the others.
    const base = side === 'left' ? 'IN' : 'OUT';
    const names = new Set(n.ports.map((p) => p.name));
    let name = base;
    for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
    patch({ ports: [...n.ports, { id: freshId(new Set(n.ports.map((p) => p.id)), 'p'), name, side, signal: 'hdmi' }] }, true);
  };
  const removePort = (id: string) =>
    st().mutate((d) => ({
      ...d,
      nodes: d.nodes.map((x) => (x.id === n.id ? { ...n, ports: n.ports.filter((p) => p.id !== id) } : x)),
      edges: d.edges.filter((e) => !((e.from.node === n.id && e.from.port === id) || (e.to.node === n.id && e.to.port === id))),
    }));
  const supplies = n.ports.some((p) => p.side === 'right' && p.signal === 'power');
  // Network settings only matter for things on the network: shown for a device with a LAN port or
  // settings already typed in, and one click away for the rest (a Wi-Fi device, say).
  const [asked, setNetworked] = useState(false);
  const networked = asked || !!n.ip || !!n.host || n.ports.some((p) => p.signal === 'lan');
  const group = useStore((s) => colourKey(s.doc).get(n.color ?? 'gray') ?? '');
  const categories = useStore(useShallow((s) => [...new Set([...PRESETS.map((p) => p.category), ...s.doc.nodes.map((x) => (x.type === 'device' ? x.category : ''))].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))));
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
      <Field wrap label="名称（改行できます）" value={n.text} onChange={(v) => patch({ text: v })} />
      <div className="grid2">
        <Field label="数量" type="number" placeholder={`${quantityOf(n.text).count}（名前から）`} value={n.qty == null ? '' : String(n.qty)} onChange={(v) => patch({ qty: num(v) && num(v)! >= 1 ? Math.round(num(v)!) : undefined })} />
        <Field label="カテゴリ" list="keito-categories" value={n.category} onChange={(v) => patch({ category: v })} />
      </div>
      <datalist id="keito-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="grid2">
        <Field label="メーカー" value={n.maker} onChange={(v) => patch({ maker: v })} />
        <Field
          label="型番"
          value={n.model}
          onChange={(v) => patch({ model: v })}
          // A web address pasted here is the model's link, not its name.
          onPasteText={(text) => {
            if (!/^https?:\/\//i.test(text.trim()) || !safeUrl(text)) return false;
            patch({ url: text.trim() }, true);
            return true;
          }}
        />
      </div>
      <Field label="型番のリンク（製品ページなど）" placeholder="https://…" value={n.url ?? ''} onChange={(v) => patch({ url: v || undefined })} />
      {n.url &&
        (link ? (
          <a className="open-link" href={link} target="_blank" rel="noopener noreferrer">
            {link.replace(/^https?:\/\/(www\.)?/, '')} を開く ↗
          </a>
        ) : (
          <p className="error">Web のアドレス（https://…）として読めません。</p>
        ))}
      <Field label="手配先・担当（機材リストの区分）" placeholder={group ? `${group}（色分けから）` : '例: 自社 / レンタル / 先方支給'} value={n.vendor ?? ''} onChange={(v) => patch({ vendor: v || undefined })} />
      <label className="field">
        <span>色分け</span>
        <Colors value={n.color ?? 'gray'} onPick={(color) => patch({ color }, true)} />
      </label>
      {networked ? (
        <div className="grid2">
          <Field label="IP アドレス" placeholder="192.168.0.10" value={n.ip ?? ''} onChange={(v) => patch({ ip: v || undefined })} />
          <Field label="ホスト名" value={n.host ?? ''} onChange={(v) => patch({ host: v || undefined })} />
        </div>
      ) : (
        <button className="mini add-field" onClick={() => setNetworked(true)}>
          ＋IP アドレス・ホスト名
        </button>
      )}
      <div className="grid2">
        <Field label="消費電力 (W)" type="number" value={n.watts == null ? '' : String(n.watts)} onChange={(v) => patch({ watts: num(v) })} />
        {/* Only something with outlets of its own can supply power. */}
        {(supplies || n.capacity != null) && <Field label="給電容量 (W)" type="number" placeholder="UPS・タップ" value={n.capacity == null ? '' : String(n.capacity)} onChange={(v) => patch({ capacity: num(v) })} />}
      </div>
      <Field wrap label="備考" value={n.note} onChange={(v) => patch({ note: v })} />
      <button className="wide" title="名称・メーカー・型番・ポート構成などを、機材ライブラリの「マイプリセット」に保存します" onClick={() => st().savePreset(n.id)}>
        {saved ? 'マイプリセットを上書き保存' : 'マイプリセットに保存'}
      </button>
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
  if (n.type === 'device') return <DevicePanel key={n.id} n={n} />;
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
        <TextStyle n={n} />
        <p className="hint">角をドラッグで大きさを変えられます（列と行の間隔が広がります）。文字を大きくすると、図全体がそれに合わせて大きくなります。</p>
        {(n.w > 0 || n.h > 0) && <button onClick={() => patch({ w: 0, h: 0 }, true)}>大きさを自動に戻す</button>}
      </>
    );
  }
  if (n.type === 'legend') {
    const doc = useStore.getState().doc;
    const rows = legendRows(doc, n);
    return (
      <>
        <h3>凡例 <code>{n.id}</code></h3>
        <Field label="見出し（空にすると出しません）" value={n.text} onChange={(v) => patch({ text: v })} />
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
                const names = { ...n.names, [row.color]: e.target.value };
                if (!e.target.value) delete names[row.color];
                patch({ names: Object.keys(names).length ? names : undefined });
              }}
            />
          </div>
        ))}
        <p className="hint">
          このボードで使っている線の色が 1 行ずつ並びます。同じ色の種別は 1 行にまとまり、名前を書くとその行の呼び名になります（空なら種別の名前）。チェックを外した行は凡例に出しません。線の色を変えると自動で追従します。
        </p>
      </>
    );
  }
  if (n.type === 'junction') {
    const lines = useStore.getState().doc.edges.filter((e) => e.from.node === n.id || e.to.node === n.id).length;
    return (
      <>
        <h3>分岐点 <code>{n.id}</code></h3>
        <p className="hint">
          {lines} 本の線がここでつながっています。
          <br />
          点を選ぶと出る ● をドラッグすると、ここから別の機材へ線を引けます。線の上に線をドロップしても分岐点ができます。
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
      {(n.type === 'shape' || n.type === 'sticky' || n.type === 'text' || n.type === 'frame') && <TextStyle n={n} />}
      {n.type === 'frame' && <Colors value={n.color ?? 'gray'} onPick={(color) => patch({ color }, true)} />}
      {(n.type === 'shape' || n.type === 'sticky') && <Colors sticky={n.type === 'sticky'} value={n.color} onPick={(color) => patch({ color }, true)} />}
    </>
  );
}

/** Size and weight of a node's text, as in the floating bar: the box grows so the text never spills out. */
function TextStyle({ n }: { n: Extract<Node, { type: 'shape' | 'sticky' | 'text' | 'frame' | 'sequence' }> }) {
  const restyle = (change: { fontSize?: number; bold?: boolean }) => {
    if (n.type === 'frame' || n.type === 'sequence') return useStore.getState().updateNode(n.id, change, true);
    const need = textHeightFor({ ...n, ...change }, n.text);
    useStore.getState().updateNode(n.id, { ...change, h: n.type === 'text' ? need : Math.max(n.h, need) }, true);
  };
  const sizes = sizesFor(n.type);
  return (
    <div className="grid2">
      <label className="field">
        <span>{n.type === 'frame' ? 'タイトルの大きさ' : '文字の大きさ'}</span>
        <select value={String(n.fontSize ?? '')} onChange={(e) => restyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })}>
          {sizes.map((o) => (
            <option key={o.label} value={o.px ?? ''}>{o.label}</option>
          ))}
          {n.fontSize != null && !sizes.some((o) => o.px === n.fontSize) && <option value={n.fontSize}>{n.fontSize}px</option>}
        </select>
      </label>
      {n.type !== 'sequence' && (
        <label className="check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={textWeight(n) === 700} onChange={(e) => restyle({ bold: e.target.checked })} />
          太字
        </label>
      )}
    </div>
  );
}

/** Add a signal type of the board's own (HDBaseT, Dante …) and hand its id back. */
function NewSignal({ onAdd }: { onAdd: (id: string) => void }) {
  const [form, setForm] = useState<{ label: string; prefix: string; color: string } | null>(null);
  const doc = useStore((s) => s.doc);
  const custom = doc.signals ?? [];
  const st = useStore.getState;
  const inUse = (id: string): boolean => doc.edges.some((x) => x.signal === id) || doc.nodes.some((n) => n.type === 'device' && n.ports.some((p) => p.signal === id));
  const add = () => {
    if (!form?.label.trim()) return;
    const taken = new Set(allSignals().map((s) => s.id));
    const base = form.label.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'sig';
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
    const prefix = (form.prefix.trim() || base.toUpperCase().slice(0, 4)).replace(/[^A-Za-z0-9]/g, '');
    // One undo step for the new type and the cable switching to it.
    st().mutate((d) => ({ ...d, signals: [...(d.signals ?? []), { id, label: form.label.trim(), prefix: prefix || 'SIG', color: form.color }] }));
    onAdd(id);
    setForm(null);
  };
  if (!form) {
    return (
      <div className="signals">
        {custom.map((s) => (
            <span key={s.id} className="chip" style={{ borderColor: s.color }}>
              <i style={{ background: s.color }} />
              {s.label}
              <button
                className="mini"
                title={inUse(s.id) ? 'この種別を使っている線やポートがあるので消せません' : 'この種別を消す'}
                disabled={inUse(s.id)}
                onClick={() => st().mutate((d) => ({ ...d, signals: (d.signals ?? []).filter((x) => x.id !== s.id) }))}
              >
                ×
              </button>
            </span>
        ))}
        <button className="mini" onClick={() => setForm({ label: '', prefix: '', color: LINE_COLORS[5] })}>
          ＋種別を追加
        </button>
      </div>
    );
  }
  return (
    <div className="rev-form">
      <div className="row">
        <input autoFocus placeholder="種別の名前（例: HDBaseT）" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className="rev-id" style={{ flex: '0 0 64px' }} placeholder="ID頭" title="ケーブルIDの頭文字（例: HDB → HDB-01）" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
        <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} title="線の色" style={{ flex: '0 0 30px', padding: 0, height: 28 }} />
      </div>
      <div className="row">
        <button className="primary" disabled={!form.label.trim()} onClick={add}>
          追加してこの線に使う
        </button>
        <button onClick={() => setForm(null)}>やめる</button>
      </div>
    </div>
  );
}

function EdgePanel({ e }: { e: Edge }) {
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
  const paint = (c: string | null) => useStore.getState().mutate((d) => paintLine(d, e.id, c, all));
  const patch = (p: Partial<Edge>, record = false) => useStore.getState().updateEdge(e.id, p, record);
  const cable = signalOf(e.signal).cable;
  return (
    <>
      <h3>{cable ? 'ケーブル' : 'コネクタ'}</h3>
      {cable && <h4>ケーブル情報</h4>}
      <label className="field">
        <span>種別</span>
        <SignalSelect flow value={e.signal} onChange={(signal) => patch({ signal, arrow: signal === 'flow' ? 'end' : signalOf(signal).cable ? 'none' : e.arrow }, true)} />
      </label>
      <NewSignal onAdd={(signal) => patch({ signal, arrow: 'none' })} />
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
              <a className="open-link" href={safeUrl(e.url)} target="_blank" rel="noopener noreferrer">
                {safeUrl(e.url)!.replace(/^https?:\/\/(www\.)?/, '')} を開く ↗
              </a>
            ) : (
              <p className="error">Web のアドレス（https://…）として読めません。</p>
            ))}
          <Field wrap label="備考" value={e.note} onChange={(v) => patch({ note: v })} />
          <h4>見た目</h4>
        </>
      )}
      <Field wrap label="ラベル（改行できます）" value={e.label} onChange={(v) => patch({ label: v })} />
      {cable && (
        <div className="checks">
          <span>ラベルに出すもの（品名・規格は書いてあれば出ます）</span>
          <label className="check">
            <input type="checkbox" checked={shown} onChange={(ev) => patch({ showId: ev.target.checked }, true)} />
            ケーブル ID
          </label>
          <label className="check">
            <input type="checkbox" checked={lenShown} onChange={(ev) => patch({ showLength: ev.target.checked }, true)} />
            長さ
          </label>
        </div>
      )}
      {cable && (
        <label className="check">
          <input type="checkbox" checked={stacked} onChange={(ev) => patch({ stacked: ev.target.checked }, true)} />
          ラベルの項目（ID・品名・文・長さ）を 1 行ずつに分ける
        </label>
      )}
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
        <input type="checkbox" checked={!!e.dash} onChange={(ev) => patch({ dash: ev.target.checked }, true)} />
        点線にする
      </label>
      {cable && (
        <label className="check">
          <input type="checkbox" checked={tagged} onChange={(ev) => patch({ tag: ev.target.checked, route: undefined }, true)} />
          線を省略（両端に接続先だけ表示）
        </label>
      )}
      {!cable && <Field wrap label="備考" value={e.note} onChange={(v) => patch({ note: v })} />}
      <div className="row">
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
