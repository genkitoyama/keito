import { useState } from 'react';
import { MAX_REVISIONS, nextRev, useStore } from '../model/store';

/** Revision history in the board panel: record the current state as a revision, and go back to old ones. */
export function Revisions() {
  const doc = useStore((s) => s.doc);
  const viewing = useStore((s) => s.viewing);
  const list = viewing ? viewing.all : (doc.revisions ?? []);
  const [form, setForm] = useState<{ rev: string; note: string } | null>(null);
  const st = useStore.getState;
  return (
    <div className="revisions">
      <h4>
        改訂履歴
        {!viewing && !form && (
          <button className="mini" onClick={() => setForm({ rev: list.length ? nextRev(list[list.length - 1].rev) : 'A', note: '' })}>
            版を記録
          </button>
        )}
      </h4>
      {form && (
        <div className="rev-form">
          <div className="row">
            <input className="rev-id" value={form.rev} onChange={(e) => setForm({ ...form, rev: e.target.value })} aria-label="版の記号" />
            <input autoFocus placeholder="改訂内容（例: PJ を 2 台に変更）" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div className="row">
            <button
              className="primary"
              disabled={!form.rev.trim()}
              onClick={() => {
                st().recordRevision(form.rev.trim(), form.note.trim());
                setForm(null);
              }}
            >
              今の図をこの版として記録
            </button>
            <button onClick={() => setForm(null)}>やめる</button>
          </div>
        </div>
      )}
      {list.length === 0 && !form && <p className="hint">「版を記録」で、その時点の図を版として残せます。あとから開いて見たり、その版の図面を書き出したり、戻したりできます（{MAX_REVISIONS} 版まで）。</p>}
      {[...list].reverse().map((r) => (
        <div key={r.id} className={`rev${viewing?.entry.id === r.id ? ' on' : ''}`}>
          <b>{r.rev}</b>
          <span className="rev-text">
            <small>{r.date}</small>
            {r.note || '—'}
          </span>
          <button className="mini" onClick={() => st().viewRevision(r.id)}>
            開く
          </button>
          {!viewing && (
            <button
              className="mini danger"
              title="この版の記録を消す"
              onClick={() => {
                if (confirm(`${r.rev} 版（${r.date}）の記録を消しますか？ 今の図は変わりません。`)) st().deleteRevision(r.id);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Shown across the top of the board while an old revision is open. */
export function RevisionBanner() {
  const viewing = useStore((s) => s.viewing);
  if (!viewing) return null;
  const { entry } = viewing;
  const st = useStore.getState;
  return (
    <div className="rev-banner">
      <span>
        <b>{entry.rev} 版</b>（{entry.date}
        {entry.note ? `・${entry.note}` : ''}）を表示中。ここでの編集は保存されません。エクスポートはこの版の内容で出ます。
      </span>
      <span className="grow" />
      <button
        onClick={() => {
          if (confirm(`今の図を ${entry.rev} 版の内容に戻しますか？（⌘Z で取り消せます。今の状態を残したい場合は、先に「版を記録」してください）`)) st().restoreRevision();
        }}
      >
        この版に戻す
      </button>
      <button className="primary" onClick={() => st().exitRevision()}>
        現在の図に戻る
      </button>
    </div>
  );
}
