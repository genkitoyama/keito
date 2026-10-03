import { useMemo, useState } from 'react';
import { type Table, cableSummaryTable, cableTable, equipmentTable, toCsv } from '../model/lists';
import { useStore } from '../model/store';
import { download, safeName } from '../platform/storage';

const TABS = ['機材リスト', 'ケーブルリスト', 'ケーブル集計'] as const;

export function ListsPanel() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const [tab, setTab] = useState(0);
  const tables = useMemo<Table[]>(() => [equipmentTable(doc), cableTable(doc), cableSummaryTable(doc)], [doc]);
  const t = tables[tab];
  const sel = new Set(selection);
  const totalLength = doc.edges.reduce((a, e) => a + (e.length ?? 0), 0);

  return (
    <section className="lists">
      <div className="tabs">
        {TABS.map((name, i) => (
          <button key={name} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>
            {name} <small>{tables[i].rows.length}</small>
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
            <tr>{t.head.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i} className={t.refs[i].some((id) => sel.has(id)) ? 'on' : ''} onClick={() => useStore.getState().select(t.refs[i])}>
                {row.map((c, j) => <td key={j}>{c}</td>)}
              </tr>
            ))}
            {!t.rows.length && (
              <tr>
                <td colSpan={t.head.length} className="empty">機材ライブラリから機材を置き、ポート同士をドラッグで結ぶとここに自動で一覧が出ます。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
