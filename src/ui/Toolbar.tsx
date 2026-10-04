import { useState } from 'react';
import type { ReactNode } from 'react';
import { insertImages, insertNode, viewCenter } from '../canvas/Canvas';
import { snap } from '../model/geometry';
import { PRESETS, type Preset, allIds, makeDevice } from '../model/presets';
import { type Tool, useStore } from '../model/store';

const ico = (d: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'select', label: '選択', key: 'V', icon: ico(<path d="M5 3l10 6-4.5 1.2L8.8 15z" />) },
  { tool: 'pan', label: 'パン', key: 'H', icon: ico(<path d="M10 3v14M3 10h14M10 3l-2 2m2-2l2 2M10 17l-2-2m2 2l2-2M3 10l2-2m-2 2l2 2M17 10l-2-2m2 2l-2 2" />) },
  { tool: 'rect', label: '四角', key: 'R', icon: ico(<rect x="3" y="5" width="14" height="10" rx="1.5" />) },
  { tool: 'round', label: '端子', key: 'E', icon: ico(<rect x="3" y="6" width="14" height="8" rx="4" />) },
  { tool: 'diamond', label: '判断', key: 'D', icon: ico(<path d="M10 3l7 7-7 7-7-7z" />) },
  { tool: 'ellipse', label: '楕円', key: 'O', icon: ico(<ellipse cx="10" cy="10" rx="7" ry="5" />) },
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
            title={`${t.label} (${t.key})`}
            // Clicking drops the shape straight onto the board, ready to type; the key arms the tool for click-to-place.
            onClick={() => (t.tool === 'select' || t.tool === 'pan' ? st().setTool(t.tool) : insertNode(t.tool))}
          >
            {t.icon}
          </button>
        ))}
        <button title="画像・SVG を埋め込む（ドラッグ＆ドロップ、貼り付けでも可）" onClick={pickImages}>
          {ico(<path d="M3 4h14v12H3zM3 13l4-4 3 3 3-4 4 5M7 7.5h.01" />)}
        </button>
        <hr />
        <button className={panel === 'library' ? 'on' : ''} title="機材ライブラリ (L)" onClick={() => st().setPanel(panel === 'library' ? null : 'library')}>
          {ico(<path d="M3 6h14v8H3zM6 6V4m8 2V4M6 10h2m2 0h4" />)}
          <span>機材</span>
        </button>
      </nav>
      {panel === 'library' && <Library />}
    </>
  );
}
