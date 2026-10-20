import { useMemo } from 'react';
import { KINDS } from '../model/kinds';
import { type Entry, catalog, deviceName, deviceOf, occurrences } from '../model/shared';
import { useStore } from '../model/store';
import type { DeviceNode } from '../model/types';

/** Every shareable thing of the open board's project (the open board included). */
function useProject(): Entry[] {
  const doc = useStore((s) => s.doc);
  const others = useStore((s) => s.others);
  return useMemo(() => catalog([doc, ...others]), [doc, others]);
}

const firstLine = (s: string): string => s.split('\n')[0].trim();
const valueOf = (e: Entry): string => `${e.board}|${e.node.id}`;
const kindLabel = (e: Entry): string => KINDS[e.kind ?? 'system']?.label ?? '';

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
export function SharedSection({ n }: { n: DeviceNode }) {
  const st = useStore.getState;
  const doc = useStore((s) => s.doc);
  const entries = useProject();
  const project = doc.meta.project?.trim();
  if (!project) {
    return (
      <div className="shared">
        <h4>ほかのボードとの共有</h4>
        <p className="hint">ボード情報で案件名を付けると、同じ案件のボード（ほかのシステム図・ソフトウェア構成図）と同じものとしてつなげられます。</p>
      </div>
    );
  }
  // Software is shared with software (the gear it runs on is chosen as its host instead), gear with gear.
  const soft = doc.kind === 'software';
  const elsewhere = entries.filter((e) => e.board !== doc.id && (e.kind === 'software') === soft);
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
          <p className="hint">名前・メーカー・型番・カテゴリ・IP・ホスト名・リンクは、つないだボードどうしで同じに保たれます。</p>
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
  const gear = entries.filter((e) => e.board !== doc.id && e.kind !== 'software');
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
