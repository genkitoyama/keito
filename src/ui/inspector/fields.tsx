import { LABEL_SIZE, LABEL_SIZES } from '../../model/labels';
import { type ReactNode, useRef, useState } from 'react';
import { LINE_COLORS } from '../../model/lineColor';
import { PRESETS, SOFTWARE } from '../../model/presets';
import { kindOf } from '../../model/kinds';
import { COLOR_KEYS, PALETTE, STICKY, allSignals, groupSignals } from '../../model/signals';
import { useStore } from '../../model/store';
import { type Edge, type Node } from '../../model/types';
import { sizesFor } from '../icons';
import { textHeightFor, textWeight } from '../../canvas/render';
import { useShallow } from 'zustand/react/shallow';
import { composing } from '../keys';

/** Text input that records one undo step per editing burst instead of per keystroke. */
export function Field({ label, value, onChange, multiline, wrap, type = 'text', placeholder, onPasteText, list }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; wrap?: boolean; type?: string; placeholder?: string; onPasteText?: (text: string) => boolean; list?: string }) {
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
export function Section({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
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
export function Head({ title, id }: { title: string; id?: string }) {
  return (
    <h3 className="panel-head">
      {title}
      {id && <code>{id}</code>}
    </h3>
  );
}

/** The category whose devices supply power, and so take a capacity. */
export const SUPPLY_CATEGORY = '電源';

/** The catch-all, also what the library calls a preset without a category. */
const OTHER_CATEGORY = 'その他';

/**
 * Category picker. A plain datalist only offers what matches the text already in the box, so a
 * device that has a category could never be moved to another one; this list shows every category
 * on focus (the board's own first, then the library's) and narrows only once something is typed.
 */
export function CategoryField({ id, value, onChange, soft }: { id: string; value: string; onChange: (v: string, record?: boolean) => void; soft?: boolean }) {
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

export function Colors({ value, onPick, sticky }: { value: string; onPick: (c: (typeof COLOR_KEYS)[number]) => void; sticky?: boolean }) {
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
export function SignalSelect({ value, onChange, flow }: { value: string; onChange: (v: string) => void; flow?: boolean }) {
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
export function SignalHowTo({ port }: { port?: boolean }) {
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

export function PortName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

/** Size and weight of a node's text, as in the floating bar: the box grows so the text never spills out. */
export function TextStyle({ n }: { n: Extract<Node, { type: 'shape' | 'sticky' | 'text' | 'frame' | 'sequence' }> }) {
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
export function NewSignal({ onAdd }: { onAdd: (id: string) => void }) {
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
      <div
        className="row"
        onKeyDown={(e) => {
          if (composing(e) || !(e.target instanceof HTMLInputElement) || e.target.type === 'color') return;
          if (e.key === 'Enter' && form.label.trim()) add();
          else if (e.key === 'Escape') {
            e.stopPropagation();
            setForm(null);
          }
        }}
      >
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

export const num = (v: string): number | undefined => (v === '' || isNaN(Number(v)) ? undefined : Number(v));
