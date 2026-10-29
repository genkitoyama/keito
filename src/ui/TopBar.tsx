import { ProjectMenu } from './ProjectMenu';
import { fromYaml } from '../model/dsl';
import { randomId } from '../model/presets';
import { type Panel, emptyDoc, saveNow, useStore } from '../model/store';
import { tidy } from '../model/tidy';
import { kindOf } from '../model/kinds';
import { openComments } from '../model/comments';
import { openBoards } from './Boards';
import { ICON } from './icons';
import type { Doc } from '../model/types';
import { inlineImages, safeName } from '../platform/storage';
import { ask, pickTextFile, saveFile, tell } from '../platform/io';

/** Export the board as one self-contained file, pictures included. */
export async function saveBoardFile(): Promise<void> {
  const doc = await inlineImages(useStore.getState().doc);
  await saveFile(`${safeName(doc.meta.title)}.keito.json`, JSON.stringify(doc, null, 2), 'application/json');
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
    void tell(`開けませんでした: ${e instanceof Error ? e.message : e}`);
  }
}

export function TopBar() {
  const doc = useStore((s) => s.doc);
  const panel = useStore((s) => s.panel);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const saving = useStore((s) => s.saving);
  const saveError = useStore((s) => s.saveError);
  const mode = useStore((s) => s.mode);
  const viewing = useStore((s) => !!s.viewing);
  const kind = useStore((s) => kindOf(s.doc));
  const comments = useStore((s) => openComments(s.doc).length);
  const st = useStore.getState;
  const toggle = (p: Panel) => st().setPanel(panel === p ? null : p);

  return (
    <header className="topbar">
      <b className="logo">keito</b>
      <span className="sep" />
      {/* The project on screen (its boards are the tabs below), and the others to jump to. */}
      <ProjectMenu />
      {/* Boards and files: made, copied, opened, deleted. */}
      <button className="ghost" onClick={() => openBoards(true)} data-tip="新しいボードを作る（種類を選ぶ）">
        {ICON.plus}
        新しいボード
      </button>
      <button className="ghost" data-tip="このボードをまるごと複製して、コピーを開く（図形の複製は ⌘D）" onClick={async () => st().newBoard({ ...(await inlineImages(doc)), id: randomId(), meta: { ...doc.meta, title: `${doc.meta.title} のコピー` } })}>
        {ICON.duplicate}
        ボードを複製
      </button>
      <button className="ghost" onClick={openFile} data-tip="ファイルを開いて新しいボードにする（.keito.json / .yaml）">
        {ICON.folder}
        ファイルを開く
      </button>
      <button
        className="ghost danger-hover"
        data-tip="このボードを削除（ボード一覧から戻せます。図形の削除は Delete）"
        onClick={() => {
          void ask(`「${doc.meta.title}」を削除しますか？\n（ボード一覧の「最近削除したボード」から戻せます）`).then((yes) => yes && st().deleteBoard(doc.id));
        }}
      >
        {ICON.trash}
        ボードを削除
      </button>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => st().undo()} data-tip="元に戻す（⌘Z）" aria-label="元に戻す" className="ghost icon">{ICON.undo}</button>
      <button disabled={!canRedo} onClick={() => st().redo()} data-tip="やり直す（⇧⌘Z）" aria-label="やり直す" className="ghost icon">{ICON.redo}</button>
      <button className="ghost" disabled={viewing} onClick={() => st().setDoc(tidy(st().doc))} data-tip="整頓: 機材の高さをそろえて線をまっすぐにし、折れ位置を並べ直す（⌘Z で戻せます）">
        {ICON.tidy}
        整頓
      </button>
      <span className="sep" />
      {saving === 'gone' ? (
        // Deleted elsewhere (another tab, the command line) while it was open here.
        <span className="save-state conflict">
          ほかの場所で削除されました
          <button data-tip="この画面の内容でボードを作り直します（削除したものはボード一覧の「最近削除したボード」に残ります）" onClick={() => st().resolveConflict('overwrite')}>
            この画面で作り直す
          </button>
        </span>
      ) : saving === 'conflict' ? (
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
        <span className={`save-state ${saving}`} title={saving === 'error' ? `理由: ${saveError ?? '不明'}\n少しずつ間をあけて自動でやり直しています。` : mode === 'server' ? 'boards フォルダに自動保存（⌘S で今すぐ保存）' : 'このブラウザ内に自動保存（⌘S で今すぐ保存）'}>
          {saving === 'error' ? '保存できていません' : saving === 'saving' ? '保存中…' : mode === 'server' ? 'フォルダに保存済み' : 'ブラウザに保存済み'}
          {saving === 'error' && <button onClick={() => void saveNow()}>もう一度</button>}
        </span>
      )}
      <span className="grow" />
      {/* Panels that open beside the drawing, then the one thing the board is made for: export. */}
      {kind.lists.length > 0 && (
        <button className={`ghost${panel === 'lists' ? ' on' : ''}`} onClick={() => toggle('lists')}>
          {ICON.table}
          {kind.listsLabel}
        </button>
      )}
      <button className={`ghost${panel === 'comments' ? ' on' : ''}`} onClick={() => toggle('comments')} data-tip="付箋（コメント）の一覧">
        {ICON.comment}
        コメント{comments > 0 && <b className="count">{comments}</b>}
      </button>
      <button className="primary export-btn" onClick={() => toggle('export')}>
        {ICON.download}
        エクスポート
      </button>
    </header>
  );
}
