import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Paper, type PdfPart, boardImage, bookletHtml, pdfHtml, pngScale, toPng, zipFiles } from '../export/exporters';
import { TABLES, type Table, compact, toCsv } from '../model/lists';
import { KINDS, type ListKey, kindOf } from '../model/kinds';
import { toYaml } from '../model/dsl';
import { saveBoardFile } from './TopBar';
import { sheetTables } from '../export/sheets';
import { subset } from '../model/geometry';
import { loadBoards, useStore } from '../model/store';
import { withoutComments } from '../model/comments';
import type { Doc } from '../model/types';
import { labelOf } from '../model/history';
import { useProjectTabs } from './BoardTabs';
import { inlineImages, safeName } from '../platform/storage';
import { copyPng, getSetting, pickFile, printPage, saveFile, setSetting } from '../platform/io';

/** Save a file; what to say when the user called the save off (nothing when it was saved). */
const download = async (name: string, data: Blob | string, type?: string): Promise<string | undefined> => ((await saveFile(name, data, type)) ? undefined : '保存をやめました。');

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
/** Every list there is, in the order they come in a document. */
const LIST_ORDER: ListKey[] = ['equipment', 'cables', 'summary', 'power', 'network', 'comms'];

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
  // Until the pictures are in, a picture made now would leave them out.
  const picturesReady = inlined?.from === board || !board.nodes.some((n) => n.type === 'image' && n.src.startsWith('asset:'));
  // Pictures that could not be read from the board's folder (a file gone missing).
  const missing = picturesReady ? whole.nodes.filter((n) => n.type === 'image' && n.src.startsWith('asset:')).length : 0;
  // The whole project at once: every board of it, in the order of its tabs.
  const tabs = useProjectTabs();
  const others = useStore((s) => s.others);
  const project = board.meta.project?.trim() ?? '';
  const [scopeState, setScopeState] = useState<'board' | 'project'>(() => (getSetting('exportScope') === 'project' ? 'project' : 'board'));
  const all = scopeState === 'project' && tabs.length > 1;
  const setScope = (v: 'board' | 'project') => {
    setScopeState(v);
    setSetting('exportScope', v);
  };
  const order = tabs.map((t) => t.id).join();
  // An older state on screen exports under its own name or time.
  const version = useStore((s) => (s.viewing ? labelOf(s.viewing.entry) : undefined));
  const [loaded, setLoaded] = useState<{ order: string; docs: Doc[] }>({ order: '', docs: [] });
  const boards = loaded.docs;
  useEffect(() => {
    if (!all) return;
    let live = true;
    const ids = order.split(',');
    // The project's boards as last read; any not read yet (just made, or read moments ago) from storage.
    const missing = ids.filter((id) => id !== board.id && !others.some((o) => o.id === id));
    void loadBoards(missing).then(async (fresh) => {
      const docs = ids
        .map((id) => (id === board.id ? board : (others.find((o) => o.id === id) ?? fresh.find((d) => d.id === id))))
        .filter((d): d is Doc => !!d && (d.id === board.id || (d.meta.project ?? '').trim() === project));
      const inlined = await Promise.all(docs.map(inlineImages));
      if (live) setLoaded({ order, docs: inlined });
    });
    return () => {
      live = false;
    };
  }, [all, order, board, others, project]);
  // With something selected, the export can be just that part of the board.
  const selection = useStore((s) => s.selection);
  const [onlySelected, setOnlySelected] = useState(() => selection.length > 0);
  const partial = !all && onlySelected && selection.length > 0;
  const doc = useMemo(() => (partial ? subset(whole, selection) : whole), [whole, partial, selection]);
  // The lists come from the board's kind: the sheets of the workbook (and CSV) are all of them,
  // the PDF takes them all but the check list.
  const kind = kindOf(board);
  const SHEETS = kind.lists;
  // For the whole project, the lists of every kind of board in it.
  const LISTS: ListKey[] = all ? LIST_ORDER.filter((k) => boards.some((d) => kindOf(d).lists.includes(k))) : SHEETS.filter((k) => k !== 'check');
  const withLists = boards.filter((d) => kindOf(d).lists.length > 0);
  const modes = MODES.filter((m) => m.key !== 'table' || (all ? withLists.length > 0 : SHEETS.length > 0));
  // The tab used last comes back, so a board exported the same way each time takes one click.
  const [chosenMode, setModeState] = useState<Mode>(() => (MODES.find((m) => m.key === getSetting('exportMode'))?.key ?? 'pdf'));
  const mode: Mode = modes.some((m) => m.key === chosenMode) ? chosenMode : 'pdf';
  const setMode = (m: Mode) => {
    setModeState(m);
    setSetting('exportMode', m);
    // What was said of the last export belongs to its own tab.
    setMsg('');
  };
  // The sheet on show in the preview, as in Excel's tabs; CSV saves that one.
  const [sheetKey, setSheetKey] = useState<string>(() => getSetting('csvList') || 'equipment');
  const sheet = Math.max(0, SHEETS.indexOf(sheetKey as ListKey));
  const setSheet = (i: number) => {
    setSheetKey(SHEETS[i]);
    setSetting('csvList', SHEETS[i]);
  };
  const sheets = useMemo(() => (mode === 'table' ? sheetTables(doc) : []), [doc, mode]);
  // The CSV is the sheet shown beside it, as the workbook has it.
  const csvTable = sheets[sheet] ?? null;
  const yaml = useMemo(() => (mode === 'data' ? toYaml(whole) : ''), [mode, whole]);
  const [paper, setPaper] = useState<Paper>(() => (getSetting('pdfPaper') === 'A3' ? 'A3' : 'A4'));
  const [lists, setLists] = useState<ListKey[]>(() => {
    const saved = getSetting('pdfLists');
    return saved ? (saved.split(',') as ListKey[]) : ['equipment', 'cables', 'comms'];
  });
  const [background, setBackground] = useState(true);
  // Comments (stickies) are notes about the drawing, not part of it: left out unless asked for.
  const [withComments, setWithComments] = useState(() => getSetting('exportComments') === 'on');
  const drawn = (d: Doc): Doc => (withComments ? d : withoutComments(d));
  const commentToggle = (
    <label className="check">
      <input
        type="checkbox"
        checked={withComments}
        onChange={(e) => {
          setWithComments(e.target.checked);
          setSetting('exportComments', e.target.checked ? 'on' : '');
        }}
      />
      付箋（コメント）も書き出す
    </label>
  );
  const [scale, setScale] = useState(2);
  const [msg, setMsg] = useState('');

  const tables = useMemo(() => new Map<ListKey, Table>(LISTS.map((k) => [k, compact(TABLES[k].make(doc))])), [doc, LISTS.join()]);
  const chosen = LISTS.filter((k) => lists.includes(k) && tables.get(k)?.rows.length).map((k) => tables.get(k)!);
  // Each board of the project with the chosen lists its kind has, those with rows.
  const parts: PdfPart[] = useMemo(
    () =>
      all
        ? boards.map((d) => ({
            doc: drawn(d),
            tables: LIST_ORDER.filter((k) => lists.includes(k) && kindOf(d).lists.includes(k))
              .map((k) => compact(TABLES[k].make(d)))
              .filter((t) => t.rows.length),
            version: d.id === board.id ? version : undefined,
          }))
        : [],
    [all, boards, lists.join(), board.id, version, withComments],
  );
  const rowsIn = (t: Table) => t.rows.length - (t.total ? 1 : 0);
  // How many rows a list has on this board, or over all the project's boards.
  const countOf = (k: ListKey): number => (all ? boards.filter((d) => kindOf(d).lists.includes(k)).reduce((n, d) => n + rowsIn(compact(TABLES[k].make(d))), 0) : rowsIn(tables.get(k)!));
  const image = useMemo(() => boardImage(drawn(doc), background), [doc, background, withComments]);
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
  const html = useMemo(
    () => (all ? bookletHtml(project, parts, paper, zoom) : pdfHtml(drawn(doc), { paper, version, tables: chosen }, zoom)),
    [all, parts, project, doc, paper, version, zoom, chosen.map((t) => t.title).join(), withComments],
  );
  const pack = `${safeName(project)}_まとめて`;
  const images = useMemo(() => (all && mode === 'image' ? boards.map((d) => ({ doc: d, image: boardImage(drawn(d), background) })) : []), [all, mode, boards, background, withComments]);

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
    // Choices on other kinds of board are kept as they were.
    const next = [...lists.filter((k) => !LISTS.includes(k)), ...LISTS.filter((k) => (k === key ? on : lists.includes(k)))];
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
            {tabs.length > 1 && (
              <div className="seg">
                <button className={all ? '' : 'on'} onClick={() => setScope('board')}>
                  このボード
                </button>
                <button className={all ? 'on' : ''} onClick={() => setScope('project')} data-tip={`「${project}」のボードすべてを 1 回で`}>
                  案件まるごと（{all && loaded.order === order ? boards.length : tabs.length} 枚）
                </button>
              </div>
            )}
            <div className="seg wrap">
              {modes.map((m) => (
                <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            {mode !== 'data' && !all && (
              <label className="check">
                <input type="checkbox" checked={partial} disabled={!selection.length} onChange={(e) => setOnlySelected(e.target.checked)} />
                選択した要素だけ{selection.length ? `（${selection.length} 個）` : '（何も選択されていません）'}
              </label>
            )}
            {partial && mode !== 'data' && <p className="hint">エリア枠を選ぶと中の要素も入ります。両端が入っている線は自動で付き、リストも選択した範囲から作ります。</p>}
            {all && loaded.order !== order ? (
              <p className="hint">ボードを読み込み中…</p>
            ) : all && mode === 'table' ? (
              <>
                <h4>Excel（.xlsx）をまとめて</h4>
                <p className="hint">表のあるボード（{withLists.map((d) => d.meta.title).join('・')}）ごとに 1 ファイル、それを 1 つの ZIP にします。中身は 1 枚ずつ書き出すときと同じです。</p>
                <button
                  className="primary wide"
                  onClick={run(async () => {
                    const { workbook } = await import('../export/xlsx');
                    const files = await Promise.all(withLists.map(async (d) => ({ name: `${safeName(d.meta.title)}_${kindOf(d).listsLabel}.xlsx`, data: await workbook(d) })));
                    return download(`${pack}_表.zip`, await zipFiles(files));
                  }, 'ZIP を保存しました。')}
                >
                  Excel をまとめて保存（ZIP）
                </button>
              </>
            ) : all && mode === 'data' ? (
              <>
                <h4>keito ファイルをまとめて</h4>
                <p className="hint">案件のボードすべてを、画像込みの .keito.json で 1 つの ZIP に。バックアップや受け渡しに。</p>
                <button className="primary wide" onClick={run(async () => download(`${pack}_keito.zip`, await zipFiles(boards.map((d) => ({ name: `${safeName(d.meta.title)}.keito.json`, data: JSON.stringify(d, null, 2) })))), 'ZIP を保存しました。')}>
                  keito ファイルをまとめて保存（ZIP）
                </button>
                <h4>YAML をまとめて</h4>
                <button className="wide" onClick={run(async () => download(`${pack}_yaml.zip`, await zipFiles(boards.map((d) => ({ name: `${safeName(d.meta.title)}.yaml`, data: toYaml(d) })))), 'ZIP を保存しました。')}>
                  YAML をまとめて保存（ZIP）
                </button>
              </>
            ) : all && mode === 'image' ? (
              <>
                {commentToggle}
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
                <p className="hint">ボードごとに 1 枚、それを 1 つの ZIP にします。</p>
                <button className="primary wide" onClick={run(async () => download(`${pack}_PNG.zip`, await zipFiles(await Promise.all(images.map(async (x) => ({ name: `${safeName(x.doc.meta.title)}.png`, data: await toPng(x.image, scale) }))))), 'ZIP を保存しました。')}>
                  PNG をまとめて保存（ZIP）
                </button>
                <button className="wide" onClick={run(async () => download(`${pack}_SVG.zip`, await zipFiles(images.map((x) => ({ name: `${safeName(x.doc.meta.title)}.svg`, data: x.image.svg })))), 'ZIP を保存しました。')}>
                  SVG をまとめて保存（ZIP）
                </button>
              </>
            ) : mode === 'table' ? (
              <>
                <h4>Excel（.xlsx）</h4>
                <p className="hint">すべての表を 1 ファイルに、表ごとのシートで。見出し固定・フィルター・プルダウン付きで、Google スプレッドシートでも開けます。</p>
                <button className="primary wide" onClick={run(async () => download(`${name}_${kind.listsLabel}.xlsx`, await (await import('../export/xlsx')).workbook(doc)), 'Excel ファイルを保存しました。')}>
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
                    const off = await download(file.name, blob);
                    if (off) return off;
                    const parts = [`追加 ${report.added} 行`, `変更 ${report.changed} 行`, `削除 ${report.removed} 行`];
                    const kept = [report.extra.length && `Excel で足した列（${report.extra.join('・')}）`, report.manual && `手入力の行 ${report.manual} 行`, report.sheets.length && `足したシート（${report.sheets.join('・')}）`].filter(Boolean);
                    return `「${file.name}」を更新して保存しました（${parts.join('・')}）。${kept.length ? `${kept.join('、')}と` : ''}購入ステータスはそのまま引き継いでいます。`;
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
                <button className="wide" disabled={!csvTable} onClick={run(async () => (csvTable ? download(`${name}_${csvTable.title}.csv`, toCsv(csvTable), 'text/csv') : undefined), 'CSV を保存しました。')}>
                  「{csvTable?.title}」を CSV で保存
                </button>
              </>
            ) : mode === 'data' ? (
              <>
                <h4>keito ファイル（.keito.json）</h4>
                <p className="hint">画像も含めたボードまるごと。ほかの PC の keito で「開く」と元どおりに編集できます。バックアップや受け渡しに。⌘S でも保存できます。</p>
                <button className="primary wide" onClick={run(() => saveBoardFile(), 'keito ファイルを保存しました。')}>
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
                {commentToggle}
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
                <p className="hint">{all ? 'ボードごとに、図のページのあとにそのボードのリストが続きます（タブの順）。' : '1 ページ目に図、そのあとに選んだリストが付きます。'}</p>
                {LISTS.map((k) => {
                  const count = countOf(k);
                  return (
                    <label key={k} className="check">
                      <input type="checkbox" checked={lists.includes(k)} disabled={!count} onChange={(e) => toggle(k, e.target.checked)} />
                      {TABLES[k].label} <small>{count ? `${count} 行` : 'なし'}</small>
                    </label>
                  );
                })}
                <p className="hint">
                  何も書かれていない列（URL や備考など）は出しません。長いリストは自動で改ページされ、見出し行が各ページに付きます。見出しの右には案件名と今日の日付（履歴の版を開いているときはその版の名前か日時）が入ります。
                </p>
                <button
                  className="primary wide"
                  onClick={run(() => printPage(all ? bookletHtml(project, parts, paper) : pdfHtml(drawn(doc), { paper, version, tables: chosen })), '')}
                >
                  {all ? `${boards.length} 枚まとめて PDF にする（${paper} 横）` : `PDF にする（${paper} 横）`}
                </button>
              </>
            ) : (
              <>
                {commentToggle}
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
                {pngScale(image, scale) < scale && <p className="hint">図が大きいため、{Math.floor(pngScale(image, scale) * 10) / 10}x で書き出します（ブラウザで作れる画像の大きさの上限）。</p>}
                {!picturesReady && <p className="hint">画像を読み込み中…</p>}
                {missing > 0 && <p className="error">画像 {missing} 枚がボードのフォルダから読めず、書き出しに入りません。</p>}
                <button className="wide" disabled={!picturesReady} onClick={run(async () => download(`${name}.png`, await toPng(image, scale)), 'PNG を保存しました。')}>PNG を保存</button>
                <button className="wide" disabled={!picturesReady} onClick={run(() => copyPng(toPng(image, scale)), 'クリップボードにコピーしました。スライドにそのまま貼れます。')}>PNG をコピー</button>
                <button className="wide" disabled={!picturesReady} onClick={run(() => download(`${name}.svg`, image.svg, 'image/svg+xml'), 'SVG を保存しました。')}>SVG を保存</button>
              </>
            )}
            {msg && <p className="info">{msg}</p>}
          </div>
          <div className="col" ref={pane}>
            {all && (mode === 'table' || mode === 'data') ? (
              <ul className="preview bundle-list">
                {(mode === 'table' ? withLists : boards).map((d) => (
                  <li key={d.id}>
                    <b className={`kind-badge ${d.kind ?? 'system'}`}>{KINDS[d.kind ?? 'system'].label}</b>
                    {d.meta.title}
                    <small>{mode === 'table' ? kindOf(d).lists.map((k) => TABLES[k].label).join('・') : `${d.nodes.length} 要素`}</small>
                  </li>
                ))}
              </ul>
            ) : all && mode === 'image' ? (
              <div className={`preview bundle-images ${background ? '' : 'checker'}`}>
                {images.map((x) => (
                  <figure key={x.doc.id}>
                    <div dangerouslySetInnerHTML={{ __html: x.image.svg.replace(/width="[\d.]+" height="[\d.]+"/, 'width="100%" height="100%"') }} />
                    <figcaption>{x.doc.meta.title}</figcaption>
                  </figure>
                ))}
              </div>
            ) : mode === 'table' ? (
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
