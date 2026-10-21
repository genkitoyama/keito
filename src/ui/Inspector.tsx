import { pinLabel } from '../model/comments';
import { LABEL_SIZE, LABEL_SIZES } from '../model/labels';
import { legendRows } from '../model/legend';
import { type ReactNode, useRef, useState } from 'react';
import { isTagged } from '../model/geometry';
import { safeUrl } from '../model/url';
import { LINE_COLORS, lineColor, paintLine } from '../model/lineColor';
import { cableIds, colourKey, idShown, ipIssues, labelStacked, lengthShown, quantityOf, unitsOf } from '../model/lists';
import { PRESETS, SOFTWARE, freshId } from '../model/presets';
import { type BoardKind, KINDS, KIND_ORDER, kindOf } from '../model/kinds';
import { COLOR_KEYS, PALETTE, STICKY, allSignals, groupSignals, signalOf } from '../model/signals';
import { readImageFile } from '../platform/storage';
import { align, storeImage, useStore } from '../model/store';
import { type Arrow, type DeviceNode, type Doc, type DocMeta, type Edge, type Node, type Port, type ShapeKind, type StickyNode } from '../model/types';
import { FILLS, FillPreview, SHAPES, sizesFor } from './icons';
import { textHeightFor, textWeight } from '../canvas/render';
import { useShallow } from 'zustand/react/shallow';
import { Revisions } from './Revisions';
import { RunsOn, SharedSection } from './Shared';
import { composing } from './keys';
import { useBurst } from './burst';

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

/** One group of a panel's settings, in a tinted card under its heading. */
function Section({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="board-section">
      <h4>
        <span>
          {title}
          {note && <small>{note}</small>}
        </span>
        {action}
      </h4>
      {children}
    </section>
  );
}

/** The panel's heading: what is selected, and its id. */
function Head({ title, id }: { title: string; id?: string }) {
  return (
    <h3 className="panel-head">
      {title}
      {id && <code>{id}</code>}
    </h3>
  );
}

/** The category whose devices supply power, and so take a capacity. */
const SUPPLY_CATEGORY = '電源';
/** The catch-all, also what the library calls a preset without a category. */
const OTHER_CATEGORY = 'その他';

/**
 * Category picker. A plain datalist only offers what matches the text already in the box, so a
 * device that has a category could never be moved to another one; this list shows every category
 * on focus (the board's own first, then the library's) and narrows only once something is typed.
 */
function CategoryField({ id, value, onChange, soft }: { id: string; value: string; onChange: (v: string, record?: boolean) => void; soft?: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [hi, setHi] = useState(-1);
  const dirty = useRef(false);
  const box = useRef<HTMLInputElement>(null);
  const used = useStore(
    useShallow((s) => {
      const count = new Map<string, number>();
      // While typing, this device's own half-typed text is not a category in use.
      for (const x of s.doc.nodes) if (x.type === 'device' && x.category.trim() && !(typed && x.id === id)) count.set(x.category.trim(), (count.get(x.category.trim()) ?? 0) + 1);
      return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([c, k]) => `${c}\t${k}`);
    }),
  );
  const onBoard = used.map((u) => ({ name: u.split('\t')[0], count: Number(u.split('\t')[1]) }));
  // その他 closes the list, for whatever fits nowhere else.
  const library = [...[...new Set((soft ? SOFTWARE : PRESETS).map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja')), OTHER_CATEGORY].filter((c) => !onBoard.some((b) => b.name === c));
  const q = typed ? value.trim().toLowerCase() : '';
  const match = (c: string): boolean => !q || c.toLowerCase().includes(q);
  const groups = [
    { title: 'このボードで使用中', items: onBoard.filter((c) => match(c.name)) },
    { title: '標準のカテゴリ', items: library.filter(match).map((name) => ({ name, count: 0 })) },
  ].filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items.map((i) => i.name));
  const pick = (c: string) => {
    onChange(c, true);
    setOpen(false);
    setTyped(false);
  };
  return (
    <label className="field combo">
      <span>カテゴリ</span>
      {/* Looks like the dropdown it is, with its own arrow: the list also opens by clicking the box. */}
      <div className="combo-box">
        <input
          ref={box}
          value={value}
          placeholder="選ぶか入力"
          role="combobox"
          aria-expanded={open}
          onFocus={() => {
            dirty.current = false;
            setOpen(true);
            setTyped(false);
            setHi(-1);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            if (!dirty.current) {
              dirty.current = true;
              useStore.getState().checkpoint();
            }
            onChange(e.target.value);
            setTyped(true);
            setOpen(true);
            setHi(-1);
          }}
          onKeyDown={(e) => {
            // Keys pressed while the IME is still composing belong to the IME.
            if (composing(e)) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setHi((h) => (flat.length ? (h + step + flat.length) % flat.length : -1));
            } else if (e.key === 'Enter' && open && hi >= 0 && flat[hi]) {
              e.preventDefault();
              pick(flat[hi]);
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          aria-label={open ? '一覧を閉じる' : '一覧を開く'}
          // mousedown, so the box keeps its focus; the click must not reach the label either.
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) return setOpen(false);
            if (document.activeElement === box.current) setOpen(true);
            else box.current?.focus();
          }}
          onClick={(e) => e.preventDefault()}
        >
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && groups.length > 0 && (
        // mousedown, not click: picking must happen before the input's blur closes the list.
        <div className="combo-list" onMouseDown={(e) => e.preventDefault()}>
          {groups.map((g) => (
            <div key={g.title}>
              <div className="combo-head">{g.title}</div>
              {g.items.map((c) => {
                const i = flat.indexOf(c.name);
                return (
                  <button key={c.name} type="button" className={`${c.name === value.trim() ? 'on' : ''}${i === hi ? ' hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(c.name)}>
                    <span>{c.name}</span>
                    {c.count > 0 && <em>{c.count}台</em>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
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

/** The types this kind of board offers (a software board: protocols), with the current one kept even if it is not among them. */
function SignalSelect({ value, onChange, flow }: { value: string; onChange: (v: string) => void; flow?: boolean }) {
  const kind = kindOf(useStore((s) => s.doc));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {groupSignals(allSignals().filter((s) => s.id === value || ((flow || s.id !== 'flow') && kind.lines(s)))).map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** How to pick a cable's type, in a few examples: folded away until asked for. */
function SignalHowTo({ port }: { port?: boolean }) {
  return (
    <details className="howto">
      <summary>種別の選び方</summary>
      {port ? (
        <p className="hint">
          ポートは、その端子の種類で選びます。光の端子（LC・SC など）なら「光ファイバー」、LAN の差し込み口なら「LAN」です。
        </p>
      ) : (
        <p className="hint">
          ケーブルは、<b>両端の端子</b>に合わせて選びます。中を流れるものでは選びません。
          <br />・光 HDMI ケーブル → 両端が HDMI なので「映像」
          <br />・光エクステンダーの間 → 両端が光の端子なので「光ファイバー」（運ぶのが映像でも）
          <br />・Dante の音声 → LAN の端子どうしなので「LAN」
          <br />「光」「12G-SDI」「Dante」のような中身や規格は、<b>品名・規格</b>に書きます。
        </p>
      )}
    </details>
  );
}

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

function MetaPanel() {
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

const num = (v: string): number | undefined => (v === '' || isNaN(Number(v)) ? undefined : Number(v));

function DevicePanel({ n }: { n: DeviceNode }) {
  // On a software board a device is a piece of software: its fields are those of software.
  const soft = useStore((s) => kindOf(s.doc).id === 'software');
  const st = useStore.getState;
  const patch = (p: Partial<DeviceNode>, record = false) => st().updateNode(n.id, p, record);
  const link = safeUrl(n.url);
  const saved = useStore((s) => s.presets.some((p) => p.name === n.text && p.maker === n.maker && p.model === n.model && !!p.software === (kindOf(s.doc).id === 'software')));
  const setPort = (id: string, p: Partial<Port>, record: boolean) => patch({ ports: n.ports.map((x) => (x.id === id ? { ...x, ...p } : x)) }, record);
  const addPort = (side: Port['side']) => {
    // A name of its own (IN, IN 2, IN 3 …), so a cable can always tell its port from the others.
    const base = side === 'left' ? 'IN' : 'OUT';
    const names = new Set(n.ports.map((p) => p.name));
    let name = base;
    for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
    patch({ ports: [...n.ports, { id: freshId(new Set(n.ports.map((p) => p.id)), 'p'), name, side, signal: soft ? 'data' : 'video' }] }, true);
  };
  const removePort = (id: string) =>
    st().mutate((d) => ({
      ...d,
      nodes: d.nodes.map((x) => (x.id === n.id ? { ...n, ports: n.ports.filter((p) => p.id !== id) } : x)),
      edges: d.edges.filter((e) => !((e.from.node === n.id && e.from.port === id) || (e.to.node === n.id && e.to.port === id))),
    }));
  // Supplying power is what the 電源 category means (UPS, taps, distribution boards); a capacity
  // already typed in stays in view whatever the category, so it is never hidden from the user.
  const supplies = n.category.trim() === SUPPLY_CATEGORY;
  // Network settings only matter for things on the network: shown for a device with a LAN port or
  // settings already typed in, and one click away for the rest (a Wi-Fi device, say).
  const [asked, setNetworked] = useState(false);
  // A box is one unit as a rule: the quantity is shown only for one that stands for several.
  const [manyAsked, setMany] = useState(false);
  const many = !soft && (manyAsked || n.qty != null || quantityOf(n.text).count > 1);
  const networked = asked || !!n.ip || !!n.host || n.ports.some((p) => p.signal === 'lan');
  const group = useStore((s) => colourKey(s.doc).get(n.color ?? 'gray') ?? '');
  const ipIssue = useStore((s) => ipIssues(s.doc).get(n.id));
  // The first other device holding the same address, by name, so the clash can be found.
  const clash = useStore((s) => {
    const ip = n.ip?.trim().replace(/\/\d+$/, '').toLowerCase();
    const other = ip && s.doc.nodes.find((x) => x.id !== n.id && x.type === 'device' && x.ip?.trim().replace(/\/\d+$/, '').toLowerCase() === ip);
    return other ? other.text.split('\n')[0] : '';
  });
  const move = (id: string, dir: -1 | 1) => {
    const port = n.ports.find((p) => p.id === id)!;
    const same = n.ports.filter((p) => p.side === port.side);
    const other = same[same.indexOf(port) + dir];
    if (!other) return;
    patch({ ports: n.ports.map((p) => (p === port ? other : p === other ? port : p)) }, true);
  };
  const ports = (side: Port['side']) => n.ports.filter((p) => p.side === side);
  return (
    <>
      <Head title={soft ? '部品' : '機材'} id={n.id} />
      <Section title="基本情報">
        <Field wrap label="名称（改行できます）" value={n.text} onChange={(v) => patch({ text: v })} />
        {/* A device's category has the row to itself; a piece of software's shares it with its version. */}
        {soft ? (
          <div className="grid2">
            <CategoryField id={n.id} soft value={n.category} onChange={(v, record) => patch({ category: v }, record)} />
            <Field label="バージョン・実装" placeholder="例: Node 22 / TD 2025" value={n.model} onChange={(v) => patch({ model: v })} />
          </div>
        ) : (
          <CategoryField id={n.id} value={n.category} onChange={(v, record) => patch({ category: v }, record)} />
        )}
        {!soft && (
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
        )}
        <Field label={soft ? 'リンク（リポジトリ・資料など）' : '型番のリンク（製品ページなど）'} placeholder="https://…" value={n.url ?? ''} onChange={(v) => patch({ url: v || undefined })} />
        {n.url &&
          (link ? (
            <a className="open-link" href={link} target="_blank" rel="noopener noreferrer">
              {link.replace(/^https?:\/\/(www\.)?/, '')} を開く ↗
            </a>
          ) : (
            <p className="error">Web のアドレス（https://…）として読めません。</p>
          ))}
        <Field wrap label="備考" value={n.note} onChange={(v) => patch({ note: v })} />
      </Section>
      {/* A piece of software has no quantity, price, power or supplier: those belong to the gear it runs on. */}
      {!soft && (
        <Section title="手配" note="機材リストに出ます">
          <Field label="手配先・担当（区分）" placeholder="例: 自社 / レンタル / 先方支給" value={n.vendor ?? ''} onChange={(v) => patch({ vendor: v || undefined })} />
          {/* What the board's colour key says is only a guess (the colours may mean something else),
              so it is offered, never written in unasked. */}
          {group && group !== (n.vendor?.trim() ?? '') && (
            <p className="suggest">
              <span>{n.vendor?.trim() ? <>色分けでは「{group}」</> : <>空欄のときは色分けの「{group}」を表に使います</>}</span>
              <button className="mini" onClick={() => patch({ vendor: group }, true)}>
                入れる
              </button>
            </p>
          )}
          {many && (
            <div className="grid2">
              <Field label="数量（この枠の台数）" type="number" placeholder={`${quantityOf(n.text).count}（名前から）`} value={n.qty == null ? '' : String(n.qty)} onChange={(v) => patch({ qty: num(v) && num(v)! >= 1 ? Math.round(num(v)!) : undefined })} />
            </div>
          )}
          {/* Prices are typed in the equipment list, where the rows can be gone down one after another. */}
          <p className="hint price-hint">
            {n.price != null ? <>単価 {n.price.toLocaleString('ja-JP')} 円{unitsOf(n).count > 1 && <>（金額 {(n.price * unitsOf(n).count).toLocaleString('ja-JP')} 円）</>}。</> : <>単価は</>}
            <button className="link" onClick={() => st().setPanel('lists')}>
              機材リスト
            </button>
            {n.price != null ? 'で変えられます。' : 'の「単価(円)」欄に入力します。'}
          </p>
          {!many && (
            <button className="mini add-field" onClick={() => setMany(true)}>
              ＋数量（1 枠で複数台を表すとき）
            </button>
          )}
        </Section>
      )}
      {!soft && (
        <Section title="電源" note="電源系統表に出ます">
          <div className="grid2">
            <Field label="消費電力 (W)" type="number" value={n.watts == null ? '' : String(n.watts)} onChange={(v) => patch({ watts: num(v) })} />
            {(supplies || n.capacity != null) && <Field label="給電容量 (W)" type="number" placeholder="UPS・タップ" value={n.capacity == null ? '' : String(n.capacity)} onChange={(v) => patch({ capacity: num(v) })} />}
          </div>
        </Section>
      )}
      <Section title={soft ? '動作環境' : 'ネットワーク'}>
        {soft && <RunsOn n={n} />}
        {soft && n.runsOn && (
          <p className="hint">
            ホスト名 {n.host || '—'}／IP {n.ip || '—'}（動作ホストの機材から）
          </p>
        )}
        {(networked || soft) && !(soft && n.runsOn) && (
          <div className="grid2">
            <Field label={soft ? '動作ホストの IP' : 'IP アドレス'} placeholder="192.168.0.10" value={n.ip ?? ''} onChange={(v) => patch({ ip: v || undefined })} />
            <Field label={soft ? '動作ホスト名' : 'ホスト名'} placeholder={soft ? '例: td-main / AWS' : undefined} value={n.host ?? ''} onChange={(v) => patch({ host: v || undefined })} />
          </div>
        )}
        {networked && ipIssue === 'bad' && <p className="error">IPv4 アドレス（192.168.0.10 の形）として読めません。</p>}
        {networked && ipIssue === 'dup' && <p className="error">{clash ? `「${clash}」と` : 'ほかの機材と'}同じ IP アドレスです。</p>}
        {!networked && !soft && (
          <button className="mini add-field" onClick={() => setNetworked(true)}>
            ＋IP アドレス・ホスト名
          </button>
        )}
      </Section>
      <Section title="見た目">
        <label className="field">
          <span>色分け</span>
          <Colors value={n.color ?? 'gray'} onPick={(color) => patch({ color }, true)} />
        </label>
      </Section>
      {(['left', 'right'] as const).map((side) => (
        <Section
          key={side}
          title={side === 'left' ? '入力ポート（左）' : '出力ポート（右）'}
          note={`${ports(side).length} 個`}
          action={
            <button className="mini" onClick={() => addPort(side)}>
              ＋追加
            </button>
          }
        >
          {ports(side).length > 0 && (
            <div className="port-head">
              <span>名前</span>
              <span>種別</span>
            </div>
          )}
          {ports(side).map((p) => (
            <div className="port-row" key={p.id}>
              <PortName value={p.name} onChange={(v) => setPort(p.id, { name: v }, false)} />
              <SignalSelect value={p.signal} onChange={(v) => setPort(p.id, { signal: v }, true)} />
              <button className="mini" onClick={() => move(p.id, -1)} title="上へ">↑</button>
              <button className="mini" onClick={() => move(p.id, 1)} title="下へ">↓</button>
              <button className="mini" onClick={() => setPort(p.id, { side: side === 'left' ? 'right' : 'left' }, true)} title="反対側へ">⇄</button>
              <button className="mini danger" onClick={() => removePort(p.id)} title="削除">×</button>
            </div>
          ))}
          {!ports(side).length && <p className="hint">ポートはありません。</p>}
        </Section>
      ))}
      {!soft && <SignalHowTo port />}
      <SharedSection n={n} />
      <button className="wide" title="名称・メーカー・型番・ポート構成などを、機材ライブラリの「マイプリセット」に保存します" onClick={() => st().savePreset(n.id)}>
        {saved ? 'マイプリセットを上書き保存' : 'マイプリセットに保存'}
      </button>
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
          alert(e instanceof Error ? e.message : String(e));
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
        <label className="check text-bold">
          <input type="checkbox" checked={textWeight(n) === 700} onChange={(e) => restyle({ bold: e.target.checked })} />
          太字
        </label>
      )}
    </div>
  );
}

/** Add a signal type of the board's own (HDBaseT …) and hand its id back. */
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
                <a className="open-link" href={safeUrl(e.url)} target="_blank" rel="noopener noreferrer">
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
          <input type="checkbox" checked={!!e.dash} onChange={(ev) => patch({ dash: ev.target.checked }, true)} />
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

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const remove = () => useStore.getState().removeIds(selection);
  const lines = doc.edges.filter((e) => selection.includes(e.id)).length;
  let body;
  if (selection.length === 0) body = <MetaPanel />;
  else if (selection.length === 1) {
    const node = doc.nodes.find((n) => n.id === selection[0]);
    const edge = doc.edges.find((e) => e.id === selection[0]);
    body = node ? <NodePanel key={node.id} n={node} /> : edge ? <EdgePanel key={edge.id} e={edge} /> : null;
  } else {
    body = (
      <>
        <Head title={`${selection.length} 個を選択中`} />
        {lines > 0 && <p className="hint">{lines === selection.length ? `線 ${lines} 本` : `うち線 ${lines} 本`}。Delete キーか下の「削除」で消せます。</p>}
        {selection.length - lines >= 2 && (
          <Section title="整列">
            <div className="grid2">
              <button onClick={() => align('left')}>左揃え</button>
              <button onClick={() => align('top')}>上揃え</button>
              <button onClick={() => align('hcenter')}>左右中央</button>
              <button onClick={() => align('vcenter')}>上下中央</button>
              <button onClick={() => align('hspace')}>横に等間隔</button>
              <button onClick={() => align('vspace')}>縦に等間隔</button>
            </div>
          </Section>
        )}
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

/** Which sequence item a comment is pinned to, if any: set by where the sticky is put. */
function PinNote({ n }: { n: StickyNode }) {
  const doc = useStore((s) => s.doc);
  const pin = pinLabel(doc, n);
  if (!pin) return <p className="hint">シーケンス図の矢印やノートの上に置くと、その処理へのコメントになり、書き換えても付いていきます。</p>;
  return <p className={`pin-note${pin.lost ? ' lost' : ''}`}>{pin.lost ? '対象の処理がシーケンス図から消えました。別の処理の上に置き直すと付け直せます。' : `対象: ${pin.text}`}</p>;
}

/** Size of the selected lines' labels: the board's, or one of their own. */
export function LabelSizeField({ edges }: { edges: Edge[] }) {
  const board = useStore((s) => s.doc.labelSize ?? LABEL_SIZE);
  const size = edges[0]?.fontSize ?? board;
  const ids = new Set(edges.map((x) => x.id));
  // The board's size picked here means following the board, so a later board-wide change applies.
  const pick = (v: string) =>
    useStore.getState().mutate((d) => ({ ...d, edges: d.edges.map((x) => (ids.has(x.id) ? { ...x, fontSize: Number(v) === board ? undefined : Number(v) } : x)) }));
  return (
    <label className="field">
      <span>ラベルの文字サイズ</span>
      <select value={size} onChange={(ev) => pick(ev.target.value)}>
        {LABEL_SIZES.map((o) => (
          <option key={o.size} value={o.size}>
            {o.label}（{o.size}px）{o.size === board ? '　ボード全体と同じ' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
