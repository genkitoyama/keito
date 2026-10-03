import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { Canvas, spawnFrom, zoomBy } from './canvas/Canvas';
import { copySelection, pasteClipboard, useStore } from './model/store';
import { ExportPanel } from './ui/ExportPanel';
import { Inspector } from './ui/Inspector';
import { ListsPanel } from './ui/ListsPanel';
import { TextPanel } from './ui/TextPanel';
import { TOOL_KEYS, Toolbar } from './ui/Toolbar';
import { TopBar, saveFile } from './ui/TopBar';

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.isComposing) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      // With a Japanese IME on, letter keys arrive as "Process" (keyCode 229);
      // recover the physical key so shortcuts keep working.
      const ime = e.keyCode === 229;
      const key = ime && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      const nodeIds = s.selection.filter((id) => s.doc.nodes.some((n) => n.id === id));
      // A single selected shape or connector takes text directly.
      const only = s.selection.length === 1 ? s.selection[0] : '';
      const editable = !!only && s.doc.nodes.find((n) => n.id === only)?.type !== 'sequence';
      // Typing with the IME on a selected shape starts editing: mount and focus the
      // editor synchronously and let this very keystroke flow into it.
      const typeToEdit = () => flushSync(() => s.setEditing(only));
      if (ime && !mod && editable) return typeToEdit();
      let handled = true;
      if (mod && key === 'z') e.shiftKey ? s.redo() : s.undo();
      else if (mod && key === 'y') s.redo();
      else if (mod && key === 'c') copySelection();
      else if (mod && key === 'x') {
        copySelection();
        s.removeIds(s.selection);
      } else if (mod && key === 'v') pasteClipboard();
      else if (mod && key === 'd') {
        copySelection();
        pasteClipboard();
      } else if (mod && key === 'a') s.select(s.doc.nodes.map((n) => n.id));
      else if (mod && key === 's') saveFile();
      else if (mod && (key === '=' || key === '+')) zoomBy(1.25);
      else if (mod && key === '-') zoomBy(0.8);
      else if (mod && key.startsWith('arrow') && nodeIds.length === 1) spawnFrom(nodeIds[0], key === 'arrowleft' ? 'left' : key === 'arrowright' ? 'right' : key === 'arrowup' ? 'top' : 'bottom');
      else if (mod) handled = false;
      else if (key === 'backspace' || key === 'delete') s.removeIds(s.selection);
      else if (key === 'escape') {
        if (s.panel) s.setPanel(null);
        else if (s.tool !== 'select') s.setTool('select');
        else s.select([]);
      } else if (key === 'enter' && editable) s.setEditing(only);
      else if (key.startsWith('arrow') && nodeIds.length) {
        const step = e.shiftKey ? 1 : 10;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        const ids = new Set(nodeIds);
        s.mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }));
      } else if (e.shiftKey && e.code === 'Digit1') s.fit();
      else if (key === 'l') s.setPanel(s.panel === 'library' ? null : 'library');
      else if (TOOL_KEYS[key] && !e.shiftKey && !e.altKey) s.setTool(TOOL_KEYS[key]);
      else if (editable && e.key.length === 1 && e.key !== ' ' && !e.altKey) return typeToEdit();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const panel = useStore((s) => s.panel);
  useHotkeys();
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <Toolbar />
        <div className="stage">
          <Canvas />
          {panel === 'lists' && <ListsPanel />}
        </div>
        <Inspector />
      </div>
      {panel === 'text' && <TextPanel />}
      {panel === 'export' && <ExportPanel />}
    </div>
  );
}
