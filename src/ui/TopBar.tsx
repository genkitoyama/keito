import { fromYaml } from '../model/dsl';
import { randomId } from '../model/presets';
import { type Panel, emptyDoc, useStore } from '../model/store';
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
  const boards = useStore((s) => s.boards);
  const panel = useStore((s) => s.panel);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const saving = useStore((s) => s.saving);
  const mode = useStore((s) => s.mode);
  const st = useStore.getState;
  const toggle = (p: Panel) => st().setPanel(panel === p ? null : p);
  const list = boards.some((b) => b.id === doc.id) ? boards : [{ id: doc.id, title: doc.meta.title, updated: 0 }, ...boards];

  return (
    <header className="topbar">
      <b className="logo">keito</b>
      <select className="boards" value={doc.id} onChange={(e) => st().openBoard(e.target.value)} title="ボードを切り替え">
        {list.map((b) => (
          <option key={b.id} value={b.id}>{b.id === doc.id ? doc.meta.title : b.title}</option>
        ))}
      </select>
      <button onClick={() => st().newBoard()} data-tip="新しいボード">＋新規</button>
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
      <button onClick={openFile} data-tip="ファイルを開く（.keito.json / .yaml）">開く</button>
      <button onClick={() => void saveFile()} data-tip="画像込みの 1 ファイルに書き出す（⌘S）">書き出し</button>
      <span className={`save-state ${saving}`} title={mode === 'server' ? 'boards フォルダに自動保存' : 'このブラウザ内に自動保存'}>
        {saving === 'error' ? '保存できていません' : saving === 'saving' ? '保存中…' : mode === 'server' ? 'フォルダに保存済み' : 'ブラウザに保存済み'}
      </span>
      <span className="grow" />
      <button className={panel === 'lists' ? 'on' : ''} onClick={() => toggle('lists')}>機材・ケーブル表</button>
      <button className={panel === 'text' ? 'on' : ''} onClick={() => toggle('text')}>テキスト / AI</button>
      <button className="primary" onClick={() => toggle('export')}>エクスポート</button>
    </header>
  );
}
