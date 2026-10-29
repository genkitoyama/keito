import { useState } from 'react';
import { commentsOf, pinLabel } from '../model/comments';
import { STICKY } from '../model/signals';
import { centerOn, useStore } from '../model/store';
import type { StickyNode } from '../model/types';

function when(t?: number): string {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/**
 * The comments of the board (its stickies): open ones first, oldest first, each one click from
 * where it sits on the board; settled ones apart, to bring back or clear away.
 */
export function CommentsPanel() {
  const st = useStore.getState;
  const doc = useStore((s) => s.doc);
  const viewing = useStore((s) => !!s.viewing);
  const selection = useStore((s) => s.selection);
  const [showDone, setShowDone] = useState(false);
  const all = commentsOf(doc).sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.y - b.y || a.x - b.x);
  const open = all.filter((n) => !n.done);
  const done = all.filter((n) => n.done);
  const go = (n: StickyNode) => {
    st().select([n.id]);
    centerOn(n.id);
  };
  const settle = (n: StickyNode, on: boolean) => st().updateNode(n.id, { done: on || undefined }, true);
  const row = (n: StickyNode) => {
    const [first, ...rest] = n.text.trim().split('\n');
    const pin = pinLabel(doc, n);
    return (
      <li key={n.id} className={`comment${selection.includes(n.id) ? ' on' : ''}${n.done ? ' done' : ''}`} onClick={() => go(n)}>
        <span className="swatch" style={{ background: STICKY[n.color].fill, borderColor: STICKY[n.color].stroke }} />
        <div className="body">
          <b>{first || '（空の付箋）'}</b>
          {rest.length > 0 && <p>{rest.join('\n')}</p>}
          {pin && <span className={`pin${pin.lost ? ' lost' : ''}`}>{pin.text}</span>}
          <small>{when(n.at)}</small>
        </div>
        <button
          className={`mini settle${n.done ? '' : ' primary'}`}
          disabled={viewing}
          onClick={(e) => {
            e.stopPropagation();
            settle(n, !n.done);
          }}
        >
          {n.done ? '未解決に戻す' : '✓ 解決'}
        </button>
      </li>
    );
  };
  return (
    <aside className="comments-panel" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <h3>コメント</h3>
        <small>未解決 {open.length} 件</small>
        <button className="mini" onClick={() => st().setDock('comments', false)} aria-label="閉じる">
          ×
        </button>
      </header>
      <ul>
        {open.map(row)}
        {!open.length && <li className="empty">未解決のコメントはありません。付箋（S）を貼ると、ここに並びます。</li>}
      </ul>
      {done.length > 0 && (
        <div className="done-part">
          <div className="row">
            <button className="mini" onClick={() => setShowDone(!showDone)}>
              {showDone ? '▾' : '▸'} 解決済み {done.length} 件
            </button>
            <button
              className="mini danger"
              disabled={viewing}
              data-tip="解決済みの付箋をボードから消します（⌘Z で戻せます）"
              onClick={() => st().removeIds(done.map((n) => n.id))}
            >
              まとめて消す
            </button>
          </div>
          {showDone && <ul>{done.map(row)}</ul>}
        </div>
      )}
    </aside>
  );
}
