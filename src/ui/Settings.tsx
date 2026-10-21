import { useEffect, useState } from 'react';
import { useStore } from '../model/store';
import { boardsFolder } from '../platform/io';

/**
 * The app's settings (keito > 設定…, ⌘,): for now, the folder boards are kept in. Only the desktop
 * app has a folder to choose; a browser keeps boards where its server or storage does.
 */
export function SettingsPanel() {
  const close = () => useStore.getState().setPanel(null);
  const folder = boardsFolder();
  const [where, setWhere] = useState<{ path: string; fixed: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void folder?.where().then(setWhere, (e: unknown) => setError(String(e)));
  }, [folder]);
  return (
    <div className="modal-bg" onPointerDown={close}>
      <div className="modal settings" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>設定</h2>
          <button onClick={close}>×</button>
        </header>
        <div className="modal-body">
          <section className="board-section">
            <h4>ボードの保存場所</h4>
            {!folder && <p className="hint">ブラウザ版では、開発サーバーのフォルダかブラウザ内に保存されます（README の「保存場所」）。</p>}
            {folder && where && (
              <>
                <code className="folder-path">{where.path}</code>
                {where.fixed ? (
                  <p className="hint">環境変数 KEITO_BOARDS か ~/.config/keito/config.json で決められているため、ここでは変えられません。</p>
                ) : (
                  <>
                    <button onClick={() => void folder.change().catch((e: unknown) => setError(String(e)))}>別のフォルダにする…</button>
                    <p className="hint">変えると、そのフォルダのボードを開き直します。今のフォルダのボードはそのまま残ります（移したいときはフォルダごとコピーしてください）。</p>
                  </>
                )}
              </>
            )}
            {error && <p className="error">{error}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
