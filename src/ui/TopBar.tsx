import { fromYaml } from '../model/dsl';
import { randomId } from '../model/presets';
import { type Panel, emptyDoc, useStore } from '../model/store';
import { tidy } from '../model/tidy';
import { KINDS, kindOf } from '../model/kinds';
import { openBoards } from './Boards';
import type { Doc } from '../model/types';
import { download, inlineImages, pickTextFile, safeName } from '../platform/storage';

/** Export the board as one self-contained file, pictures included. */
export async function saveFile(): Promise<void> {
  const doc = await inlineImages(useStore.getState().doc);
  download(`${safeName(doc.meta.title)}.keito.json`, JSON.stringify(doc, null, 2), 'application/json');
}

async function openFile(): Promise<void> {
  const f = await pickTextFile('.json,.yaml,.yml');
  if (!f) return;
  try {
    let doc: Doc;
    if (/\.ya?ml$/i.test(f.name)) {
      doc = fromYaml(f.text, emptyDoc(f.name.replace(/\.ya?ml$/i, '')));
    } else {
      doc = JSON.parse(f.text) as Doc;
      if (doc.version !== 1 || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('keito のファイルではありません');
    }
    // An opened file becomes a board of its own rather than replacing one that shares its id.
    if (useStore.getState().boards.some((b) => b.id === doc.id)) doc = { ...doc, id: randomId() };
    useStore.getState().newBoard(doc);
  } catch (e) {
    alert(`開けませんでした: ${e instanceof Error ? e.message : e}`);
  }
}

export function TopBar() {
  const doc = useStore((s) => s.doc);
  const panel = useStore((s) => s.panel);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const saving = useStore((s) => s.saving);
  const mode = useStore((s) => s.mode);
  const viewing = useStore((s) => !!s.viewing);
  const kind = useStore((s) => kindOf(s.doc));
  const st = useStore.getState;
  const toggle = (p: Panel) => st().setPanel(panel === p ? null : p);

  return (
    <header className="topbar">
      <b className="logo">keito</b>
      {/* The project and board on screen; the list of all of them opens from here. */}
      <button className="board-switch" onClick={() => openBoards()} data-tip="ボード一覧（案件ごと）">
        {doc.meta.project && <small>{doc.meta.project} ／</small>}
        <b className={`kind-badge ${doc.kind ?? 'system'}`}>{KINDS[doc.kind ?? 'system'].label}</b>
        <span>{doc.meta.title}</span>
        <i>▾</i>
      </button>
      <button onClick={() => openBoards(true)} data-tip="新しいボード（種類を選ぶ）">＋新規</button>
      <button onClick={async () => st().newBoard({ ...(await inlineImages(doc)), id: randomId(), meta: { ...doc.meta, title: `${doc.meta.title} のコピー` } })}>複製</button>
      <button
        onClick={() => {
          if (confirm(`「${doc.meta.title}」を削除しますか？`)) st().deleteBoard(doc.id);
        }}
      >
        削除
      </button>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => st().undo()} data-tip="元に戻す（⌘Z）" aria-label="元に戻す">↶</button>
      <button disabled={!canRedo} onClick={() => st().redo()} data-tip="やり直す（⇧⌘Z）" aria-label="やり直す">↷</button>
      <span className="sep" />
      <button disabled={viewing} onClick={() => st().setDoc(tidy(st().doc))} data-tip="整頓: 機材の高さをそろえて線をまっすぐにし、折れ位置を並べ直す（⌘Z で戻せます）">
        整頓
      </button>
      <span className="sep" />
      <button onClick={openFile} data-tip="ファイルを開く（.keito.json / .yaml）">開く</button>
      {saving === 'conflict' ? (
        // The board was written elsewhere (the command line …) while this page had changes of its own.
        <span className="save-state conflict">
          ほかの場所で更新されました
          <button data-tip="ファイルの内容を読み込みます（この画面の変更は ⌘Z で戻せます）" onClick={() => st().resolveConflict('reload')}>
            読み込む
          </button>
          <button data-tip="この画面の内容でファイルを上書きします" onClick={() => st().resolveConflict('overwrite')}>
            この画面で上書き
          </button>
        </span>
      ) : (
        <span className={`save-state ${saving}`} title={mode === 'server' ? 'boards フォルダに自動保存' : 'このブラウザ内に自動保存'}>
          {saving === 'error' ? '保存できていません' : saving === 'saving' ? '保存中…' : mode === 'server' ? 'フォルダに保存済み' : 'ブラウザに保存済み'}
        </span>
      )}
      <span className="grow" />
      {kind.lists.length > 0 && (
        <button className={panel === 'lists' ? 'on' : ''} onClick={() => toggle('lists')}>
          {kind.listsLabel}
        </button>
      )}
      <button className={panel === 'text' ? 'on' : ''} onClick={() => toggle('text')}>テキスト / AI</button>
      <button className="primary" onClick={() => toggle('export')}>エクスポート</button>
    </header>
  );
}
