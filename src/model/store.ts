import { fitLegends } from './legend';
import { drawingOf, entryFor, fingerprint, thin } from './history';
import { create } from 'zustand';
import { type Backend, type BoardInfo, Conflict, connect, externalize, localBoards } from '../platform/storage';
import { fromYaml } from './dsl';
import { type BoardKind, KINDS, kindOf } from './kinds';
import { SEQUENCE_SAMPLE } from './sequence';
import { readBoard } from './load';
import { docBounds, nodeRect } from './geometry';
import { allIds, freshId, makeNode, randomId } from './presets';
import { SAMPLE_YAML } from './sample';
import { registerSignals } from './signals';
import { type Entry, type ShareNode, catalog, newKey, pull, stamp, takeFrom } from './shared';
import { type Doc, type Edge, type Node, type Revision, type UserPreset, emptyMeta } from './types';

export type Tool = 'select' | 'pan' | 'rect' | 'round' | 'diamond' | 'ellipse' | 'cloud' | 'sticky' | 'text' | 'frame' | 'sequence';
export type Panel = null | 'lists' | 'text' | 'export' | 'library' | 'boards';
/**
 * Something picked from the toolbar or a library, waiting to be put where the user clicks (its
 * outline follows the pointer). `place` puts it centred on a point of the board.
 */
export interface Placing {
  label: string;
  size: { w: number; h: number };
  place(at: { x: number; y: number }): void;
}

export interface View {
  x: number;
  y: number;
  k: number;
}

const HISTORY = 100;
/** A board's state goes into its history once editing has paused this long. */
const SETTLE_MS = 2 * 60 * 1000;
const CURRENT = 'keito:current';

export const emptyDoc = (title?: string): Doc => ({ version: 1, id: randomId(), meta: emptyMeta(title), nodes: [], edges: [] });

/**
 * A new board of a kind, in a project. A sequence board starts with a diagram to write over, so
 * it is never a blank page.
 */
export function startBoard(kind: BoardKind, title: string, project: string): Doc {
  const doc: Doc = { ...emptyDoc(title.trim() || KINDS[kind].label), kind: kind === 'system' ? undefined : kind };
  doc.meta.project = project.trim();
  if (kind === 'sequence') doc.nodes.push(makeNode('sequence', 0, 0, new Set(), SEQUENCE_SAMPLE));
  return doc;
}

function sampleDoc(): Doc {
  try {
    return fromYaml(SAMPLE_YAML, emptyDoc());
  } catch {
    return emptyDoc();
  }
}

/** Each board has its own address: `#/b/<id>`. */
const boardInUrl = (): string | null => /^#\/b\/([\w-]+)/.exec(location.hash)?.[1] ?? null;
function showInUrl(id: string): void {
  if (boardInUrl() !== id) history.replaceState(null, '', `${location.pathname}${location.search}#/b/${id}`);
  localStorage.setItem(CURRENT, id);
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
  /** False until the first board has been loaded from storage. */
  ready: boolean;
  /** Where boards are kept: a folder on disk (server) or this browser (local). */
  mode: 'server' | 'local';
  /** `conflict`: the board on disk changed elsewhere (the command line …) while it had unsaved edits here. */
  saving: 'saved' | 'saving' | 'error' | 'conflict';
  /** Set while an old revision is on screen in place of the live board (which is not touched). */
  viewing: { entry: Revision; all: Revision[] } | null;

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
  /** Give every board of a project another project name (案件名). */
  renameProject(from: string, to: string): void;
  /** Settle a conflict: take the board as it is on disk, or write this page's version over it. */
  resolveConflict(choice: 'reload' | 'overwrite'): void;
  /** Keep the board as it stands now in its history under a name, for good. */
  nameState(name: string): void;
  /** Give a state in the history a name (kept for good), or take it away (empty: it may thin out). */
  renameRevision(id: string, name: string): void;
  viewRevision(id: string): void;
  exitRevision(): void;
  /** Make the revision on screen the live board again. */
  restoreRevision(): void;
  deleteRevision(id: string): void;
  /** Devices saved for reuse, shared by all boards. */
  presets: UserPreset[];
  placing: Placing | null;
  setPlacing(placing: Placing | null): void;
  /** Save a device on the board as a preset (replacing one of the same name, maker and model). */
  savePreset(deviceId: string): void;
  deletePreset(id: string): void;

  /** The other boards of the open board's project, as last read (for sharing things between them). */
  others: Doc[];
  /** Make a node here the same thing as one on another board of the project (whose particulars it takes). */
  linkTo(nodeId: string, target: Entry): void;
  /** A node here stops being shared with the other boards (they keep their own copies). */
  unlink(nodeId: string): void;
  /** Software runs on a device of another board (or on none). */
  runOn(nodeId: string, host: Entry | null): void;
  /** Open another board with one of its nodes selected and in view. */
  openAt(boardId: string, nodeId: string): void;
}

let backend: Backend | null = null;
/** The doc as last read from or written to storage; equal to the current doc means nothing to save. */
let stored: Doc | null = null;
let timer: number | undefined;
/** The live board, set aside while an old revision is on screen. */
let live: Doc | null = null;

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  boards: [],
  selection: [],
  tool: 'select',
  view: { x: 0, y: 0, k: 1 },
  editing: null,
  // `?panel=export` etc. opens a panel on load (handy for deep links).
  panel: (new URLSearchParams(location.search).get('panel') as Panel) || null,
  ready: false,
  mode: 'local',
  saving: 'saved',
  viewing: null,
  presets: [],
  others: [],
  placing: null,
  setPlacing: (placing) => set({ placing, ...(placing ? { tool: 'select' as Tool } : {}) }),

  checkpoint: () => set((s) => ({ past: [...s.past.slice(-HISTORY), s.doc], future: [] })),
  setDoc: (doc, record = true) => {
    if (record) get().checkpoint();
    set({ doc: fitLegends(doc) });
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
  // Arming a tool puts away whatever was waiting to be placed.
  setTool: (tool) => set({ tool, placing: null }),
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
  openBoard: (id) => void run(async (b) => {
    if (id === get().doc.id) return;
    await quietly(() => settle(b));
    await flush();
    const doc = await b.load(id);
    if (doc) show(doc);
  }),
  newBoard: (doc = emptyDoc()) => void run(async (b) => {
    await quietly(() => settle(b));
    await flush();
    // A file opened from elsewhere may carry its pictures inline; give them a home in the board's folder.
    // History belongs to the board it was recorded on; a copy or an opened file starts without one.
    // An opened file may be of an older form: it is read the way a stored board is.
    const next = await externalize(readBoard({ ...doc, revisions: undefined }) ?? { ...doc, revisions: undefined }, b);
    show(next);
    await persist(next);
  }),
  nameState: (name) => void run(async (b) => {
    if (get().viewing || !name.trim()) return;
    const doc = get().doc;
    const last = doc.revisions?.at(-1);
    // The state already in the history (nothing changed since): it just takes the name.
    if (last && last.hash === fingerprint(doc)) return setRevisions(b, doc.id, (list) => list.map((r) => (r.id === last.id ? { ...r, name: name.trim() } : r)));
    await snapshot(b, doc, { name: name.trim() });
  }),
  renameRevision: (id, name) => void run(async (b) => {
    const board = (live ?? get().doc).id;
    await setRevisions(b, board, (list) => list.map((r) => (r.id === id ? { ...r, name: name.trim() || undefined } : r)));
  }),
  viewRevision: (id) => void run(async (b) => {
    // The board as it is goes into the history before an older state takes its place on screen.
    if (!get().viewing) {
      await quietly(() => settle(b));
      await flush();
    }
    const base = live ?? get().doc;
    const all = base.revisions ?? [];
    const i = all.findIndex((r) => r.id === id);
    const snap = i < 0 ? null : await b.loadRevision(base.id, id).catch(() => null);
    // A state whose drawing is gone (an entry from an older copy of the board) says so plainly.
    if (!snap) return alert('この時点の図が見つかりませんでした（図のファイルが残っていません）。');
    live = base;
    // On screen the old drawing carries the history up to its own entry, as its sheet would have.
    set({ doc: { ...snap, id: base.id, revisions: all.slice(0, i + 1) }, viewing: { entry: all[i], all }, past: [], future: [], selection: [], editing: null });
    requestAnimationFrame(get().fit);
  }),
  exitRevision: () => {
    if (!live) return;
    const doc = live;
    live = null;
    set({ doc, viewing: null, past: [], future: [], selection: [], editing: null });
    requestAnimationFrame(get().fit);
  },
  restoreRevision: () => void run(async (b) => {
    const { viewing, doc } = get();
    if (!viewing || !live) return;
    const before = live;
    // What is replaced goes into the history first, so going back is never a loss.
    const kept = await snapshot(b, before, { source: 'restore', summary: `${viewing.entry.name ?? 'この時点'}に戻す前` });
    live = null;
    // The state gone back to is already in the history: it is the base for what comes next.
    snapBase = doc;
    baseKept = true;
    // The old drawing becomes the live board (and is saved); undo brings back what it replaced.
    set({ doc: { ...doc, revisions: kept ?? before.revisions }, viewing: null, past: [before], future: [], selection: [], editing: null });
  }),
  deleteRevision: (id) => void run(async (b) => {
    if (get().viewing) return;
    const board = get().doc.id;
    await b.removeRevision(board, id);
    await setRevisions(b, board, (list) => list.filter((r) => r.id !== id));
  }),
  savePreset: (deviceId) => void run(async (b) => {
    const d = get().doc.nodes.find((n) => n.id === deviceId);
    if (d?.type !== 'device') return;
    // Gear and software are kept apart: a PC saved from a system board is no part of a software board.
    const software = kindOf(get().doc).id === 'software';
    const same = (p: UserPreset): boolean => p.name === d.text && p.maker === d.maker && p.model === d.model && !!p.software === software;
    const preset: UserPreset = {
      id: get().presets.find(same)?.id ?? randomId(),
      ...(software ? { software } : {}),
      name: d.text,
      category: d.category,
      maker: d.maker,
      model: d.model,
      note: d.note,
      w: d.w,
      ports: d.ports.map((p) => ({ ...p })),
      watts: d.watts,
      capacity: d.capacity,
      url: d.url,
      color: d.color,
    };
    const presets = [preset, ...get().presets.filter((p) => !same(p))];
    await b.savePresets(presets);
    set({ presets });
  }),
  deletePreset: (id) => void run(async (b) => {
    const presets = get().presets.filter((p) => p.id !== id);
    await b.savePresets(presets);
    set({ presets });
  }),
  renameProject: (from, to) =>
    void run(async (b) => {
      const name = to.trim();
      // An older state on screen is never written; the live board must be the one renamed.
      if (!name || name === from || get().viewing) return;
      // The board on screen changes in place (one undo step); the others are read, renamed, written.
      if ((get().doc.meta.project ?? '') === from) get().mutate((d) => ({ ...d, meta: { ...d.meta, project: name } }));
      const missed: string[] = [];
      try {
        for (const info of get().boards) {
          if ((info.project ?? '') !== from || info.id === get().doc.id) continue;
          // A board that cannot be written now (changed elsewhere meanwhile …) keeps its old name;
          // it is no reason to stop, nor a conflict of the board on screen.
          try {
            const doc = await b.load(info.id);
            if (doc && (doc.meta.project ?? '') === from) await b.save({ ...doc, meta: { ...doc.meta, project: name } });
          } catch (e) {
            console.warn(`[keito] ${info.title}: project not renamed`, e);
            missed.push(info.title);
          }
        }
      } finally {
        set({ boards: await b.list() });
      }
      if (missed.length) alert(`次のボードは案件名を変えられませんでした（ほかで更新中など）: ${missed.join('、')}`);
    }),
  resolveConflict: (choice) =>
    void run(async (b) => {
      const mine = get().doc;
      if (choice === 'overwrite') {
        await b.save(mine, true);
        stored = mine;
        return set({ saving: get().doc === mine ? 'saved' : 'saving' });
      }
      const fresh = await b.load(mine.id);
      if (!fresh) return;
      stored = fresh;
      const shown = fitLegends(fresh);
      // This page's version stays one undo away, should it be wanted after all.
      adopt(shown, () => set({ doc: shown, past: [mine], future: [], selection: get().selection.filter((id) => fresh.nodes.some((n) => n.id === id) || fresh.edges.some((e) => e.id === id)), saving: 'saved' }));
    }),
  linkTo: (nodeId, target) =>
    void run(async (b) => {
      if (get().viewing) return;
      const key = await shareKey(b, target);
      if (!key) return;
      const fresh = (get().others.find((d) => d.id === target.board)?.nodes.find((n) => n.id === target.node.id) as ShareNode | undefined) ?? target.node;
      // The other board's particulars win: it is the one being linked to.
      sharing(() => get().mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId && n.type === 'device' ? { ...takeFrom(n, fresh), shared: key, sharedAt: fresh.sharedAt } : n)) })));
    }),
  unlink: (nodeId) => get().mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId && n.type === 'device' ? { ...n, shared: undefined, sharedAt: undefined } : n)) })),
  runOn: (nodeId, host) =>
    void run(async (b) => {
      if (get().viewing) return;
      const key = host ? ((await shareKey(b, host)) ?? undefined) : undefined;
      if (host && !key) return;
      get().mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId && n.type === 'device' ? { ...n, runsOn: key } : n)) }));
      pullIn();
    }),
  openAt: (boardId, nodeId) =>
    void run(async (b) => {
      if (boardId !== get().doc.id) {
        await quietly(() => settle(b));
        await flush();
        const doc = await b.load(boardId);
        if (!doc) return;
        show(doc);
      }
      set({ selection: [nodeId] });
      // After the board has been fitted to the window: the node, in the middle.
      requestAnimationFrame(() => requestAnimationFrame(() => centerOn(nodeId)));
    }),
  deleteBoard: (id) => void run(async (b) => {
    if (id === get().doc.id) clearTimeout(timer);
    await b.remove(id);
    const boards = await b.list();
    set({ boards });
    if (id !== get().doc.id) return;
    let next: Doc | null = null;
    for (const info of boards) if ((next = await b.load(info.id))) break;
    if (next) return show(next);
    next = emptyDoc();
    show(next);
    await persist(next);
  }),
}));

/** Run a storage action; a failure surfaces as the "save failed" state instead of an unhandled rejection. */
async function run(fn: (b: Backend) => Promise<void>): Promise<void> {
  if (!backend) return;
  try {
    await fn(backend);
  } catch (e) {
    // Written elsewhere since it was read here: the user settles it (see resolveConflict).
    if (e instanceof Conflict) return void useStore.setState({ saving: 'conflict' });
    console.error(e);
    useStore.setState({ saving: 'error' });
  }
}

/**
 * Automatic history. The board as last kept (or as it was opened) is `snapBase`; once editing
 * pauses, a board that differs from it goes into the history. The state it was opened in is kept
 * first, at the first edit, unless the history already ends with it.
 */
let snapBase: Doc | null = null;
let baseKept = false;
/** Set while a board written elsewhere is taken in: that is no edit, and starts a new base. */
let adopting = false;
/** The opened state being put into the history, for anything that must wait for it. */
let keeping: Promise<void> | null = null;
let settleTimer: number | undefined;

/**
 * Put `doc` into its board's history (thinning older unnamed states); returns the new list.
 * The change is described against `previous`, by default the state last kept.
 */
async function snapshot(b: Backend, doc: Doc, extra: Partial<Revision> = {}, previous: Doc | null = snapBase): Promise<Revision[] | null> {
  // A state the history already ends with is not kept twice (unless it is being given a name).
  const current = live?.id === doc.id ? live : useStore.getState().doc;
  if (!extra.name && current.id === doc.id && current.revisions?.at(-1)?.hash === fingerprint(doc)) {
    snapBase = doc;
    return current.revisions ?? null;
  }
  const before = previous?.id === doc.id ? previous : null;
  const entry = entryFor(doc, before, randomId(), { source: 'auto', ...extra });
  await b.saveRevision(doc.id, entry.id, drawingOf(doc));
  let drop: string[] = [];
  let kept: Revision[] = [];
  await setRevisions(b, doc.id, (list) => {
    const out = thin([...list, entry]);
    drop = out.drop;
    kept = out.keep;
    return out.keep;
  });
  for (const id of drop) await b.removeRevision(doc.id, id).catch(() => {});
  if (doc.id === (live ?? useStore.getState().doc).id) snapBase = doc;
  return kept;
}

/** Put a board written elsewhere on screen as the new base of the history, without counting it an edit. */
function adopt(shown: Doc, apply: () => void): void {
  adopting = true;
  try {
    apply();
  } finally {
    adopting = false;
  }
  snapBase = shown;
  baseKept = false;
}

/** Keep the board now if it changed since it was last kept (before leaving it, after a pause). */
async function settle(b: Backend): Promise<void> {
  clearTimeout(settleTimer);
  // Only a board that changed since it was opened (or last kept) has anything to keep.
  const changed = () => {
    const { doc, viewing, ready, saving } = useStore.getState();
    return ready && !viewing && saving !== 'conflict' && !!snapBase && snapBase.id === doc.id && fingerprint(doc) !== fingerprint(snapBase);
  };
  if (!changed()) return;
  await keepBase(b);
  if (changed()) await snapshot(b, useStore.getState().doc);
}

/** The state the board was opened in, into the history if it does not end with it already. */
function keepBase(b: Backend): Promise<void> {
  if (keeping) return keeping;
  if (baseKept || !snapBase) return Promise.resolve();
  baseKept = true;
  const base = snapBase;
  keeping = (async () => {
    const last = (useStore.getState().doc.revisions ?? []).at(-1);
    if (last?.hash === fingerprint(base)) return;
    // Described against the last state kept, which may be from long before (or from elsewhere).
    const previous = last ? await b.loadRevision(base.id, last.id).catch(() => null) : null;
    await snapshot(b, base, {}, previous);
  })().finally(() => (keeping = null));
  return keeping;
}

/**
 * Run a step of the automatic history. Its failure (browser storage full …) is logged, never shown
 * as a failed save: the board itself is saved all the same.
 */
async function quietly(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn('[keito] history not kept:', e);
  }
}

/** One state from the open board's history, as it was. */
export async function loadState(id: string): Promise<Doc | null> {
  const board = live ?? useStore.getState().doc;
  return backend ? backend.loadRevision(board.id, id) : null;
}

/** The open board as it is now (not an older state shown in its place). */
export const currentBoard = (): Doc => live ?? useStore.getState().doc;

/** Put a freshly loaded (or created) board on screen. */
/**
 * Update a board's list of revisions once the files are written. The writes take a moment, and
 * by then another board may be open: the list then goes to the board it belongs to, on disk.
 */
async function setRevisions(b: Backend, board: string, change: (list: Revision[]) => Revision[]): Promise<void> {
  const s = useStore.getState();
  if (s.doc.id === board && !s.viewing) return s.setDoc({ ...s.doc, revisions: change(s.doc.revisions ?? []) }, false);
  if (live?.id === board) {
    live = { ...live, revisions: change(live.revisions ?? []) };
    return;
  }
  const saved = await b.load(board);
  if (saved) await b.save({ ...saved, revisions: change(saved.revisions ?? []) });
}

function show(doc: Doc): void {
  stored = doc;
  live = null;
  // The base is the board as shown (legends fitted), so fitting alone never reads as an edit.
  const shown = fitLegends(doc);
  snapBase = shown;
  baseKept = false;
  keeping = null;
  clearTimeout(settleTimer);
  useStore.setState({ doc: shown, viewing: null, past: [], future: [], selection: [], editing: null, others: [], placing: null });
  showInUrl(doc.id);
  requestAnimationFrame(useStore.getState().fit);
  void readProject();
}

function centerOn(nodeId: string): void {
  const { doc, view } = useStore.getState();
  const n = doc.nodes.find((x) => x.id === nodeId);
  const el = document.getElementById('canvas');
  if (!n || !el) return;
  const r = nodeRect(n);
  const { width, height } = el.getBoundingClientRect();
  useStore.setState({ view: { ...view, x: width / 2 - (r.x + r.w / 2) * view.k, y: height / 2 - (r.y + r.h / 2) * view.k } });
}

async function persist(doc: Doc): Promise<void> {
  if (!backend) return;
  useStore.setState({ saving: 'saving' });
  try {
    await backend.save(doc);
    stored = doc;
    const info: BoardInfo = { id: doc.id, title: doc.meta.title, updated: Date.now(), project: doc.meta.project || undefined, kind: doc.kind };
    useStore.setState((s) => ({ boards: [info, ...s.boards.filter((x) => x.id !== doc.id)], saving: s.doc === doc ? 'saved' : 'saving' }));
  } catch (e) {
    // Written elsewhere since it was read here: the user settles it (see resolveConflict).
    if (e instanceof Conflict) return void useStore.setState({ saving: 'conflict' });
    console.error(e);
    useStore.setState({ saving: 'error' });
  }
}

/** Write any pending change now (before switching boards or leaving the page). */
async function flush(): Promise<void> {
  clearTimeout(timer);
  if (pushTimer !== undefined) await pushOut().catch(() => {});
  const { doc, ready, viewing, saving } = useStore.getState();
  // An old revision on screen is never written over the live board, nor a conflict settled unasked.
  if (ready && !viewing && saving !== 'conflict' && doc !== stored) await persist(doc);
}

// Keep the signal-type registry in step with the board on screen.
registerSignals(useStore.getState().doc.signals);
useStore.subscribe((s, prev) => {
  if (s.doc.signals !== prev.doc.signals) registerSignals(s.doc.signals);
});

// A tool the board's kind does not offer (left armed from another board, or before the kind
// changed) goes back to selecting: its button is not even on the toolbar.
useStore.subscribe((s) => {
  if (s.tool !== 'select' && s.tool !== 'pan' && !KINDS[s.doc.kind ?? 'system']?.tools.includes(s.tool)) useStore.setState({ tool: 'select' });
});

// History: the opened state is kept at the first edit, the edited one once editing pauses.
useStore.subscribe((s, prev) => {
  if (!s.ready || s.viewing || adopting || s.doc === prev.doc || s.doc.id !== prev.doc.id || !backend) return;
  const b = backend;
  if (!baseKept) void quietly(() => keepBase(b));
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => void quietly(() => settle(b)), SETTLE_MS);
});

/**
 * Sharing between the boards of a project (see shared.ts). The other boards are read when a board
 * is opened, and whenever one of them is written; the open board takes in newer particulars from
 * them. A shared thing edited here is marked as the newest and written through to the others.
 */
let sharingNow = false;
/** Changes made by sharing itself (taking in, linking): no edit of the shared particulars. */
function sharing(fn: () => void): void {
  sharingNow = true;
  try {
    fn();
  } finally {
    sharingNow = false;
  }
}

let projectRead = 0;
async function readProject(): Promise<void> {
  const b = backend;
  if (!b) return;
  const doc = currentBoard();
  const project = doc.meta.project?.trim();
  const ticket = ++projectRead;
  const others: Doc[] = [];
  if (project)
    for (const info of useStore.getState().boards) {
      if (info.id === doc.id || (info.project ?? '').trim() !== project) continue;
      const d = await b.load(info.id).catch(() => null);
      if (d && (d.meta.project ?? '').trim() === project) others.push(d);
    }
  // Another board opened (or another read started) meanwhile: this one is out of date.
  if (ticket !== projectRead || currentBoard().id !== doc.id) return;
  useStore.setState({ others });
  pullIn();
}

/** Take in what the other boards of the project have newer. The undo steps take it in too, so undoing never brings an old name back. */
function pullIn(): void {
  const s = useStore.getState();
  if (!s.ready || s.viewing || s.editing || s.saving === 'conflict') return;
  const entries = catalog([s.doc, ...s.others]);
  const next = pull(s.doc, entries);
  if (next === s.doc) return;
  const fix = (d: Doc): Doc => (d.id === s.doc.id ? pull(d, entries) : d);
  sharing(() => useStore.setState({ doc: fitLegends(next), past: s.past.map(fix), future: s.future.map(fix) }));
}

/** The shared key of a node of the project, given one (and written to its board) if it has none yet. */
async function shareKey(b: Backend, target: Entry): Promise<string | null> {
  if (target.node.shared) return target.node.shared;
  const key = newKey();
  const s = useStore.getState();
  if (target.board === s.doc.id) {
    sharing(() => s.updateNode(target.node.id, { shared: key, sharedAt: Date.now() }, false));
    return key;
  }
  try {
    const d = await b.load(target.board);
    const n = d?.nodes.find((x) => x.id === target.node.id);
    if (!d || !n || n.type !== 'device') return null;
    let next = d;
    if (!n.shared) {
      next = { ...d, nodes: d.nodes.map((x) => (x.id === n.id ? { ...x, shared: key, sharedAt: Date.now() } : x)) };
      await b.save(next);
    }
    useStore.setState((st) => ({ others: st.others.map((o) => (o.id === next.id ? next : o)) }));
    return (next.nodes.find((x) => x.id === n.id) as ShareNode).shared ?? null;
  } catch (e) {
    // The other board could not be written (changed elsewhere just now …): that is not this board's conflict.
    console.warn('[keito] could not share with', target.boardTitle, e);
    alert(`「${target.boardTitle}」に書き込めませんでした。少し待ってからもう一度試してください。`);
    return null;
  }
}

let pushTimer: number | undefined;
function schedulePush(): void {
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void pushOut(), 800);
}

/** Write the shared things edited here through to the other boards of the project. */
async function pushOut(): Promise<void> {
  clearTimeout(pushTimer);
  pushTimer = undefined;
  const b = backend;
  const s = useStore.getState();
  if (!b || s.viewing || !s.doc.meta.project?.trim()) return;
  const doc = s.doc;
  const mine = catalog([doc]);
  const others = [...s.others];
  for (const [i, d] of others.entries()) {
    try {
      // Read anew, so as not to write over a change made to it elsewhere meanwhile.
      const fresh = (await b.load(d.id)) ?? d;
      const next = pull(fresh, mine);
      if (next !== fresh) await b.save(next);
      others[i] = next;
    } catch (e) {
      // It takes the change in when it is next opened (it reads the newest from this board then).
      console.warn(`[keito] ${d.meta.title}: shared change not written`, e);
    }
  }
  if (useStore.getState().doc.id === doc.id) useStore.setState({ others });
}

// A shared thing edited here (by hand, undo, the text panel …) becomes the newest version of it.
useStore.subscribe((s, prev) => {
  if (!s.ready || s.viewing || adopting || sharingNow || s.doc === prev.doc || s.doc.id !== prev.doc.id) return;
  const next = stamp(prev.doc, s.doc, Date.now());
  if (next === s.doc) return;
  sharing(() => useStore.setState({ doc: next }));
  schedulePush();
});

// The board moved to another project (or into one): its fellows are others now.
let projectTimer: number | undefined;
useStore.subscribe((s, prev) => {
  if (s.doc.id !== prev.doc.id || s.viewing || (s.doc.meta.project ?? '') === (prev.doc.meta.project ?? '')) return;
  clearTimeout(projectTimer);
  projectTimer = window.setTimeout(() => void readProject(), 600);
});

// Autosave shortly after every change.
useStore.subscribe((s, prev) => {
  if (!s.ready || s.viewing || s.doc === prev.doc || s.doc === stored || s.saving === 'conflict') return;
  clearTimeout(timer);
  useStore.setState({ saving: 'saving' });
  timer = window.setTimeout(() => void persist(useStore.getState().doc), 500);
});

/** Store a picture for the current board; returns the `src` an image node should keep. */
export async function storeImage(dataUrl: string): Promise<string> {
  if (!backend || backend.mode === 'local') return dataUrl;
  // The board's folder must exist before a picture can go into it.
  if (!useStore.getState().boards.some((b) => b.id === useStore.getState().doc.id)) await flush();
  return backend.putAsset(useStore.getState().doc.id, dataUrl);
}

/** First run against the on-disk store: carry over the boards this browser was keeping. */
async function migrate(b: Backend): Promise<void> {
  if (b.mode !== 'server' || localStorage.getItem('keito:migrated')) return;
  const have = new Set((await b.list()).map((x) => x.id));
  for (const doc of localBoards()) {
    if (!have.has(doc.id)) await b.save(await externalize(doc, b));
  }
  // The browser copies are left in place as a backup.
  localStorage.setItem('keito:migrated', new Date().toISOString());
}

/** Connect to storage and load the board named in the URL (or the last one used). */
export async function boot(): Promise<void> {
  try {
    backend = await connect();
    await migrate(backend);
    let boards = await backend.list();
    const wanted = boardInUrl() ?? localStorage.getItem(CURRENT);
    let doc = wanted ? await backend.load(wanted) : null;
    for (const info of boards) {
      if (doc) break;
      doc = await backend.load(info.id);
    }
    if (!doc) {
      doc = sampleDoc();
      await backend.save(doc);
      boards = await backend.list();
    }
    useStore.setState({ boards, mode: backend.mode, ready: true, presets: await backend.loadPresets().catch(() => []) });
    listen(backend);
    show(doc);
  } catch (e) {
    console.error(e);
    useStore.setState({ ready: true, saving: 'error' });
  }
}

// Following a link or the back button to another board.
window.addEventListener('hashchange', () => {
  const id = boardInUrl();
  if (id && useStore.getState().ready) useStore.getState().openBoard(id);
});

// Coming back to the tab: pick up what another tab (or an edit to the file) saved meanwhile.
/** Take in the board as another writer left it, if nothing here is waiting to be saved. */
async function pickUp(b: Backend): Promise<void> {
  const s = useStore.getState();
  if (!s.ready || s.viewing) return;
  // Unsaved edits here (or text being typed) and a change on disk: the user decides which stays.
  if (s.editing || s.doc !== stored) return void useStore.setState({ saving: 'conflict' });
  const fresh = await b.load(s.doc.id);
  if (!fresh || useStore.getState().doc !== s.doc) return;
  if (JSON.stringify(fresh) === JSON.stringify(s.doc)) return;
  stored = fresh;
  const shown = fitLegends(fresh);
  // The board as written elsewhere is the new base; it goes into the history at the next edit here.
  adopt(shown, () => {
    // The history was made on the version just replaced: undoing into it would write that old
    // version back over what was saved elsewhere. It starts over from the version read in.
    const keep = (id: string) => fresh.nodes.some((n) => n.id === id) || fresh.edges.some((e) => e.id === id);
    useStore.setState({ doc: shown, selection: s.selection.filter(keep), past: [], future: [] });
  });  pullIn();
}

window.addEventListener('focus', () => {
  const s = useStore.getState();
  // Coming back with nothing unsaved: just look. A conflict is only claimed when something changed.
  if (s.ready && !s.viewing && !s.editing && s.doc === stored) void run(pickUp);
  // Other boards of the project may have changed too (another tab, browser storage has no events).
  if (s.ready && !s.viewing) void readProject();
});

/**
 * Hear about boards written elsewhere (the command line, an edit to the file) as it happens: the
 * open board is read in again, and the list of boards follows new ones and new titles.
 */
function listen(b: Backend): void {
  if (b.mode !== 'server' || typeof EventSource === 'undefined') return;
  const events = new EventSource('/api/events');
  events.onmessage = (m) => {
    let news: { id?: string; serial?: number };
    try {
      news = JSON.parse(m.data);
    } catch {
      return;
    }
    const s = useStore.getState();
    if (news.id === s.doc.id) {
      if (b.serialOf?.(news.id) !== news.serial) void run(pickUp);
    } else
      void b.list().then((boards) => {
        useStore.setState({ boards });
        // A board of this project changed (or joined it): what is shared may have changed with it.
        const project = currentBoard().meta.project?.trim();
        const info = boards.find((x) => x.id === news.id);
        if (project && (info?.project?.trim() === project || useStore.getState().others.some((d) => d.id === news.id))) void readProject();
      }, () => {});
  };
}

/** Browsers drop a keepalive request whose body is over 64KB. */
const KEEPALIVE_LIMIT = 60_000;
const unsaved = (): Doc | null => {
  const { doc, ready, viewing } = useStore.getState();
  return ready && !viewing && doc !== stored ? doc : null;
};

// Closing within the autosave delay: browser storage is written on the spot; a board too big to
// go out as the page dies is sent now, and the browser is asked to hold the page until it lands.
window.addEventListener('beforeunload', (e) => {
  const doc = unsaved();
  if (!doc || !backend) return;
  if (backend.mode === 'local') return void backend.save(doc);
  if (JSON.stringify(doc).length <= KEEPALIVE_LIMIT) return;
  void flush();
  e.preventDefault();
  e.returnValue = '';
});

window.addEventListener('pagehide', () => {
  const doc = unsaved();
  if (!doc || !backend) return;
  if (backend.mode === 'local') return void backend.save(doc);
  // Last-moment save: keepalive lets the request outlive the page (small boards only, see above).
  const body = JSON.stringify(doc);
  // Made on the version this page read: never over a change made elsewhere meanwhile.
  const serial = backend.serialOf?.(doc.id);
  const headers = { 'Content-Type': 'application/json', 'If-Match': serial === undefined ? '*' : String(serial) };
  if (body.length <= KEEPALIVE_LIMIT && useStore.getState().saving !== 'conflict') void fetch(`/api/boards/${doc.id}`, { method: 'PUT', keepalive: true, headers, body }).catch(() => {});
});

/** What was copied, and from which board (and project). */
let clipboard: { nodes: Node[]; edges: Edge[]; board: string; project: string } | null = null;

export function copySelection(): void {
  const { doc, selection } = useStore.getState();
  const ids = new Set(selection);
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  if (!nodes.length) return;
  clipboard = { nodes, edges: doc.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node)), board: doc.id, project: doc.meta.project?.trim() ?? '' };
}

/** Paste (or duplicate) with fresh ids, keeping the cables between the copied nodes. */
export function pasteClipboard(offset = 30): void {
  if (!clipboard) return;
  const s = useStore.getState();
  const taken = allIds(s.doc);
  const map = new Map<string, string>();
  // Pasted onto another board of the project, a shared thing stays the same thing; a copy on its
  // own board (or elsewhere) is another one: the second PC is not the first.
  const project = s.doc.meta.project?.trim() ?? '';
  const same = clipboard.board !== s.doc.id && !!project && clipboard.project === project;
  const here = new Set(s.doc.nodes.map((n) => ('shared' in n ? n.shared : undefined)).filter(Boolean));
  const nodes = clipboard.nodes.map((n) => {
    const id = freshId(taken, n.id.replace(/\d+$/, '') || 'n');
    map.set(n.id, id);
    const keep = same && 'shared' in n && !!n.shared && !here.has(n.shared);
    return { ...n, id, x: n.x + offset, y: n.y + offset, ...('shared' in n && !keep ? { shared: undefined, sharedAt: undefined } : {}) } as Node;
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
  clipboard = { ...clipboard, nodes, edges };
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
