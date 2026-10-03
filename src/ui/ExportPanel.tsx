import { useMemo, useState } from 'react';
import { type CadOptions, type Paper, cadSheets } from '../export/cad';
import { boardImage, copyPng, printSheets, sheetImage, toPng } from '../export/exporters';
import { useStore } from '../model/store';
import { download, safeName } from '../platform/storage';

export function ExportPanel() {
  const doc = useStore((s) => s.doc);
  const [mode, setMode] = useState<'cad' | 'image'>('cad');
  const [opts, setOpts] = useState<CadOptions>({ paper: 'A3', color: false, tables: true });
  const [background, setBackground] = useState(true);
  const [scale, setScale] = useState(2);
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState('');

  const { sheets, textMm } = useMemo(() => cadSheets(doc, opts), [doc, opts]);
  const image = useMemo(() => boardImage(doc, background), [doc, background]);
  const name = safeName(doc.meta.title);
  const sheet = sheets[Math.min(page, sheets.length - 1)];
  const current = mode === 'cad' ? sheetImage(sheet) : image;
  const run = (fn: () => Promise<void> | void, done: string) => async () => {
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setMsg(`失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  };
  const suffix = mode === 'cad' ? `_系統図_${page + 1}` : '';

  return (
    <div className="modal-bg" onPointerDown={() => useStore.getState().setPanel(null)}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>エクスポート</h2>
          <button onClick={() => useStore.getState().setPanel(null)}>×</button>
        </header>
        <div className="modal-body cols">
          <div className="col side">
            <div className="seg">
              <button className={mode === 'cad' ? 'on' : ''} onClick={() => setMode('cad')}>CAD風 系統図</button>
              <button className={mode === 'image' ? 'on' : ''} onClick={() => setMode('image')}>画像</button>
            </div>
            {mode === 'cad' ? (
              <>
                <label className="field">
                  <span>用紙（横）</span>
                  <select value={opts.paper} onChange={(e) => setOpts({ ...opts, paper: e.target.value as Paper })}>
                    <option>A3</option>
                    <option>A4</option>
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={opts.color} onChange={(e) => setOpts({ ...opts, color: e.target.checked })} />
                  信号ごとの色を残す（オフでモノクロ・線種で区別）
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={opts.tables}
                    onChange={(e) => {
                      setOpts({ ...opts, tables: e.target.checked });
                      setPage(0);
                    }}
                  />
                  機材表・ケーブル表のシートを付ける
                </label>
                <p className="hint">
                  JIS Z 8311 準拠の図面枠（とじ代 20mm・中心マーク・格子参照・比較目盛・表題欄）。表題欄はボード情報（何も選択していないときの右パネル）から入ります。
                </p>
                {textMm < 2.5 && (
                  <p className="error">
                    図が大きく、最小の文字高さが約 {textMm.toFixed(1)}mm になります（JIS Z 8313 の最小は 2.5mm）。{opts.paper === 'A4' ? 'A3 にするか、' : ''}ボードを分けると読みやすくなります。
                  </p>
                )}
                <button className="primary wide" onClick={run(() => printSheets(sheets, doc.meta.title), '印刷ダイアログで送信先を「PDF に保存」にしてください（用紙は横向きで出ます）。')}>
                  PDF（{opts.paper} 横・全 {sheets.length} シート）
                </button>
              </>
            ) : (
              <label className="check">
                <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
                白背景を付ける（オフで透過）
              </label>
            )}
            <label className="field">
              <span>PNG 解像度</span>
              <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
                <option value={4}>4x</option>
              </select>
            </label>
            <button className="wide" onClick={run(async () => download(`${name}${suffix}.png`, await toPng(current, scale)), 'PNG を保存しました。')}>PNG を保存</button>
            <button className="wide" onClick={run(async () => copyPng(await toPng(current, scale)), 'クリップボードにコピーしました。スライドにそのまま貼れます。')}>PNG をコピー</button>
            <button className="wide" onClick={run(() => download(`${name}${suffix}.svg`, mode === 'cad' ? sheet.svg : image.svg, 'image/svg+xml'), 'SVG を保存しました。')}>SVG を保存</button>
            {msg && <p className="info">{msg}</p>}
          </div>
          <div className="col">
            {mode === 'cad' && sheets.length > 1 && (
              <div className="row">
                {sheets.map((_, i) => (
                  <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>シート {i + 1}</button>
                ))}
              </div>
            )}
            <div className={`preview ${mode === 'image' && !background ? 'checker' : ''}`} dangerouslySetInnerHTML={{ __html: current.svg.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="100%"') }} />
          </div>
        </div>
      </div>
    </div>
  );
}
