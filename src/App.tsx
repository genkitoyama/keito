import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Canvas, insertImages, spawnFrom, zoomBy } from './canvas/Canvas';
import { hasText } from './model/types';
import { getSetting, setSetting } from './platform/storage';
import { copySelection, pasteClipboard, useStore } from './model/store';
import { ExportPanel } from './ui/ExportPanel';
import { BoardsPanel } from './ui/Boards';
import { Inspector } from './ui/Inspector';
import { ListsPanel } from './ui/ListsPanel';
import { RevisionBanner } from './ui/Revisions';
import { TextPanel } from './ui/TextPanel';
import { TOOL_KEYS, Toolbar } from './ui/Toolbar';
import { TopBar, saveFile } from './ui/TopBar';
import { kindOf } from './model/kinds';
import { isUnderlay } from './model/geometry';

/** Copy on the board, and clear any picture left on the system clipboard so the next paste is this copy. */
function copyOut() {
  copySelection();
  if (useStore.getState().selection.length) navigator.clipboard?.writeText('').catch(() => {});
}

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
      const onlyNode = s.doc.nodes.find((n) => n.id === only);
      const editable = !!only && (!onlyNode || hasText(onlyNode));
      // Typing with the IME on a selected shape starts editing: mount and focus the
      // editor synchronously and let this very keystroke flow into it.
      const typeToEdit = () => flushSync(() => s.setEditing(only));
      if (ime && !mod && editable) return typeToEdit();
      let handled = true;
      if (mod && key === 'z') e.shiftKey ? s.redo() : s.undo();
      else if (mod && key === 'y') s.redo();
      else if (mod && key === 'c') copyOut();
      else if (mod && key === 'x') {
        copyOut();
        s.removeIds(s.selection);
      } else if (mod && key === 'v') return; // handled by the paste event, which can see images
      else if (mod && key === 'd') {
        copySelection();
        pasteClipboard();
      } else if (mod && key === 'a') s.select(s.doc.nodes.filter((n) => !isUnderlay(n)).map((n) => n.id));
      else if (mod && key === 's') void saveFile();
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
      // The library and the tools a board's kind offers; keys for others do nothing on it.
      else if (key === 'l' && kindOf(s.doc).library) s.setPanel(s.panel === 'library' ? null : 'library');
      else if (TOOL_KEYS[key] && !e.shiftKey && !e.altKey && kindOf(s.doc).tools.includes(TOOL_KEYS[key])) s.setTool(TOOL_KEYS[key]);
      else if (editable && e.key.length === 1 && e.key !== ' ' && !e.altKey) return typeToEdit();
      else handled = false;
      if (handled) e.preventDefault();
    };
    // Paste: pictures and SVG markup from the system clipboard become image nodes;
    // anything else pastes what was last copied on the board.
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      const text = e.clipboardData?.getData('text/plain') ?? '';
      e.preventDefault();
      if (files.length) void insertImages(files);
      else if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) void insertImages([new File([text], 'pasted.svg', { type: 'image/svg+xml' })]);
      else pasteClipboard();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

/** Draggable boundary between two panes. `onDrag` gets how far the pointer has moved since the last call. */
function Splitter({ axis, onDrag }: { axis: 'x' | 'y'; onDrag: (delta: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className={`splitter ${axis}`}
      onPointerDown={(e) => {
        last.current = axis === 'x' ? e.clientX : e.clientY;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Pointer already gone: the drag just ends when it leaves the grip.
        }
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const now = axis === 'x' ? e.clientX : e.clientY;
        onDrag(now - last.current);
        last.current = now;
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    />
  );
}

/** A pane size the user can drag, remembered in this browser. */
function usePaneSize(name: string, initial: number, min: number, max: () => number): [number, (delta: number) => void] {
  const [size, setSize] = useState(() => Number(getSetting(name)) || initial);
  const grow = (delta: number) =>
    setSize((v) => {
      const next = Math.round(Math.min(max(), Math.max(min, v + delta)));
      setSetting(name, String(next));
      return next;
    });
  return [size, grow];
}

export function App() {
  const panel = useStore((s) => s.panel);
  // A board with no lists (a sequence or free board) keeps no lists panel, even if it was left open.
  const hasLists = useStore((s) => kindOf(s.doc).lists.length > 0);
  const ready = useStore((s) => s.ready);
  const [side, growSide] = usePaneSize('inspectorWidth', 270, 220, () => Math.max(220, window.innerWidth - 420));
  const [lists, growLists] = usePaneSize('listsHeight', 260, 110, () => Math.max(110, window.innerHeight - 220));
  useHotkeys();
  if (!ready) return <div className="loading">ボードを読み込み中…</div>;
  return (
    <div className="app" style={{ '--side': `${side}px`, '--lists': `${lists}px` } as CSSProperties}>
      <TopBar />
      <div className="main">
        <Toolbar />
        <div className="stage">
          <RevisionBanner />
          <Canvas />
          {panel === 'lists' && hasLists && <Splitter axis="y" onDrag={(d) => growLists(-d)} />}
          {panel === 'lists' && hasLists && <ListsPanel />}
        </div>
        <Splitter axis="x" onDrag={(d) => growSide(-d)} />
        <Inspector />
      </div>
      {panel === 'text' && <TextPanel />}
      {panel === 'export' && <ExportPanel />}
      {panel === 'boards' && <BoardsPanel />}
    </div>
  );
}
