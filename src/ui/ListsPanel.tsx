import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { type CellEdit, TABLES, type Table, bands, clearOrder, editCell, editable, moveRow } from '../model/lists';
import { kindOf } from '../model/kinds';
import { allSignals, groupSignals } from '../model/signals';
import { reveal, useStore } from '../model/store';
import { openExport } from './ExportPanel';
import { ICON } from './icons';
import { composing } from './keys';
import { copyText, linkClick } from '../platform/io';


export function ListsPanel() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const [tab, setTab] = useState(0);
  // The cell being edited in place, by its row and column in the table on show.
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  // A row being dragged by its handle, and the place it would take if let go now.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  // The lists this kind of board has (a software board: its communication, its hosts, its checks).
  const keys = kindOf(doc).lists;
  const tables = useMemo<Table[]>(() => keys.map((k) => TABLES[k].make(doc)), [doc, keys]);
  const at = Math.min(tab, tables.length - 1);
  const t = tables[at];
  // A board with no lists (a sequence or free board) shows none, even if the panel was left open.
  if (!t) return null;
  // The rows in the order they are shown: while a row is dragged, already where it would go.
  const order = t.rows.map((_, i) => i);
  if (drag) order.splice(drag.to, 0, ...order.splice(drag.from, 1));
  /** The next cell that can be filled from row `row`, column `col`, going on along the rows; null at the end. */
  const nextCell = (row: number, col: number, step: 1 | -1): { row: number; col: number } | null => {
    const cells = order.flatMap((r) => t.head.map((_, c) => ({ row: r, col: c })));
    let k = cells.findIndex((x) => x.row === row && x.col === col);
    for (k += step; k >= 0 && k < cells.length; k += step) if (editable(t, cells[k].row, cells[k].col)) return cells[k];
    return null;
  };

  /**
   * Rows are dragged with the pointer (the browser's own drag and drop handles tables unevenly).
   * The drag starts once the pointer has moved a little, so a click on the handle still selects;
   * the rows make room as it goes, the list scrolls near its edges, and Escape puts it back.
   */
  const grab = (ev: ReactPointerEvent<HTMLElement>, from: number) => {
    if (ev.button !== 0 || editing) return;
    const handle = ev.currentTarget;
    const wrap = handle.closest<HTMLElement>('.table-wrap');
    const body = handle.closest('tbody');
    if (!wrap || !body) return;
    // Listened for on the window, not the handle: the rows are re-laid as the drag goes, and an
    // element moved in the page loses its hold on the pointer, so the release would never arrive.
    ev.preventDefault();
    const last = t.rows.length - (t.total ? 2 : 1);
    const startY = ev.clientY;
    let y = ev.clientY;
    let started = false;
    let to = from;
    let frame = 0;
    // A see-through copy of the row rides under the pointer, so it is plain what is being moved;
    // the row's own place in the list stays open where it would land.
    let ghost: HTMLTableElement | null = null;
    let grip = 0;
    const lift = () => {
      const tr = handle.closest('tr');
      if (!tr) return;
      const box = tr.getBoundingClientRect();
      grip = startY - box.top;
      const copy = tr.cloneNode(true) as HTMLTableRowElement;
      // Cells keep the widths they have in the list, which a lone row would not work out alike.
      [...tr.cells].forEach((td, k) => (copy.cells[k].style.width = `${td.getBoundingClientRect().width}px`));
      copy.className = '';
      ghost = document.createElement('table');
      ghost.className = 'row-ghost';
      ghost.appendChild(copy);
      Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px` });
      document.body.appendChild(ghost);
    };
    const follow = () => {
      if (!ghost) return;
      // It stays within the list's view, even when the pointer strays above or below it.
      const box = wrap.getBoundingClientRect();
      const h = ghost.getBoundingClientRect().height;
      ghost.style.top = `${Math.max(box.top, Math.min(box.bottom - h, y - grip))}px`;
    };
    const place = () => {
      const h = body.rows[0]?.getBoundingClientRect().height || 1;
      to = Math.max(0, Math.min(last, Math.floor((y - body.getBoundingClientRect().top) / h)));
      setDrag({ from, to });
    };
    // Near the top or bottom of the list, it scrolls, faster the closer the pointer gets.
    const scroll = () => {
      const box = wrap.getBoundingClientRect();
      const head = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const zone = 36;
      const up = box.top + head + zone - y;
      const down = y - (box.bottom - zone);
      const step = up > 0 ? -Math.min(up, zone) / 3 : down > 0 ? Math.min(down, zone) / 3 : 0;
      if (step) {
        wrap.scrollTop += step;
        place();
      }
      frame = requestAnimationFrame(scroll);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== ev.pointerId) return;
      y = e.clientY;
      if (!started) {
        if (Math.abs(y - startY) < 4) return;
        started = true;
        document.body.classList.add('row-dragging');
        lift();
        frame = requestAnimationFrame(scroll);
      }
      follow();
      place();
    };
    const finish = (keep: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      cancelAnimationFrame(frame);
      ghost?.remove();
      document.body.classList.remove('row-dragging');
      setDrag(null);
      if (!started) return;
      // The click that ends a drag (if the browser makes one) must not also select the row. It
      // comes straight after the release or not at all, so a later click is never swallowed.
      const swallow = (e: MouseEvent) => e.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
      if (keep && to !== from) useStore.getState().setDoc(moveRow(useStore.getState().doc, t, from, to));
    };
    const drop = (e: PointerEvent) => e.pointerId === ev.pointerId && finish(true);
    // Leaving the window (switching apps mid-drag) drops nothing.
    const cancel = () => finish(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
  };
  const sel = new Set(selection);
  const shaded = bands(t, order);
  const totalLength = doc.edges.reduce((a, e) => a + (e.length ?? 0), 0);

  return (
    <section className="lists">
      <div className="tabs">
        {keys.map((key, i) => (
          <button
            key={key}
            // Problems to fix turn the check tab red while it is out of view.
            className={[at === i ? 'on' : '', tables[i].rowClass?.includes('warn') ? 'alert' : ''].filter(Boolean).join(' ')}
            onClick={() => {
              setTab(i);
              setEditing(null);
            }}
          >
            {TABLES[key].label} <small>{tables[i].rows.length - (tables[i].total ? 1 : 0) - (tables[i].rowClass?.filter((c) => c?.startsWith('subtotal')).length ?? 0)}</small>
          </button>
        ))}
        <span className="grow" />
        {/* What the open list says in sum, then what can be done with it, then closing. */}
        {(keys[at] === 'cables' || keys[at] === 'summary') && (
          <span className="list-stat">
            総ケーブル長 <b>{totalLength}</b> m
          </span>
        )}
        {t.reorder && doc.listOrder?.[t.reorder] && (
          <button className="list-tool" title="ドラッグで決めた並びをやめ、この表のいつもの順に戻します" onClick={() => useStore.getState().setDoc(clearOrder(useStore.getState().doc, t.reorder!))}>
            {ICON.reset}
            並びを元に戻す
          </button>
        )}
        <div className="btn-group">
          <button
            title="この表を、表計算ソフトにそのまま貼れる形でコピーします"
            onClick={() => {
              void copyText([t.head, ...t.rows].map((r) => r.join('\t')).join('\n'));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {ICON.duplicate}
            {copied ? 'コピーしました' : 'コピー'}
          </button>
          <button title="Excel・CSV への書き出しは、エクスポートの「表」にまとめています" onClick={() => openExport('table')}>
            {ICON.download}
            Excel / CSV…
          </button>
        </div>
        <button className="list-close" aria-label="閉じる" title="表を閉じる" onClick={() => useStore.getState().setPanel(null)}>
          {ICON.close}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {t.reorder && <th className="grip" />}
              {t.head.map((h) => (
                <th key={h} className={t.numeric?.includes(h) ? 'num' : ''}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((i) => {
              const row = t.rows[i];
              return (
              <tr
                key={i}
                className={[
                  t.total && i === t.rows.length - 1 ? 'total' : t.refs[i].some((id) => sel.has(id)) ? 'on' : '',
                  t.rowClass?.[i] ?? '',
                  shaded.has(i) ? 'band' : '',
                  drag?.from === i ? 'dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  if (!t.refs[i].length) return;
                  useStore.getState().select(t.refs[i]);
                  // The row's things are shown on the board, brought into view if they are off it.
                  reveal(t.refs[i]);
                }}
              >
                {t.reorder &&
                  (t.total && i === t.rows.length - 1 ? (
                    <td className="grip" />
                  ) : (
                    <td className="grip" onPointerDown={(ev) => grab(ev, i)}>
                      <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden>
                        {[2, 7, 12].flatMap((cy) => [<circle key={`a${cy}`} cx="2" cy={cy} r="1.3" />, <circle key={`b${cy}`} cx="6" cy={cy} r="1.3" />])}
                      </svg>
                    </td>
                  ))}
                {row.map((c, j) => {
                  const edit = editable(t, i, j);
                  // The row number is a handle too: a wider target than the grip alone.
                  const handle = !!t.reorder && t.head[j] === 'No' && !(t.total && i === t.rows.length - 1);
                  const cls = [t.numeric?.includes(t.head[j]) ? 'num' : '', edit ? 'editable' : '', handle ? 'handle' : ''].filter(Boolean).join(' ');
                  if (edit && editing?.row === i && editing.col === j)
                    return (
                      <td key={j} className={`${cls} editing`}>
                        <CellEditor
                          t={t}
                          row={i}
                          edit={edit}
                          shown={c}
                          done={(value, step) => {
                            setEditing(step ? nextCell(i, j, step) : null);
                            if (value != null) useStore.getState().setDoc(editCell(useStore.getState().doc, edit, t.refs[i], value));
                          }}
                        />
                      </td>
                    );
                  return (
                    <td key={j} className={cls} onClick={edit ? () => setEditing({ row: i, col: j }) : undefined} onPointerDown={handle ? (ev) => grab(ev, i) : undefined}>
                      {/^https?:\/\//.test(c) ? (
                        <a href={c} target="_blank" rel="noopener noreferrer" title={c} onClick={linkClick(c)}>
                          {c.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      ) : (
                        c
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {!t.rows.length && (
              <tr>
                <td colSpan={t.head.length + (t.reorder ? 1 : 0)} className="empty">{t.empty ?? '機材ライブラリから機材を置き、ポート同士をドラッグで結ぶとここに自動で一覧が出ます。'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The input for one list cell. Enter or leaving the cell keeps the value, Escape drops it; an
 * Enter that confirms a Japanese conversion belongs to the IME, not to the cell.
 */
function CellEditor({ t, row, edit, shown, done }: { t: Table; row: number; edit: CellEdit; shown: string; done: (value: string | null, step?: 1 | -1) => void }) {
  const doc = useStore((s) => s.doc);
  // Enter ends the edit and takes the input away, which blurs it: the value is kept only once.
  const left = useRef(false);
  if (edit.kind === 'signal') {
    const e = doc.edges.find((x) => x.id === t.refs[row][0]);
    return (
      <select autoFocus defaultValue={e?.signal} onChange={(ev) => done(ev.target.value)} onBlur={() => done(null)} onKeyDown={(ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        done(null);
      }}>
        {/* A cable list offers cable types; a communication list, protocols. */}
        {groupSignals(allSignals().filter((s) => s.id !== 'flow' && kindOf(doc).lines(s) && (s.cable || !!s.protocol))).map((g) => (
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
  // A number column may show a word ("未設定") where there is no number yet.
  const start = edit.kind === 'number' && !/^-?[\d.]+$/.test(shown) ? '' : shown;
  const finish = (value: string | null, step?: 1 | -1) => {
    if (left.current) return;
    left.current = true;
    done(value === start ? null : value, step);
  };
  return (
    <input
      autoFocus
      defaultValue={start}
      inputMode={edit.kind === 'number' ? 'decimal' : undefined}
      onFocus={(ev) => ev.currentTarget.select()}
      onBlur={(ev) => finish(ev.currentTarget.value)}
      onKeyDown={(ev) => {
        if (composing(ev)) return;
        if (ev.key === 'Enter') finish(ev.currentTarget.value);
        // Tab keeps the value and goes on to the next cell to fill (Shift+Tab, the one before), as in a spreadsheet.
        else if (ev.key === 'Tab') {
          ev.preventDefault();
          finish(ev.currentTarget.value, ev.shiftKey ? -1 : 1);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(null);
        }
      }}
    />
  );
}
