import { useState } from 'react';
import type { ReactNode } from 'react';
import type { MouseEvent as RMouseEvent } from 'react';
import { boxSize, insertImages, insertNode, placeDrag, viewCenter } from '../canvas/Canvas';
import { nodeSize, snap } from '../model/geometry';
import { COMMON, type CreateKind, PRESETS, type Preset, SOFTWARE, allIds, freshId, makeDevice, makeLegend } from '../model/presets';
import { kindOf } from '../model/kinds';
import type { DeviceNode, Node, Pt, UserPreset } from '../model/types';
import { type Tool, useStore } from '../model/store';
import { ask, getSetting, setSetting } from '../platform/io';
import { ICON, ico, shapeIcon } from './icons';


const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'select', label: '選択', key: 'V', icon: ico(<path d="M5 3l10 6-4.5 1.2L8.8 15z" />) },
  { tool: 'pan', label: '画面を動かす', key: 'H', icon: ICON.hand },
  { tool: 'rect', label: '四角', key: 'R', icon: shapeIcon('rect') },
  { tool: 'round', label: '端子', key: 'E', icon: shapeIcon('round') },
  { tool: 'diamond', label: '判断', key: 'D', icon: shapeIcon('diamond') },
  { tool: 'ellipse', label: '楕円', key: 'O', icon: shapeIcon('ellipse') },
  { tool: 'cloud', label: '雲', key: 'C', icon: shapeIcon('cloud') },
  { tool: 'sticky', label: '付箋（コメント）', key: 'S', icon: ico(<path d="M4 4h12v8l-4 4H4zM16 12h-4v4" />) },
  { tool: 'text', label: 'テキスト', key: 'T', icon: ico(<path d="M5 5h10M10 5v10" />) },
  { tool: 'frame', label: 'エリア枠', key: 'F', icon: ico(<rect x="3" y="4" width="14" height="12" rx="1" strokeDasharray="3 2" />) },
  { tool: 'sequence', label: 'シーケンス図', key: 'Q', icon: ico(<path d="M5 3v14M15 3v14M5 7h10m-2-2l2 2-2 2M15 13H5m2-2l-2 2 2 2" />) },
];
export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

/**
 * Props for a library button: dragged onto the board, its thing goes where it is let go; clicked,
 * it waits under the pointer to be put where the board is clicked (Enter on the button does the same).
 */
function placeable(label: string, sample: () => Node, add: (at: Pt) => void) {
  const make = () => ({ label, size: nodeSize(sample()), place: add });
  return {
    onPointerDown: placeDrag(make),
    onClick: (e: RMouseEvent) => {
      if (e.detail === 0) useStore.getState().setPlacing(make());
    },
  };
}

function deviceOf(p: Preset | UserPreset, x: number, y: number, taken: Set<string>): DeviceNode {
  // One of the user's own presets comes back exactly as it was saved.
  return 'key' in p
    ? makeDevice(p, x, y, taken)
    : { id: freshId(taken, 'dev'), type: 'device', x, y, h: 0, w: p.w, text: p.name, maker: p.maker, model: p.model, category: p.category, note: p.note, ports: p.ports.map((q) => ({ ...q })), watts: p.watts, capacity: p.capacity, url: p.url, color: p.color };
}

const deviceProps = (p: Preset | UserPreset) => placeable(p.name, () => deviceOf(p, 0, 0, new Set()), (at) => addDevice(p, at));

function addDevice(p: Preset | UserPreset, at?: Pt) {
  const s = useStore.getState();
  const size = nodeSize(deviceOf(p, 0, 0, new Set()));
  const c = at ?? viewCenter();
  let x = snap(c.x - size.w / 2);
  const y = snap(c.y - size.h / 2);
  // Without a spot given: step sideways until the spot is free so repeated adds don't stack.
  if (!at) while (s.doc.nodes.some((n) => Math.abs(n.x - x) < 20 && Math.abs(n.y - y) < 20)) x += 220;
  const d = deviceOf(p, x, y, allIds(s.doc));
  s.mutate((doc) => ({ ...doc, nodes: [...doc.nodes, d] }));
  s.select([d.id]);
  s.setTool('select');
}

function addLegend(at?: Pt) {
  const s = useStore.getState();
  const c = at ?? viewCenter();
  const n = makeLegend(allIds(s.doc), snap(c.x - 100), snap(c.y - 40));
  s.mutate((doc) => ({ ...doc, nodes: [...doc.nodes, n] }));
  s.select([n.id]);
}

function pickImages() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.svg';
  input.multiple = true;
  input.onchange = () => void insertImages([...(input.files ?? [])]);
  input.click();
}

const MINE = 'マイプリセット';

function Library() {
  const kind = kindOf(useStore((s) => s.doc));
  // A software board takes pieces of software, all shown; a system board its gear, the common ones first.
  const software = kind.library?.set === 'software';
  const source = software ? SOFTWARE : PRESETS;
  const blankKey = software ? 'swblank' : 'blank';
  const [q, setQ] = useState('');
  // Categories start folded; the opened ones are remembered, and a search opens everything.
  const [opened, setOpened] = useState<string[]>(() => {
    try {
      const v: unknown = JSON.parse(getSetting('libraryOpen') || '[]');
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  });
  const fold = (next: string[]) => {
    setOpened(next);
    setSetting('libraryOpen', JSON.stringify(next));
  };
  // The common gear only, unless asked for everything; a search always looks through everything.
  const [every, setEvery] = useState(() => getSetting('libraryAll') === '1');
  const showAll = (on: boolean) => {
    setEvery(on);
    setSetting('libraryAll', on ? '1' : '');
  };
  const hit = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());
  const list = source.filter((p) => p.key !== blankKey && (q || every || software || COMMON.has(p.key)) && hit(`${p.name}${p.category}${p.key}`));
  const blank = source.find((p) => p.key === blankKey)!;
  const cats = [...new Set(list.map((p) => p.category || 'その他'))];
  // The user's own presets of this library's kind: their gear on a system board, their software on a software board.
  const mine = useStore((s) => s.presets).filter((p) => !!p.software === software && hit(`${p.name}${p.category}${p.maker}${p.model}`));
  const all = [...(mine.length ? [MINE] : []), ...cats];
  const allClosed = !all.some((c) => opened.includes(c));
  const section = (name: string, count: number, body: () => ReactNode) => {
    const open = !!q || opened.includes(name);
    return (
      <div key={name} className="library-cat">
        <button
          className="library-head"
          aria-expanded={open}
          disabled={!!q}
          onClick={() => fold(open ? opened.filter((c) => c !== name) : [...opened, name])}
        >
          <span className={open ? 'chev open' : 'chev'}>▸</span>
          <span className="name">{name}</span>
          <small>{count}</small>
        </button>
        {open && body()}
      </div>
    );
  };
  return (
    <div className="library">
      <div className="library-top">
        <input autoFocus placeholder={kind.library?.search ?? '検索…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          className="mini"
          disabled={!!q}
          data-tip={allClosed ? 'すべてのカテゴリを開く' : 'すべてのカテゴリをしまう'}
          onClick={() => fold(allClosed ? all : [])}
        >
          {allClosed ? '開く' : 'しまう'}
        </button>
      </div>
      <button className="library-blank" data-tip={`名前もポートも自分で決める、まっさらな${kind.library?.label ?? '機材'}を置きます`} {...deviceProps(blank)}>
        ＋ 空の{kind.library?.label ?? '機材'}を置く
      </button>
      <div className="library-list">
        {mine.length > 0 &&
          section(MINE, mine.length, () =>
            mine.map((p) => (
              <div key={p.id} className="my-preset">
                <button className="item" {...deviceProps(p)}>
                  <span className="label">
                    <span>{p.name}</span>
                    {(p.maker || p.model) && <small>{[p.maker, p.model].filter(Boolean).join(' ')}</small>}
                  </span>
                  <small>
                    {p.ports.filter((x) => x.side === 'left').length}in / {p.ports.filter((x) => x.side === 'right').length}out
                  </small>
                </button>
                <button
                  className="mini remove"
                  data-tip="このプリセットを消す"
                  onClick={() => {
                    void ask(`プリセット「${p.name}」を消しますか？ ボード上の機材は変わりません。`).then((yes) => yes && useStore.getState().deletePreset(p.id));
                  }}
                >
                  ×
                </button>
              </div>
            )),
          )}
        {cats.map((c) => {
          const items = list.filter((p) => (p.category || 'その他') === c);
          return section(c, items.length, () =>
            items.map((p) => (
              <button key={p.key} className="item" {...deviceProps(p)}>
                <span className="label">{p.name}</span>
                <small>
                  {p.in.length}in / {p.out.length}out
                </small>
              </button>
            )),
          );
        })}
        {all.length === 0 && <p className="library-empty">該当する{kind.library?.label ?? '機材'}がありません</p>}
        {software ? null : q ? (
          <p className="library-note">検索はすべての機材（{PRESETS.length - 1} 種）から探します</p>
        ) : (
          <button className="library-more" onClick={() => showAll(!every)}>
            {every ? 'よく使う機材だけ表示する' : `すべての機材を表示する（${PRESETS.length - 1} 種）`}
          </button>
        )}
      </div>
    </div>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const panel = useStore((s) => s.panel);
  const kind = kindOf(useStore((s) => s.doc));
  const st = useStore.getState;
  return (
    <>
      <nav className="toolbar">
        {TOOLS.filter((t) => kind.tools.includes(t.tool)).map((t) => (
          <button
            key={t.tool}
            className={tool === t.tool ? 'on' : ''}
            data-tip={`${t.label}（${t.key}）`}
            aria-label={t.label}
            // Select and pan switch at once. A box tool is armed, to put a box where the board is clicked
            // (or drawn out to a size); dragged onto the board, the box goes where it is let go.
            {...(t.tool === 'select' || t.tool === 'pan'
              ? { onClick: () => st().setTool(t.tool) }
              : {
                  onPointerDown: placeDrag(
                    () => ({ label: t.label, size: boxSize(t.tool as CreateKind) ?? { w: 40, h: 40 }, place: (at) => insertNode(t.tool as CreateKind, at) }),
                    () => st().setTool(tool === t.tool ? 'select' : t.tool),
                  ),
                  onClick: (e: RMouseEvent) => {
                    if (e.detail === 0) st().setTool(tool === t.tool ? 'select' : t.tool);
                  },
                })}
          >
            {t.icon}
          </button>
        ))}
        <button data-tip="画像・SVG（ドロップや貼り付けでも可）" aria-label="画像・SVG を埋め込む" onClick={pickImages}>
          {ico(<path d="M3 4h14v12H3zM3 13l4-4 3 3 3-4 4 5M7 7.5h.01" />)}
        </button>
        {kind.library && (
          <button data-tip="凡例（使っている線の色の一覧。色を変えると追従します）" aria-label="凡例を置く" {...placeable('凡例', () => makeLegend(new Set(), 0, 0), (at) => addLegend(at))}>
            {ico(<path d="M3 6h5M3 10h5M3 14h5M11 6h6M11 10h6M11 14h4" />)}
          </button>
        )}
        {kind.library && (
          <>
            <hr />
            <button className={panel === 'library' ? 'on' : ''} data-tip={`${kind.library.label}ライブラリ（L）`} aria-label={`${kind.library.label}ライブラリ`} onClick={() => st().setPanel(panel === 'library' ? null : 'library')}>
              {ico(<path d="M3 6h14v8H3zM6 6V4m8 2V4M6 10h2m2 0h4" />)}
              <span>{kind.library.label}</span>
            </button>
          </>
        )}
      </nav>
      {panel === 'library' && kind.library && <Library />}
    </>
  );
}
