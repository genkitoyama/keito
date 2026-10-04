import { useState } from 'react';
import type { ReactNode } from 'react';
import { insertImages, insertNode, viewCenter } from '../canvas/Canvas';
import { snap } from '../model/geometry';
import { PRESETS, type Preset, allIds, makeDevice } from '../model/presets';
import { type Tool, useStore } from '../model/store';
import { ICON, ico, shapeIcon } from './icons';


const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'select', label: '選択', key: 'V', icon: ico(<path d="M5 3l10 6-4.5 1.2L8.8 15z" />) },
  { tool: 'pan', label: '画面を動かす', key: 'H', icon: ICON.hand },
  { tool: 'rect', label: '四角', key: 'R', icon: shapeIcon('rect') },
  { tool: 'round', label: '端子', key: 'E', icon: shapeIcon('round') },
  { tool: 'diamond', label: '判断', key: 'D', icon: shapeIcon('diamond') },
  { tool: 'ellipse', label: '楕円', key: 'O', icon: shapeIcon('ellipse') },
  { tool: 'cloud', label: '雲（コメント）', key: 'C', icon: shapeIcon('cloud') },
  { tool: 'sticky', label: '付箋', key: 'S', icon: ico(<path d="M4 4h12v8l-4 4H4zM16 12h-4v4" />) },
  { tool: 'text', label: 'テキスト', key: 'T', icon: ico(<path d="M5 5h10M10 5v10" />) },
  { tool: 'frame', label: 'エリア枠', key: 'F', icon: ico(<rect x="3" y="4" width="14" height="12" rx="1" strokeDasharray="3 2" />) },
  { tool: 'sequence', label: 'シーケンス図', key: 'Q', icon: ico(<path d="M5 3v14M15 3v14M5 7h10m-2-2l2 2-2 2M15 13H5m2-2l-2 2 2 2" />) },
];
export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

function addDevice(p: Preset) {
  const s = useStore.getState();
  const c = viewCenter();
  // Step sideways until the spot is free so repeated clicks don't stack.
  let x = snap(c.x - 90);
  const y = snap(c.y - 60);
  while (s.doc.nodes.some((n) => Math.abs(n.x - x) < 20 && Math.abs(n.y - y) < 20)) x += 220;
  const d = makeDevice(p, x, y, allIds(s.doc));
  s.mutate((doc) => ({ ...doc, nodes: [...doc.nodes, d] }));
  s.select([d.id]);
  s.setTool('select');
}

function pickImages() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.svg';
  input.multiple = true;
  input.onchange = () => void insertImages([...(input.files ?? [])]);
  input.click();
}

function Library() {
  const [q, setQ] = useState('');
  const list = PRESETS.filter((p) => !q || `${p.name}${p.category}${p.key}`.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(list.map((p) => p.category || 'その他'))];
  return (
    <div className="library">
      <input autoFocus placeholder="機材を検索…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="library-list">
        {cats.map((c) => (
          <div key={c}>
            <h4>{c}</h4>
            {list
              .filter((p) => (p.category || 'その他') === c)
              .map((p) => (
                <button key={p.key} onClick={() => addDevice(p)}>
                  {p.name}
                  <small>{p.in.length}in / {p.out.length}out</small>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const panel = useStore((s) => s.panel);
  const st = useStore.getState;
  return (
    <>
      <nav className="toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={tool === t.tool ? 'on' : ''}
            data-tip={`${t.label}（${t.key}）`}
            aria-label={t.label}
            // Clicking drops the shape straight onto the board, ready to type; the key arms the tool for click-to-place.
            onClick={() => (t.tool === 'select' || t.tool === 'pan' ? st().setTool(t.tool) : insertNode(t.tool))}
          >
            {t.icon}
          </button>
        ))}
        <button data-tip="画像・SVG（ドロップや貼り付けでも可）" aria-label="画像・SVG を埋め込む" onClick={pickImages}>
          {ico(<path d="M3 4h14v12H3zM3 13l4-4 3 3 3-4 4 5M7 7.5h.01" />)}
        </button>
        <hr />
        <button className={panel === 'library' ? 'on' : ''} data-tip="機材ライブラリ（L）" aria-label="機材ライブラリ" onClick={() => st().setPanel(panel === 'library' ? null : 'library')}>
          {ico(<path d="M3 6h14v8H3zM6 6V4m8 2V4M6 10h2m2 0h4" />)}
          <span>機材</span>
        </button>
      </nav>
      {panel === 'library' && <Library />}
    </>
  );
}
