import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Paper, boardImage, copyPng, pdfHtml, printHtml, toPng } from '../export/exporters';
import { type Table, cableSummaryTable, cableTable, checkTable, compact, equipmentTable, networkTable, powerTable, toCsv } from '../model/lists';
import { toYaml } from '../model/dsl';
import { saveFile } from './TopBar';
import { sheetTables } from '../export/xlsx';
import { subset } from '../model/geometry';
import { useStore } from '../model/store';
import type { Doc } from '../model/types';
import { labelOf } from '../model/history';
import { download, getSetting, inlineImages, pickFile, safeName, setSetting } from '../platform/storage';

const LISTS = [
  { key: 'equipment', label: '機材リスト', make: equipmentTable },
  { key: 'cables', label: 'ケーブルリスト', make: cableTable },
  { key: 'summary', label: 'ケーブル集計', make: cableSummaryTable },
  { key: 'power', label: '電源系統', make: powerTable },
  { key: 'network', label: 'ネットワーク', make: networkTable },
] as const;
type ListKey = (typeof LISTS)[number]['key'];
/** The workbook's sheets, by the key each is remembered under; one of them is what CSV saves. */
const SHEETS = [...LISTS, { key: 'check', label: 'チェック', make: checkTable }] as const;
type Mode = 'pdf' | 'image' | 'table' | 'data';
const MODES: { key: Mode; label: string }[] = [
  { key: 'pdf', label: 'PDF' },
  { key: 'image', label: '画像' },
  { key: 'table', label: '表（Excel / CSV）' },
  { key: 'data', label: 'データ' },
];

/** Open the export window on one of its tabs (the lists panel sends people to the tables). */
export function openExport(mode: Mode): void {
  setSetting('exportMode', mode);
  useStore.getState().setPanel('export');
}
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
  const whole = inlined?.from === board ? inlined.doc : board;
  // With something selected, the export can be just that part of the board.
  const selection = useStore((s) => s.selection);
  const [onlySelected, setOnlySelected] = useState(() => selection.length > 0);
  const partial = onlySelected && selection.length > 0;
  const doc = useMemo(() => (partial ? subset(whole, selection) : whole), [whole, partial, selection]);
  // The tab used last comes back, so a board exported the same way each time takes one click.
  const [mode, setModeState] = useState<Mode>(() => (MODES.find((m) => m.key === getSetting('exportMode'))?.key ?? 'pdf'));
  const setMode = (m: Mode) => {
    setModeState(m);
    setSetting('exportMode', m);
  };
  // The sheet on show in the preview, as in Excel's tabs; CSV saves that one.
  const [sheet, setSheetState] = useState<number>(() => Math.max(0, SHEETS.findIndex((l) => l.key === getSetting('csvList'))));
  const setSheet = (i: number) => {
    setSheetState(i);
    setSetting('csvList', SHEETS[i].key);
  };
  const sheets = useMemo(() => (mode === 'table' ? sheetTables(doc) : []), [doc, mode]);
  const csvTable = useMemo(() => SHEETS[sheet].make(doc), [doc, sheet]);
  const yaml = useMemo(() => (mode === 'data' ? toYaml(whole) : ''), [mode, whole]);
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
  const name = `${safeName(doc.meta.title)}${partial ? '_選択範囲' : ''}`;

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
  // An older state on screen exports under its own name or time.
  const version = useStore((s) => (s.viewing ? labelOf(s.viewing.entry) : undefined));
  const html = useMemo(() => pdfHtml(doc, { paper, version, tables: chosen }, zoom), [doc, paper, version, zoom, chosen.map((t) => t.title).join()]);

  // An action may report back in its own words (how many rows an update touched …).
  const run = (fn: () => Promise<string | void> | string | void, done: string) => async () => {
    try {
      const said = await fn();
      setMsg(said || done);
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
            <div className="seg wrap">
              {MODES.map((m) => (
                <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            {mode !== 'data' && (
              <label className="check">
                <input type="checkbox" checked={partial} disabled={!selection.length} onChange={(e) => setOnlySelected(e.target.checked)} />
                選択した要素だけ{selection.length ? `（${selection.length} 個）` : '（何も選択されていません）'}
              </label>
            )}
            {partial && mode !== 'data' && <p className="hint">エリア枠を選ぶと中の要素も入ります。両端が入っている線は自動で付き、リストも選択した範囲から作ります。</p>}
            {mode === 'table' ? (
              <>
                <h4>Excel（.xlsx）</h4>
                <p className="hint">すべての表を 1 ファイルに、表ごとのシートで。見出し固定・フィルター・プルダウン付きで、Google スプレッドシートでも開けます。</p>
                <button className="primary wide" onClick={run(async () => download(`${name}_機材ケーブル表.xlsx`, await (await import('../export/xlsx')).workbook(doc)), 'Excel ファイルを保存しました。')}>
                  Excel に書き出す
                </button>
                <button
                  className="wide"
                  disabled={partial}
                  onClick={run(async () => {
                    const file = await pickFile('.xlsx');
                    if (!file) return;
                    const { updateWorkbook } = await import('../export/xlsx');
                    const { blob, report } = await updateWorkbook(doc, await file.arrayBuffer());
                    download(file.name, blob);
                    const parts = [`追加 ${report.added} 行`, `変更 ${report.changed} 行`, `削除 ${report.removed} 行`];
                    return `「${file.name}」を更新して保存しました（${parts.join('・')}）。${report.extra.length ? `Excel で足した列（${report.extra.join('・')}）と` : ''}購入ステータスはそのまま引き継いでいます。`;
                  }, '')}
                >
                  前回の Excel を更新…
                </button>
                <p className="hint">
                  前に書き出した .xlsx を選ぶと、図の内容で書き直します。購入ステータスや Excel で足した列（発注日など）は行ごとに引き継ぎ、新しい行は緑、変わったセルは黄色（前の値はセルのメモ）、図から消えた行は「削除された行」シートに移します。
                  {partial && ' 選択した範囲だけのときは使えません（ほかの行が削除扱いになるため）。'}
                </p>
                <h4>CSV（1 つの表）</h4>
                <p className="hint">右のプレビューで開いているシートを保存します（下のタブで切り替え）。</p>
                <button className="wide" onClick={run(() => download(`${name}_${csvTable.title}.csv`, toCsv(csvTable), 'text/csv'), 'CSV を保存しました。')}>
                  「{SHEETS[sheet].label}」を CSV で保存
                </button>
              </>
            ) : mode === 'data' ? (
              <>
                <h4>keito ファイル（.keito.json）</h4>
                <p className="hint">画像も含めたボードまるごと。ほかの PC の keito で「開く」と元どおりに編集できます。バックアップや受け渡しに。⌘S でも保存できます。</p>
                <button className="primary wide" onClick={run(() => saveFile(), 'keito ファイルを保存しました。')}>
                  keito ファイルを保存
                </button>
                <h4>YAML（.yaml）</h4>
                <p className="hint">図をテキストにしたもの。AI に渡したり、版の違いを見比べたりするのに。画像は入りません。</p>
                <button className="wide" onClick={run(() => download(`${safeName(whole.meta.title)}.yaml`, yaml, 'text/yaml'), 'YAML を保存しました。')}>
                  YAML を保存
                </button>
                <p className="hint">データはいつもボード全体です（選択には関係しません）。</p>
              </>
            ) : mode === 'pdf' ? (
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
                  何も書かれていない列（URL や備考など）は出しません。長いリストは自動で改ページされ、見出し行が各ページに付きます。見出しの右には案件名と今日の日付（履歴の版を開いているときはその版の名前か日時）が入ります。
                </p>
                <button className="primary wide" onClick={run(() => printHtml(pdfHtml(doc, { paper, version, tables: chosen })), '印刷ダイアログで送信先を「PDF に保存」にしてください（用紙は横向きで出ます）。')}>
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
            {mode === 'table' ? (
              <WorkbookPreview sheets={sheets} at={sheet} onPick={setSheet} />
            ) : mode === 'data' ? (
              <pre className="preview code-preview">{yaml}</pre>
            ) : mode === 'pdf' ? (
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

/** The workbook as it will open: one sheet at a time, with its tabs along the bottom as in Excel. */
function WorkbookPreview({ sheets, at, onPick }: { sheets: Table[]; at: number; onPick: (i: number) => void }) {
  const t = sheets[at];
  if (!t) return null;
  const rows = t.rows.slice(0, 300);
  return (
    <div className="preview workbook">
      <div className="sheet">
        <table>
          <thead>
            <tr>
              {t.head.map((h) => (
                <th key={h} className={t.numeric?.includes(h) ? 'num' : ''}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={[t.total && i === t.rows.length - 1 ? 'total' : '', t.rowClass?.[i] ?? ''].filter(Boolean).join(' ')}>
                {row.map((c, j) => (
                  <td key={j} className={t.numeric?.includes(t.head[j]) ? 'num' : ''}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={t.head.length}>{t.empty ?? 'この表にはまだ何もありません。'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="sheet-tabs">
        {sheets.map((s, i) => (
          <button key={s.title} className={i === at ? 'on' : ''} onClick={() => onPick(i)}>
            {s.title}
            <small>{s.rows.length - (s.total ? 1 : 0) - (s.rowClass?.filter((c) => c?.startsWith('subtotal')).length ?? 0)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
