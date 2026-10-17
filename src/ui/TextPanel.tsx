import { useState } from 'react';
import { generateYaml, promptFor } from '../model/ai';
import { DSL_GUIDE, fromYaml, toYaml } from '../model/dsl';
import { useStore } from '../model/store';
import { getSetting, setSetting } from '../platform/storage';

export function TextPanel() {
  const st = useStore.getState;
  const [yaml, setYaml] = useState(() => toYaml(st().doc));
  const [relayout, setRelayout] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState(() => getSetting('anthropicKey'));
  const [busy, setBusy] = useState(false);

  const apply = (close: boolean) => {
    try {
      const doc = fromYaml(yaml, st().doc, relayout);
      st().setDoc(doc);
      st().select([]);
      setError('');
      setInfo(`反映しました（機材/図形 ${doc.nodes.length}、結線 ${doc.edges.length}）`);
      setYaml(toYaml(doc));
      requestAnimationFrame(st().fit);
      if (close) st().setPanel(null);
    } catch (e) {
      setInfo('');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError('');
    setInfo('Claude が YAML を生成中…');
    try {
      setSetting('anthropicKey', apiKey);
      setYaml(await generateYaml(apiKey, prompt, yaml));
      setInfo('生成しました。内容を確認して「図に反映」を押してください。');
    } catch (e) {
      setInfo('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onPointerDown={() => st().setPanel(null)}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>テキスト / AI で図を作る</h2>
          <button onClick={() => st().setPanel(null)}>×</button>
        </header>
        <div className="modal-body cols">
          <div className="col">
            <textarea className="code" spellCheck={false} value={yaml} onChange={(e) => setYaml(e.target.value)} />
            {error && <p className="error">{error}</p>}
            {info && <p className="info">{info}</p>}
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={relayout} onChange={(e) => setRelayout(e.target.checked)} />
                位置を捨てて自動レイアウトし直す
              </label>
              <span className="grow" />
              <button onClick={() => navigator.clipboard.writeText(yaml)}>コピー</button>
              <button onClick={() => apply(false)}>図に反映</button>
              <button className="primary" onClick={() => apply(true)}>反映して閉じる</button>
            </div>
          </div>
          <div className="col side">
            <h4>AI に頼む</h4>
            <textarea
              rows={5}
              placeholder={'例: PC 2台の映像をスイッチャーで切り替えて、プロジェクター2台に分配する構成にして。制御はタブレットから。'}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <input type="password" placeholder="Anthropic API キー（このブラウザにのみ保存）" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <div className="row">
              <button className="primary" disabled={busy || !apiKey || !prompt.trim()} onClick={generate}>{busy ? '生成中…' : 'YAML を生成'}</button>
              <button
                disabled={!prompt.trim()}
                title="API キー無しで使う場合: Claude などのチャットに貼り、返ってきた YAML を左に貼り付けます"
                onClick={() => {
                  navigator.clipboard.writeText(promptFor(prompt, yaml));
                  setInfo('プロンプトをコピーしました。チャットに貼り、返ってきた YAML を左に貼り付けてください。');
                }}
              >
                プロンプトをコピー
              </button>
            </div>
            <p className="hint">
              Claude Code を使っているなら API キーは要りません。keito のフォルダで Claude Code に頼めば、同梱の CLI（<code>npm run keito</code>）でボードを読み書きし、この画面にもすぐ反映されます。
            </p>
            <h4>書式</h4>
            <pre className="guide">{DSL_GUIDE}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
