import { useEffect, useMemo, useState } from 'react';
import { type Diff, describe, diff, labelOf } from '../model/history';
import { currentBoard, loadState, useStore } from '../model/store';
import type { Doc, Revision } from '../model/types';
import { composing } from './keys';

/** When a state was taken, as the list shows it under its day: "14:32". */
const time = (r: Revision): string => (r.at ? new Date(r.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '');

/** The heading of a day in the list: 今日, 昨日, or the date. */
function day(at: string | undefined): string {
  if (!at) return '日時不明';
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  return same(d, today) ? '今日' : same(d, yesterday) ? '昨日' : `${d.getMonth() + 1}/${d.getDate()}${d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

const SOURCE: Record<string, string> = { cli: 'CLI で変更する前', restore: '戻す前' };
const SHOWN = 12;

/**
 * The board's history in the board panel. States are kept on their own as the board is worked on;
 * a name keeps one for good ("先方提出"). Any of them can be opened, compared with the board as it
 * is now, or gone back to.
 */
export function Revisions() {
  const doc = useStore((s) => s.doc);
  const viewing = useStore((s) => s.viewing);
  const list = viewing ? viewing.all : (doc.revisions ?? []);
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null);
  const [more, setMore] = useState(false);
  const [comparing, setComparing] = useState<Revision | null>(null);
  const st = useStore.getState;
  const named = [...list].filter((r) => r.name).reverse();
  const auto = [...list].filter((r) => !r.name).reverse();
  const shown = more ? auto : auto.slice(0, SHOWN);

  const row = (r: Revision) => (
    <div key={r.id} className={`rev${viewing?.entry.id === r.id ? ' on' : ''}${r.name ? ' named' : ''}`}>
      <span className="rev-text">
        <b>{r.name ? r.name : time(r)}</b>
        <small>{[r.name && `${day(r.at)} ${time(r)}`, (r.source && SOURCE[r.source]) || r.summary].filter(Boolean).join('・')}</small>
      </span>
      <span className="rev-actions">
        <button className="mini" onClick={() => st().viewRevision(r.id)} data-tip="この時点の図を開く">
          開く
        </button>
        <button className="mini" onClick={() => setComparing(r)} data-tip="この時点から今までに変わったところ">
          違い
        </button>
        {!viewing && (
          <button className="mini" onClick={() => setNaming({ id: r.id, name: r.name ?? '' })} data-tip={r.name ? '名前を変える' : '名前を付けて残す（自動で消えなくなります）'}>
            {r.name ? '✎' : '★'}
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div className="revisions">
      <h4>
        履歴
        {!viewing && !naming && (
          <button className="mini" onClick={() => setNaming({ name: '' })} data-tip="今の図に名前を付けて残す（先方提出・確定版など）">
            名前を付けて残す
          </button>
        )}
      </h4>
      {naming && (
        <div className="rev-form">
          <input
            autoFocus
            placeholder="名前（例: 先方提出 10/15）"
            value={naming.name}
            onChange={(e) => setNaming({ ...naming, name: e.target.value })}
            onKeyDown={(e) => {
              if (composing(e)) return;
              if (e.key === 'Enter' && (naming.name.trim() || naming.id)) {
                if (naming.id) st().renameRevision(naming.id, naming.name);
                else st().nameState(naming.name);
                setNaming(null);
              } else if (e.key === 'Escape') setNaming(null);
            }}
          />
          <div className="row">
            <button
              className="primary"
              disabled={!naming.id && !naming.name.trim()}
              onClick={() => {
                if (naming.id) st().renameRevision(naming.id, naming.name);
                else st().nameState(naming.name);
                setNaming(null);
              }}
            >
              {naming.id ? (naming.name.trim() ? '名前を付ける' : '名前を外す') : '今の図を残す'}
            </button>
            {naming.id && (
              <button
                className="danger"
                onClick={() => {
                  if (confirm('この時点を履歴から消しますか？ 今の図は変わりません。')) st().deleteRevision(naming.id!);
                  setNaming(null);
                }}
              >
                履歴から消す
              </button>
            )}
            <button onClick={() => setNaming(null)}>やめる</button>
          </div>
        </div>
      )}
      {list.length === 0 && !naming && <p className="hint">編集が 2 分ほど止まると、その時点の図が自動でここに残ります。提出した版など、ずっと残したい時点には名前を付けてください。</p>}
      {named.length > 0 && (
        <>
          <div className="rev-day">名前を付けた版</div>
          {named.map(row)}
        </>
      )}
      {shown.map((r, i) => (
        <div key={r.id}>
          {(i === 0 || day(r.at) !== day(shown[i - 1].at)) && <div className="rev-day">{day(r.at)}</div>}
          {row(r)}
        </div>
      ))}
      {auto.length > SHOWN && (
        <button className="mini rev-more" onClick={() => setMore(!more)}>
          {more ? 'たたむ' : `さらに ${auto.length - SHOWN} 件`}
        </button>
      )}
      {comparing && <Compare entry={comparing} onClose={() => setComparing(null)} />}
    </div>
  );
}

/** What changed between a state in the history and the board as it is now, ready to paste in a message. */
function Compare({ entry, onClose }: { entry: Revision; onClose: () => void }) {
  const [then, setThen] = useState<Doc | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadState(entry.id).then((d) => live && setThen(d), () => live && setThen(null));
    return () => {
      live = false;
    };
  }, [entry.id]);
  const now = currentBoard();
  const d: Diff | null = useMemo(() => (then ? diff(then, now) : null), [then, now]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal compare" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>「{labelOf(entry)}」から今までの変更</h2>
          <button onClick={onClose}>×</button>
        </header>
        <div className="modal-body">
          {then === undefined && <p className="hint">読み込み中…</p>}
          {then === null && <p className="error">この時点の図が見つかりませんでした。</p>}
          {d && (
            <>
              {(['devices', 'cables'] as const).map((k) => (
                <section key={k}>
                  <h4>{k === 'devices' ? '機材' : 'ケーブル'}</h4>
                  {d[k].length ? (
                    <ul className="changes">
                      {d[k].map((c, i) => (
                        <li key={i} className={c.kind === '追加' ? 'add' : c.kind === '削除' ? 'del' : 'mod'}>
                          <b>{c.kind}</b> {c.what}
                          {c.detail && <small>{c.detail}</small>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hint">変わっていません。</p>
                  )}
                </section>
              ))}
              {d.others.added + d.others.removed + d.others.changed > 0 && (
                <p className="hint">
                  図形・メモ・矢印など: 追加 {d.others.added}・削除 {d.others.removed}・変更 {d.others.changed}
                </p>
              )}
              <div className="row">
                <span className="grow" />
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(`「${labelOf(entry)}」からの変更点\n${describe(d)}`);
                    setCopied(true);
                  }}
                >
                  {copied ? 'コピーしました' : 'テキストでコピー'}
                </button>
                <button className="primary" onClick={onClose}>
                  閉じる
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown across the top of the board while an older state is open. */
export function RevisionBanner() {
  const viewing = useStore((s) => s.viewing);
  const [comparing, setComparing] = useState(false);
  if (!viewing) return null;
  const { entry } = viewing;
  const st = useStore.getState;
  return (
    <div className="rev-banner">
      <span>
        <b>{entry.name ? `「${entry.name}」` : `${day(entry.at)} ${time(entry)} の状態`}</b>を表示中。ここでの編集は保存されません。エクスポートはこの時点の内容で出ます。
      </span>
      <span className="grow" />
      <button onClick={() => setComparing(true)}>今との違い</button>
      <button
        onClick={() => {
          if (confirm('今の図をこの時点の内容に戻しますか？ 今の状態は履歴に残るので、あとから戻せます。')) st().restoreRevision();
        }}
      >
        この時点に戻す
      </button>
      <button className="primary" onClick={() => st().exitRevision()}>
        現在の図に戻る
      </button>
      {comparing && <Compare entry={entry} onClose={() => setComparing(false)} />}
    </div>
  );
}
