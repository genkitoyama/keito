import { useMemo, useRef, useState } from 'react';
import { type CellEdit, type Table, cableSummaryTable, cableTable, checkTable, editCell, editable, equipmentTable, networkTable, powerTable, toCsv, wiringTable } from '../model/lists';
import { allSignals } from '../model/signals';
import { useStore } from '../model/store';
import { download, safeName } from '../platform/storage';

const TABS = ['機材リスト', 'ケーブルリスト', 'ケーブル集計', '結線表', '電源系統', 'ネットワーク', 'チェック'] as const;

export function ListsPanel() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const [tab, setTab] = useState(0);
  // The cell being edited in place, by its row and column in the table on show.
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const tables = useMemo<Table[]>(() => [equipmentTable(doc), cableTable(doc), cableSummaryTable(doc), wiringTable(doc), powerTable(doc), networkTable(doc), checkTable(doc)], [doc]);
  const t = tables[tab];
  const sel = new Set(selection);
  const totalLength = doc.edges.reduce((a, e) => a + (e.length ?? 0), 0);

  return (
    <section className="lists">
      <div className="tabs">
        {TABS.map((name, i) => (
          <button
            key={name}
            // Problems to fix turn the check tab red while it is out of view.
            className={[tab === i ? 'on' : '', tables[i].rowClass?.includes('warn') ? 'alert' : ''].filter(Boolean).join(' ')}
            onClick={() => {
              setTab(i);
              setEditing(null);
            }}
          >
            {name} <small>{tables[i].rows.length - (tables[i].total ? 1 : 0) - (tables[i].rowClass?.filter((c) => c?.startsWith('subtotal')).length ?? 0)}</small>
          </button>
        ))}
        <span className="grow" />
        <small>総ケーブル長 {totalLength} m</small>
        <button onClick={() => download(`${safeName(doc.meta.title)}_${t.title}.csv`, toCsv(t), 'text/csv')}>CSV 書き出し</button>
        <button onClick={() => navigator.clipboard.writeText([t.head, ...t.rows].map((r) => r.join('\t')).join('\n'))} title="表計算ソフトにそのまま貼れます">
          コピー
        </button>
        <button onClick={() => useStore.getState().setPanel(null)}>×</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{t.head.map((h) => <th key={h} className={t.numeric?.includes(h) ? 'num' : ''}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i} className={[t.total && i === t.rows.length - 1 ? 'total' : t.refs[i].some((id) => sel.has(id)) ? 'on' : '', t.rowClass?.[i] ?? ''].filter(Boolean).join(' ')} onClick={() => t.refs[i].length && useStore.getState().select(t.refs[i])}>
                {row.map((c, j) => {
                  const edit = editable(t, i, j);
                  const cls = [t.numeric?.includes(t.head[j]) ? 'num' : '', edit ? 'editable' : ''].filter(Boolean).join(' ');
                  if (edit && editing?.row === i && editing.col === j)
                    return (
                      <td key={j} className={`${cls} editing`}>
                        <CellEditor
                          t={t}
                          row={i}
                          edit={edit}
                          shown={c}
                          done={(value) => {
                            setEditing(null);
                            if (value != null) useStore.getState().setDoc(editCell(useStore.getState().doc, edit, t.refs[i], value));
                          }}
                        />
                      </td>
                    );
                  return (
                    <td key={j} className={cls} onClick={edit ? () => setEditing({ row: i, col: j }) : undefined}>
                      {/^https?:\/\//.test(c) ? (
                        <a href={c} target="_blank" rel="noopener noreferrer" title={c} onClick={(e) => e.stopPropagation()}>
                          {c.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      ) : (
                        c
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!t.rows.length && (
              <tr>
                <td colSpan={t.head.length} className="empty">{t.empty ?? '機材ライブラリから機材を置き、ポート同士をドラッグで結ぶとここに自動で一覧が出ます。'}</td>
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
function CellEditor({ t, row, edit, shown, done }: { t: Table; row: number; edit: CellEdit; shown: string; done: (value: string | null) => void }) {
  const doc = useStore((s) => s.doc);
  // Enter ends the edit and takes the input away, which blurs it: the value is kept only once.
  const left = useRef(false);
  if (edit.kind === 'signal') {
    const e = doc.edges.find((x) => x.id === t.refs[row][0]);
    return (
      <select autoFocus defaultValue={e?.signal} onChange={(ev) => done(ev.target.value)} onBlur={() => done(null)} onKeyDown={(ev) => ev.key === 'Escape' && done(null)}>
        {allSignals()
          .filter((s) => s.cable)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
      </select>
    );
  }
  // A number column may show a word ("未設定") where there is no number yet.
  const start = edit.kind === 'number' && !/^-?[\d.]+$/.test(shown) ? '' : shown;
  const finish = (value: string | null) => {
    if (left.current) return;
    left.current = true;
    done(value === start ? null : value);
  };
  return (
    <input
      autoFocus
      defaultValue={start}
      inputMode={edit.kind === 'number' ? 'decimal' : undefined}
      onFocus={(ev) => ev.currentTarget.select()}
      onBlur={(ev) => finish(ev.currentTarget.value)}
      onKeyDown={(ev) => {
        if (ev.nativeEvent.isComposing) return;
        if (ev.key === 'Enter') finish(ev.currentTarget.value);
        else if (ev.key === 'Escape') finish(null);
      }}
    />
  );
}
