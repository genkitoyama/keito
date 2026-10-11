import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Paper, boardImage, copyPng, pdfHtml, printHtml, toPng } from '../export/exporters';
import { type Table, cableSummaryTable, cableTable, compact, equipmentTable, powerTable } from '../model/lists';
import { useStore } from '../model/store';
import { type Doc, latestRev } from '../model/types';
import { download, getSetting, inlineImages, safeName, setSetting } from '../platform/storage';

const LISTS = [
  { key: 'equipment', label: '機材リスト', make: equipmentTable },
  { key: 'cables', label: 'ケーブルリスト', make: cableTable },
  { key: 'summary', label: 'ケーブル集計', make: cableSummaryTable },
  { key: 'power', label: '電源系統', make: powerTable },
] as const;
type ListKey = (typeof LISTS)[number]['key'];
const PAGE_PX: Record<Paper, number> = { A4: (297 / 25.4) * 96, A3: (420 / 25.4) * 96 };

export function ExportPanel() {
  const board = useStore((s) => s.doc);
  // Exports must stand alone, so pictures kept in the board's folder are pulled back in first.
  const [inlined, setInlined] = useState<{ from: Doc; doc: Doc } | null>(null);
  useEffect(() => {
    let live = true;
    void inlineImages(board).then((d) => live && setInlined({ from: board, doc: d }));
    return () => {
      live = false;
    };
  }, [board]);
  const doc = inlined?.from === board ? inlined.doc : board;
  const [mode, setMode] = useState<'pdf' | 'image'>('pdf');
  const [paper, setPaper] = useState<Paper>(() => (getSetting('pdfPaper') === 'A3' ? 'A3' : 'A4'));
  const [lists, setLists] = useState<ListKey[]>(() => {
    const saved = getSetting('pdfLists');
    return saved ? (saved.split(',').filter((k) => LISTS.some((l) => l.key === k)) as ListKey[]) : ['equipment', 'cables'];
  });
  const [background, setBackground] = useState(true);
  const [scale, setScale] = useState(2);
  const [msg, setMsg] = useState('');

  const tables = useMemo(() => new Map<ListKey, Table>(LISTS.map((l) => [l.key, compact(l.make(doc))])), [doc]);
  const chosen = LISTS.filter((l) => lists.includes(l.key) && tables.get(l.key)!.rows.length).map((l) => tables.get(l.key)!);
  const image = useMemo(() => boardImage(doc, background), [doc, background]);
  const name = safeName(doc.meta.title);

  // The preview shows whole pages scaled to the width of the pane.
  const pane = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [mode]);
  const zoom = width ? Math.min(1, (width - 16) / (PAGE_PX[paper] + 48)) : 0.5;
  // An old revision on screen exports under its own mark; the live board under the latest one recorded.
  const rev = useStore((s) => s.viewing?.entry.rev ?? latestRev(s.doc));
  const html = useMemo(() => pdfHtml(doc, { paper, rev, tables: chosen }, zoom), [doc, paper, rev, zoom, chosen.map((t) => t.title).join()]);

  const run = (fn: () => Promise<void> | void, done: string) => async () => {
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setMsg(`失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  };
  const toggle = (key: ListKey, on: boolean) => {
    const next = LISTS.map((l) => l.key).filter((k) => (k === key ? on : lists.includes(k)));
    setLists(next);
    setSetting('pdfLists', next.join(',') || 'none');
  };

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
              <button className={mode === 'pdf' ? 'on' : ''} onClick={() => setMode('pdf')}>PDF</button>
              <button className={mode === 'image' ? 'on' : ''} onClick={() => setMode('image')}>画像</button>
            </div>
            {mode === 'pdf' ? (
              <>
                <label className="field">
                  <span>用紙（横）</span>
                  <select
                    value={paper}
                    onChange={(e) => {
                      setPaper(e.target.value as Paper);
                      setSetting('pdfPaper', e.target.value);
                    }}
                  >
                    <option>A4</option>
                    <option>A3</option>
                  </select>
                </label>
                <p className="hint">1 ページ目に図、そのあとに選んだリストが付きます。</p>
                {LISTS.map((l) => {
                  const rows = tables.get(l.key)!;
                  const count = rows.rows.length - (rows.total ? 1 : 0);
                  return (
                    <label key={l.key} className="check">
                      <input type="checkbox" checked={lists.includes(l.key)} disabled={!count} onChange={(e) => toggle(l.key, e.target.checked)} />
                      {l.label} <small>{count ? `${count} 行` : 'なし'}</small>
                    </label>
                  );
                })}
                <p className="hint">
                  何も書かれていない列（URL や備考など）は出しません。長いリストは自動で改ページされ、見出し行が各ページに付きます。見出しの右にはボード情報（案件名・REV・作成者）と今日の日付が入ります。
                </p>
                <button className="primary wide" onClick={run(() => printHtml(pdfHtml(doc, { paper, rev, tables: chosen })), '印刷ダイアログで送信先を「PDF に保存」にしてください（用紙は横向きで出ます）。')}>
                  PDF にする（{paper} 横）
                </button>
              </>
            ) : (
              <>
                <label className="check">
                  <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
                  白背景を付ける（オフで透過）
                </label>
                <label className="field">
                  <span>PNG 解像度</span>
                  <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={3}>3x</option>
                    <option value={4}>4x</option>
                  </select>
                </label>
                <button className="wide" onClick={run(async () => download(`${name}.png`, await toPng(image, scale)), 'PNG を保存しました。')}>PNG を保存</button>
                <button className="wide" onClick={run(async () => copyPng(await toPng(image, scale)), 'クリップボードにコピーしました。スライドにそのまま貼れます。')}>PNG をコピー</button>
                <button className="wide" onClick={run(() => download(`${name}.svg`, image.svg, 'image/svg+xml'), 'SVG を保存しました。')}>SVG を保存</button>
              </>
            )}
            {msg && <p className="info">{msg}</p>}
          </div>
          <div className="col" ref={pane}>
            {mode === 'pdf' ? (
              <iframe className="preview pages" title="PDF のプレビュー" srcDoc={html} />
            ) : (
              <div className={`preview ${background ? '' : 'checker'}`} dangerouslySetInnerHTML={{ __html: image.svg.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="100%"') }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
