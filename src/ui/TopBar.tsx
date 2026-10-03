import { fromYaml } from '../model/dsl';
import { randomId } from '../model/presets';
import { type Panel, emptyDoc, useStore } from '../model/store';
import type { Doc } from '../model/types';
import { download, pickTextFile, safeName } from '../platform/storage';

export function saveFile(): void {
  const doc = useStore.getState().doc;
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
      <button onClick={() => st().newBoard()} title="新しいボード">＋新規</button>
      <button onClick={() => st().newBoard({ ...doc, id: randomId(), meta: { ...doc.meta, title: `${doc.meta.title} のコピー` } })}>複製</button>
      <button
        onClick={() => {
          if (confirm(`「${doc.meta.title}」を削除しますか？`)) st().deleteBoard(doc.id);
        }}
      >
        削除
      </button>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => st().undo()} title="元に戻す (⌘Z)">↶</button>
      <button disabled={!canRedo} onClick={() => st().redo()} title="やり直す (⇧⌘Z)">↷</button>
      <span className="sep" />
      <button onClick={openFile} title="ファイルを開く (.keito.json / .yaml)">開く</button>
      <button onClick={saveFile} title="ファイルに保存 (⌘S)">保存</button>
      <span className="grow" />
      <button className={panel === 'lists' ? 'on' : ''} onClick={() => toggle('lists')}>機材・ケーブル表</button>
      <button className={panel === 'text' ? 'on' : ''} onClick={() => toggle('text')}>テキスト / AI</button>
      <button className="primary" onClick={() => toggle('export')}>エクスポート</button>
    </header>
  );
}
