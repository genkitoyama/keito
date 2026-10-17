import { useMemo } from 'react';
import { KINDS } from '../model/kinds';
import { type Entry, catalog, deviceName, deviceOf, occurrences } from '../model/shared';
import { useStore } from '../model/store';
import type { DeviceNode, Node, ScreenSpec, ShapeNode } from '../model/types';

/** Every shareable thing of the open board's project (the open board included). */
function useProject(): Entry[] {
  const doc = useStore((s) => s.doc);
  const others = useStore((s) => s.others);
  return useMemo(() => catalog([doc, ...others]), [doc, others]);
}

const firstLine = (s: string): string => s.split('\n')[0].trim();
const valueOf = (e: Entry): string => `${e.board}|${e.node.id}`;
const kindLabel = (e: Entry): string => KINDS[e.kind ?? 'system']?.label ?? '';

/**
 * Things worth sharing: gear, and what stands for it on a layout or screen board (furniture, an
 * output). A box on a system board, a step of a flow, is no thing of its own; once shared, anything is.
 */
const isThing = (e: Entry): boolean => e.node.type === 'device' || !!e.node.shared || e.kind === 'layout' || (e.kind === 'screen' && !!e.node.screen);

/** Whether a node on the open board gets the sharing section at all. */
export function sharesHere(n: Node, kind: string | undefined): boolean {
  if (n.type === 'device') return true;
  if (n.type !== 'shape' || n.screen?.role === 'canvas' || n.flow) return false;
  return !!n.shared || kind === 'layout' || kind === 'screen';
}

/** Options grouped by board, the boards in the order of the project's list. */
function Choices({ entries }: { entries: Entry[] }) {
  const boards = [...new Set(entries.map((e) => e.board))];
  return (
    <>
      {boards.map((b) => {
        const mine = entries.filter((e) => e.board === b);
        return (
          <optgroup key={b} label={`${mine[0].boardTitle}（${kindLabel(mine[0])}）`}>
            {mine.map((e) => (
              <option key={valueOf(e)} value={valueOf(e)}>
                {firstLine(e.node.text)}
                {e.node.shared ? '　🔗' : ''}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/**
 * Sharing a node with the other boards of the project: where else it appears (one click away), or
 * what it could be linked to — things of the same name first.
 */
export function SharedSection({ n }: { n: DeviceNode | ShapeNode }) {
  const st = useStore.getState;
  const doc = useStore((s) => s.doc);
  const entries = useProject();
  const project = doc.meta.project?.trim();
  if (!project) {
    return (
      <div className="shared">
        <h4>ほかのボードとの共有</h4>
        <p className="hint">ボード情報で案件名を付けると、同じ案件のボード（配置図・ソフト構成図など）と同じものとしてつなげられます。</p>
      </div>
    );
  }
  // Software is shared with software (the gear it runs on is chosen as its host instead), gear with gear.
  const soft = doc.kind === 'software';
  const elsewhere = entries.filter((e) => e.board !== doc.id && isThing(e) && (e.kind === 'software') === soft);
  const seen = occurrences(entries, n.shared, { board: doc.id, node: n.id });
  // Software shared between software boards is rare: with nothing to link it to, no section at all.
  if (soft && !n.shared && !elsewhere.length) return null;
  const name = firstLine(n.text);
  const alike = n.shared ? [] : elsewhere.filter((e) => name && firstLine(e.node.text) === name);
  const pick = (v: string) => {
    const e = elsewhere.find((x) => valueOf(x) === v);
    if (e) st().linkTo(n.id, e);
  };
  return (
    <div className="shared">
      <h4>ほかのボードとの共有</h4>
      {n.shared ? (
        <>
          <p className="hint">名前{n.type === 'device' ? '・メーカー・型番・カテゴリ・IP・ホスト名・リンク' : ''}は、つないだボードどうしで同じに保たれます。</p>
          {seen.length ? (
            <ul className="shared-list">
              {seen.map((e) => (
                <li key={valueOf(e)}>
                  <b className={`kind-badge ${e.kind ?? 'system'}`}>{kindLabel(e)}</b>
                  <span>
                    {e.boardTitle}
                    {e.board === doc.id ? '（このボード）' : ''}
                  </span>
                  <button className="mini" onClick={() => st().openAt(e.board, e.node.id)}>
                    開く
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">つながっているほかのボードは、今は見つかりません（消されたか、案件が変わったようです）。</p>
          )}
          <button className="mini" data-tip="このボードのものだけを切り離します。ほかのボードのものはそのままです" onClick={() => st().unlink(n.id)}>
            つなぎを外す
          </button>
        </>
      ) : (
        <>
          {alike.map((e) => (
            <div className="shared-suggest" key={valueOf(e)}>
              <span>
                「{e.boardTitle}」に同じ名前の<b>{name}</b>があります
              </span>
              <button className="mini primary" onClick={() => st().linkTo(n.id, e)}>
                つなぐ
              </button>
            </div>
          ))}
          {elsewhere.length > 0 ? (
            <label className="field">
              <span>ほかのボードのものと同じものにする</span>
              <select value="" onChange={(e) => pick(e.target.value)}>
                <option value="">選ぶ…</option>
                <Choices entries={elsewhere} />
              </select>
            </label>
          ) : (
            <p className="hint">同じ案件のほかのボードに、つなげられるものがまだありません。</p>
          )}
        </>
      )}
    </div>
  );
}

/** The device a piece of software runs on, from the gear of the project's other boards. */
export function RunsOn({ n }: { n: DeviceNode }) {
  const st = useStore.getState;
  const doc = useStore((s) => s.doc);
  const entries = useProject();
  if (!doc.meta.project?.trim()) return null;
  const gear = entries.filter((e) => e.board !== doc.id && e.node.type === 'device' && e.kind !== 'software');
  const host = n.runsOn ? deviceOf(entries, n.runsOn) : undefined;
  const current = n.runsOn ? gear.find((e) => e.node.shared === n.runsOn) : undefined;
  if (!gear.length && !n.runsOn) return null;
  return (
    <label className="field">
      <span>動作ホスト（ほかのボードの機材）</span>
      <select
        value={current ? valueOf(current) : n.runsOn ? '?' : ''}
        onChange={(e) => st().runOn(n.id, gear.find((x) => valueOf(x) === e.target.value) ?? null)}
      >
        <option value="">指定しない（下に手で書く）</option>
        {n.runsOn && !current && <option value="?">{host ? deviceName(host) : '見つからない機材'}</option>}
        <Choices entries={gear} />
      </select>
    </label>
  );
}

/** The device port that feeds a screen output, from the gear of the project's other boards. */
export function FeedFrom({ n, screen }: { n: ShapeNode; screen: ScreenSpec }) {
  const st = useStore.getState;
  const doc = useStore((s) => s.doc);
  const entries = useProject();
  if (!doc.meta.project?.trim()) return null;
  const gear = entries.filter((e) => e.board !== doc.id && e.node.type === 'device' && e.kind !== 'software' && (e.node as DeviceNode).ports.some((p) => p.side === 'right'));
  const feed = screen.feed;
  const current = feed ? gear.find((e) => e.node.shared === feed.shared) : undefined;
  if (!gear.length && !feed) return null;
  const ports = current ? (current.node as DeviceNode).ports.filter((p) => p.side === 'right') : [];
  return (
    <div className="grid2">
      <label className="field">
        <span>送出元の機材</span>
        <select
          value={current ? valueOf(current) : feed ? '?' : ''}
          onChange={(e) => {
            const src = gear.find((x) => valueOf(x) === e.target.value) ?? null;
            const first = src ? (src.node as DeviceNode).ports.find((p) => p.side === 'right')?.name : '';
            st().feedFrom(n.id, src, first);
          }}
        >
          <option value="">指定しない</option>
          {feed && !current && <option value="?">見つからない機材</option>}
          <Choices entries={gear} />
        </select>
      </label>
      {current && (
        <label className="field">
          <span>出力端子</span>
          <select value={feed?.port ?? ''} onChange={(e) => st().feedFrom(n.id, current, e.target.value)}>
            {ports.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
