import { useEffect, useMemo, useRef, useState } from 'react';
import { type Hit, hitRect, matchRange, searchDoc } from '../model/search';
import { showRect, useStore } from '../model/store';
import { composing } from './keys';

/** ⌘F, from anywhere on the board. */
export const openSearch = (): void => void window.dispatchEvent(new Event('keito:search'));

/** At most this many hits are listed; the count says how many more there are. */
const LISTED = 50;

/** A text with the words looked for marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const r = matchRange(text, query);
  if (!r) return <>{text}</>;
  return (
    <>
      {text.slice(0, r[0])}
      <mark>{text.slice(r[0], r[1])}</mark>
      {text.slice(r[1])}
    </>
  );
}

/** A small sample of how the hit looks on the board: a line in its colour, a device's header, else a dot. */
function Sample({ hit }: { hit: Hit }) {
  const look = hit.look;
  return (
    <svg className="sample" width={22} height={14} viewBox="0 0 22 14" aria-hidden>
      {look && 'line' in look ? (
        <line x1={1} y1={7} x2={21} y2={7} stroke={look.line} strokeWidth={2.4} strokeDasharray={look.dashed ? '4 3' : undefined} strokeLinecap={look.dashed ? undefined : 'round'} />
      ) : look ? (
        <rect x={2} y={2} width={18} height={10} rx={2.5} fill={look.fill} stroke={look.stroke} strokeWidth={1.3} />
      ) : (
        <circle cx={11} cy={7} r={3} fill="#94a3b8" />
      )}
    </svg>
  );
}

/**
 * Find things on the board as you type: devices by name, model, IP …, cables by ID or spec,
 * notes and areas by their words. The arrows go down the hits, each brought into view and
 * selected; the rest of the board fades while searching. Enter keeps the one picked, Escape
 * closes. Words still being converted by the IME are left alone until they are confirmed.
 */
export function SearchBar() {
  const doc = useStore((s) => s.doc);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (open ? searchDoc(doc, typed) : []), [open, doc, typed]);

  useEffect(() => {
    const show = () => {
      setOpen(true);
      requestAnimationFrame(() => input.current?.select());
    };
    window.addEventListener('keito:search', show);
    return () => window.removeEventListener('keito:search', show);
  }, []);
  // A search belongs to the board it was made on, and gives way to a window over the board.
  useEffect(() => close(), [doc.id]);
  const panel = useStore((s) => s.panel);
  useEffect(() => {
    if (panel === 'export' || panel === 'boards' || panel === 'settings') close();
  }, [panel]);
  // While open, what is found stands out and the rest of the board fades.
  useEffect(() => useStore.setState({ found: open && typed.trim() ? hits.map((h) => h.id) : null }), [open, typed, hits]);
  useEffect(() => setAt(0), [typed]);

  const close = () => {
    setOpen(false);
    useStore.setState({ found: null });
  };
  const pick = (hit: Hit | undefined) => {
    if (!hit) return;
    useStore.getState().select([hit.id]);
    const r = hitRect(useStore.getState().doc, hit.id);
    if (r) showRect(r);
  };
  const move = (i: number) => {
    if (!hits.length) return;
    const next = (i + hits.length) % Math.min(hits.length, LISTED);
    setAt(next);
    pick(hits[next]);
  };

  if (!open) return null;
  return (
    <div className="search-bar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="search-field">
        <svg viewBox="0 0 20 20" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <circle cx={8.5} cy={8.5} r={5.5} />
          <path d="M13 13l4.5 4.5" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder="機材・型番・IP・ケーブル ID・文字を探す"
          onChange={(e) => {
            setQuery(e.target.value);
            // Mid-conversion the words are not yet what is meant: they are looked for once confirmed.
            if (!(e.nativeEvent as InputEvent).isComposing) setTyped(e.target.value);
          }}
          onCompositionEnd={(e) => setTyped(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (composing(e)) return;
            if (e.key === 'ArrowDown') move(at + (useStore.getState().selection[0] === hits[at]?.id ? 1 : 0));
            else if (e.key === 'ArrowUp') move(at - 1);
            else if (e.key === 'Enter') {
              pick(hits[at]);
              close();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
            else return;
            e.preventDefault();
          }}
        />
        {typed.trim() && <small>{hits.length ? `${hits.length} 件` : 'なし'}</small>}
        <button className="search-close" aria-label="閉じる" title="閉じる（Esc）" onClick={close}>
          ×
        </button>
      </div>
      {hits.length > 0 && (
        <div className="search-hits" role="listbox">
          {hits.slice(0, LISTED).map((h, i) => (
            <button
              key={h.id}
              role="option"
              aria-selected={i === at}
              className={`search-hit${i === at ? ' on' : ''}`}
              onPointerEnter={() => setAt(i)}
              onClick={() => {
                setAt(i);
                pick(h);
              }}
            >
              <Sample hit={h} />
              <span className="text">
                <span className="name">
                  <Marked text={h.name} query={typed} />
                </span>
                <small>
                  {h.kind}
                  {/* What matched, unless the name already shows it. */}
                  {!h.name.includes(h.value) && (
                    <>
                      {' · '}
                      {h.field} <Marked text={h.value} query={typed} />
                    </>
                  )}
                </small>
              </span>
            </button>
          ))}
          {hits.length > LISTED && <p className="hint">ほか {hits.length - LISTED} 件。言葉を足すと絞り込めます。</p>}
        </div>
      )}
      {typed.trim() && (
        <div className="search-keys">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 選ぶ
          </span>
          <span>
            <kbd>Enter</kbd> 決める
          </span>
          <span>
            <kbd>Esc</kbd> 閉じる
          </span>
        </div>
      )}
    </div>
  );
}
