import { useEffect, useMemo, useRef, useState } from 'react';
import { type Hit, hitRect, searchDoc } from '../model/search';
import { showRect, useStore } from '../model/store';
import { composing } from './keys';

/** ⌘F, from anywhere on the board. */
export const openSearch = (): void => void window.dispatchEvent(new Event('keito:search'));

/** At most this many hits are listed; the count says how many more there are. */
const LISTED = 50;

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
  // A search belongs to the board it was made on.
  useEffect(() => close(), [doc.id]);
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
            } else if (e.key === 'Escape') close();
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
              <span className="kind">{h.kind}</span>
              <span className="name">{h.name}</span>
              {/* What matched, unless the name already shows it. */}
              {!h.name.includes(h.value) && (
                <small>
                  {h.field}: {h.value}
                </small>
              )}
            </button>
          ))}
          {hits.length > LISTED && <p className="hint">ほか {hits.length - LISTED} 件。言葉を足すと絞り込めます。</p>}
        </div>
      )}
    </div>
  );
}
