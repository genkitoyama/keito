import { create } from 'zustand';
import {
  type BoardInfo,
  currentBoardId,
  listBoards,
  loadBoard,
  removeBoard,
  saveBoard,
  saveFailed,
} from '../platform/storage';
import { fromYaml } from './dsl';
import { docBounds, nodeRect } from './geometry';
import { allIds, freshId, randomId } from './presets';
import { SAMPLE_YAML } from './sample';
import { type Doc, type Edge, type Node, emptyMeta } from './types';

export type Tool = 'select' | 'pan' | 'rect' | 'round' | 'diamond' | 'ellipse' | 'cloud' | 'sticky' | 'text' | 'frame' | 'sequence';
export type Panel = null | 'lists' | 'text' | 'export' | 'library';
export interface View {
  x: number;
  y: number;
  k: number;
}

const HISTORY = 100;

export const emptyDoc = (title?: string): Doc => ({ version: 1, id: randomId(), meta: emptyMeta(title), nodes: [], edges: [] });

function initialDoc(): Doc {
  const id = currentBoardId();
  const doc = (id && loadBoard(id)) || listBoards().map((b) => loadBoard(b.id)).find(Boolean);
  if (doc) return doc;
  try {
    return fromYaml(SAMPLE_YAML, emptyDoc());
  } catch {
    return emptyDoc();
  }
}

interface State {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  boards: BoardInfo[];
  selection: string[];
  tool: Tool;
  view: View;
  editing: string | null;
  panel: Panel;

  /** Push the current doc onto the undo stack (call before a drag or a burst of edits). */
  checkpoint(): void;
  /** Replace the doc. `record` adds an undo step. */
  setDoc(doc: Doc, record?: boolean): void;
  mutate(fn: (d: Doc) => Doc, record?: boolean): void;
  updateNode(id: string, patch: Partial<Node>, record?: boolean): void;
  updateEdge(id: string, patch: Partial<Edge>, record?: boolean): void;
  removeIds(ids: string[]): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  setTool(tool: Tool): void;
  setView(view: View): void;
  setEditing(id: string | null): void;
  setPanel(panel: Panel): void;
  fit(): void;
  openBoard(id: string): void;
  newBoard(doc?: Doc): void;
  deleteBoard(id: string): void;
}

export const useStore = create<State>((set, get) => ({
  doc: initialDoc(),
  past: [],
  future: [],
  boards: listBoards(),
  selection: [],
  tool: 'select',
  view: { x: 0, y: 0, k: 1 },
  editing: null,
  // `?panel=export` etc. opens a panel on load (handy for deep links).
  panel: (new URLSearchParams(location.search).get('panel') as Panel) || null,

  checkpoint: () => set((s) => ({ past: [...s.past.slice(-HISTORY), s.doc], future: [] })),
  setDoc: (doc, record = true) => {
    if (record) get().checkpoint();
    set({ doc });
  },
  mutate: (fn, record = true) => get().setDoc(fn(get().doc), record),
  updateNode: (id, patch, record = true) =>
    get().mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as Node) : n)) }), record),
  updateEdge: (id, patch, record = true) =>
    get().mutate((d) => ({ ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), record),
  removeIds: (ids) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    get().mutate((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => !gone.has(n.id)),
      edges: d.edges.filter((e) => !gone.has(e.id) && !gone.has(e.from.node) && !gone.has(e.to.node)),
    }));
    set({ selection: [], editing: null });
  },
  undo: () =>
    set((s) => {
      const doc = s.past[s.past.length - 1];
      return doc ? { doc, past: s.past.slice(0, -1), future: [s.doc, ...s.future], selection: [], editing: null } : s;
    }),
  redo: () =>
    set((s) => {
      const doc = s.future[0];
      return doc ? { doc, past: [...s.past, s.doc], future: s.future.slice(1), selection: [], editing: null } : s;
    }),
  select: (selection) => set({ selection }),
  setTool: (tool) => set({ tool }),
  setView: (view) => set({ view }),
  setEditing: (editing) => set({ editing }),
  setPanel: (panel) => set({ panel }),
  fit: () => {
    const el = document.getElementById('canvas');
    const box = docBounds(get().doc);
    if (!el || !box) return set({ view: { x: 0, y: 0, k: 1 } });
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(1.25, (width - 120) / Math.max(1, box.w), (height - 120) / Math.max(1, box.h));
    set({ view: { k, x: (width - box.w * k) / 2 - box.x * k, y: (height - box.h * k) / 2 - box.y * k } });
  },
  openBoard: (id) => {
    const doc = loadBoard(id);
    if (!doc) return;
    saveBoard(get().doc);
    set({ doc, past: [], future: [], selection: [], editing: null, boards: saveBoard(doc) });
    requestAnimationFrame(get().fit);
  },
  newBoard: (doc = emptyDoc()) => {
    saveBoard(get().doc);
    set({ doc, past: [], future: [], selection: [], editing: null, boards: saveBoard(doc) });
    requestAnimationFrame(get().fit);
  },
  deleteBoard: (id) => {
    const boards = removeBoard(id);
    if (id !== get().doc.id) return set({ boards });
    const next = boards.map((b) => loadBoard(b.id)).find(Boolean) ?? emptyDoc();
    set({ doc: next, past: [], future: [], selection: [], editing: null, boards: saveBoard(next) });
    requestAnimationFrame(get().fit);
  },
}));

// Autosave.
let timer: number | undefined;
let warned = false;
useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    useStore.setState({ boards: saveBoard(useStore.getState().doc) });
    if (saveFailed && !warned) {
      warned = true;
      alert('ブラウザの保存容量を超えたため、このボードは自動保存されていません。画像を減らすか小さくするか、「保存」でファイルに書き出してください。');
    }
    if (!saveFailed) warned = false;
  }, 400);
});

let clipboard: { nodes: Node[]; edges: Edge[] } | null = null;

export function copySelection(): void {
  const { doc, selection } = useStore.getState();
  const ids = new Set(selection);
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  if (!nodes.length) return;
  clipboard = { nodes, edges: doc.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node)) };
}

/** Paste (or duplicate) with fresh ids, keeping the cables between the copied nodes. */
export function pasteClipboard(offset = 30): void {
  if (!clipboard) return;
  const s = useStore.getState();
  const taken = allIds(s.doc);
  const map = new Map<string, string>();
  const nodes = clipboard.nodes.map((n) => {
    const id = freshId(taken, n.id.replace(/\d+$/, '') || 'n');
    map.set(n.id, id);
    return { ...n, id, x: n.x + offset, y: n.y + offset };
  });
  const edges = clipboard.edges.map((e) => ({
    ...e,
    id: freshId(taken, 'e'),
    from: { ...e.from, node: map.get(e.from.node)! },
    to: { ...e.to, node: map.get(e.to.node)! },
    route: e.route?.map((p) => ({ x: p.x + offset, y: p.y + offset })),
  }));
  s.mutate((d) => ({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] }));
  s.select(nodes.map((n) => n.id));
  clipboard = { nodes, edges };
}

export function align(mode: 'left' | 'top' | 'hcenter' | 'vcenter' | 'hspace' | 'vspace'): void {
  const s = useStore.getState();
  const ids = new Set(s.selection);
  const picked = s.doc.nodes.filter((n) => ids.has(n.id));
  if (picked.length < 2) return;
  const rects = new Map(picked.map((n) => [n.id, nodeRect(n)]));
  const pos = new Map<string, { x: number; y: number }>();
  const all = [...rects.values()];
  if (mode === 'left') for (const n of picked) pos.set(n.id, { x: Math.min(...all.map((r) => r.x)), y: n.y });
  if (mode === 'top') for (const n of picked) pos.set(n.id, { x: n.x, y: Math.min(...all.map((r) => r.y)) });
  if (mode === 'hcenter') {
    const c = all.reduce((a, r) => a + r.x + r.w / 2, 0) / all.length;
    for (const n of picked) pos.set(n.id, { x: Math.round(c - rects.get(n.id)!.w / 2), y: n.y });
  }
  if (mode === 'vcenter') {
    const c = all.reduce((a, r) => a + r.y + r.h / 2, 0) / all.length;
    for (const n of picked) pos.set(n.id, { x: n.x, y: Math.round(c - rects.get(n.id)!.h / 2) });
  }
  if (mode === 'hspace' || mode === 'vspace') {
    const h = mode === 'hspace';
    const sorted = [...picked].sort((a, b) => (h ? a.x - b.x : a.y - b.y));
    const size = (n: Node): number => (h ? rects.get(n.id)!.w : rects.get(n.id)!.h);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = (h ? last.x - first.x : last.y - first.y) + size(last);
    const gap = (span - sorted.reduce((a, n) => a + size(n), 0)) / (sorted.length - 1);
    let at = h ? first.x : first.y;
    for (const n of sorted) {
      pos.set(n.id, h ? { x: Math.round(at), y: n.y } : { x: n.x, y: Math.round(at) });
      at += size(n) + gap;
    }
  }
  s.mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (pos.has(n.id) ? { ...n, ...pos.get(n.id)! } : n)) }));
}

// Another tab saved this board: follow it, so two open tabs never overwrite each other with stale copies.
window.addEventListener('storage', (e) => {
  const { doc, editing } = useStore.getState();
  if (e.key !== `keito:board:${doc.id}` || !e.newValue || editing) return;
  if (e.newValue === JSON.stringify(doc)) return;
  const next = loadBoard(doc.id);
  if (next) useStore.setState({ doc: next, selection: [], boards: listBoards() });
});
