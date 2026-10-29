import { pinComments } from './comments';
import { fitLegends } from './legend';
import { drawingOf, entryFor, fingerprint, thin } from './history';
import { create } from 'zustand';
import { type Backend, type BoardInfo, Conflict, Gone, type TrashedBoard, WRITER, connect, externalize, localBoards } from '../platform/storage';
import { ask, tell } from '../platform/io';
import { type BoardKind, KINDS, kindOf } from './kinds';
import { SEQUENCE_SAMPLE } from './sequence';
import { BOARD_ID, readBoard } from './load';
import { docBounds, nodeRect } from './geometry';
import { allIds, freshId, makeNode, randomId } from './presets';
import { sampleBoards } from './sample';
import { registerSignals } from './signals';
import { type Entry, type ShareNode, catalog, newKey, pull, stamp, takeFrom } from './shared';
import { type Doc, type Edge, type Node, type Rect, type Revision, type UserPreset, emptyMeta } from './types';

export type Tool = 'select' | 'pan' | 'rect' | 'round' | 'diamond' | 'ellipse' | 'cloud' | 'sticky' | 'text' | 'frame' | 'sequence';
export type Panel = null | 'lists' | 'export' | 'library' | 'boards' | 'comments' | 'settings';
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
  /** What a search on the board found: shown as it is while the rest fades; null when not searching. */
  found: string[] | null;
  tool: Tool;
  view: View;
  editing: string | null;
  panel: Panel;
  /** False until the first board has been loaded from storage. */
  ready: boolean;
  /** Where boards are kept: a folder on disk (server) or this browser (local). */
  mode: 'server' | 'local';
  /**
   * How the board on screen stands with its storage. `conflict`: changed elsewhere (the command line
   * …) while it had unsaved edits here; `gone`: deleted elsewhere while open here. Either is written
   * again only when the user says.
   */
  saving: 'saved' | 'saving' | 'error' | 'conflict' | 'gone';
  /** Set while an old revision is on screen in place of the live board (which is not touched). */
  viewing: { entry: Revision; all: Revision[] } | null;
  /** Why the last write failed, while `saving` is 'error'. */
  saveError: string | null;
  /** A short word on what was just done (what a delete took with it …), shown for a moment. */
  notice: string | null;

  /** Push the current doc onto the undo stack (call before a drag or a burst of edits). */
  checkpoint(): void;
  /** Take back the last undo step without leaving it to redo: what it did is called off, not undone. */
  dropStep(): void;
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
  found: null,
  tool: 'select',
  view: { x: 0, y: 0, k: 1 },
  editing: null,
  // `?panel=export` etc. opens a panel on load (handy for deep links).
  panel: (new URLSearchParams(location.search).get('panel') as Panel) || null,
  ready: false,
  mode: 'local',
  saving: 'saved',
  viewing: null,
  saveError: null,
  notice: null,
  presets: [],
  others: [],
  placing: null,
  setPlacing: (placing) => set({ placing, ...(placing ? { tool: 'select' as Tool } : {}) }),

  checkpoint: () => set((s) => ({ past: [...s.past.slice(-HISTORY), s.doc], future: [] })),
  dropStep: () =>
    set((s) => {
      const doc = s.past.at(-1);
      return doc ? { doc: { ...doc, revisions: s.doc.revisions }, past: s.past.slice(0, -1), selection: [], editing: null } : s;
    }),
  setDoc: (doc, record = true) => {
    // An earlier state on screen is for looking at: an edit there would be lost, or restored
    // along with it unseen.
    if (get().viewing) return;
    if (record) get().checkpoint();
    set({ doc: fitLegends(pinComments(get().doc, doc)) });
  },
  mutate: (fn, record = true) => get().setDoc(fn(get().doc), record),
  updateNode: (id, patch, record = true) =>
    get().mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as Node) : n)) }), record),
  updateEdge: (id, patch, record = true) =>
    get().mutate((d) => ({ ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), record),
  removeIds: (ids) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    const d = get().doc;
    // Lines go with the things they join: said, since they were not among what was picked.
    const along = d.edges.filter((e) => !gone.has(e.id) && (gone.has(e.from.node) || gone.has(e.to.node))).length;
    get().mutate((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => !gone.has(n.id)),
      edges: d.edges.filter((e) => !gone.has(e.id) && !gone.has(e.from.node) && !gone.has(e.to.node)),
    }));
    set({ selection: [], editing: null });
    if (along && !get().viewing) say(`つながっていた線 ${along} 本も一緒に消しました（⌘Z で戻せます）`);
  },
  // The board's history list is not part of the drawing: undo takes back drawing, never a kept state.
  undo: () =>
    set((s) => {
      const doc = s.past[s.past.length - 1];
      return doc ? { doc: { ...doc, revisions: s.doc.revisions }, past: s.past.slice(0, -1), future: [s.doc, ...s.future], selection: [], editing: null } : s;
    }),
  redo: () =>
    set((s) => {
      const doc = s.future[0];
      return doc ? { doc: { ...doc, revisions: s.doc.revisions }, past: [...s.past, s.doc], future: s.future.slice(1), selection: [], editing: null } : s;
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
    const was = get();
    const doc = await switchTo(b, id);
    if (doc === 'stayed') return showInUrl(get().doc.id);
    if (doc === 'superseded') return;
    if (doc) {
      if (!was.viewing) kept.set(was.doc.id, { past: was.past, future: was.future, view: was.view, print: fingerprint(was.doc) });
      return show(doc);
    }
    // Deleted elsewhere (another tab, the command line), or its file broken: the list follows.
    set({ boards: await b.list() });
    showInUrl(get().doc.id);
    void tell('そのボードを開けませんでした（ほかの場所で削除されたか、ファイルが読めない状態です）。');
  }),
  newBoard: (doc = emptyDoc()) => void run(async (b) => {
    if (!(await leave(b))) return;
    // A file opened from elsewhere may carry its pictures inline; give them a home in the board's folder.
    // History belongs to the board it was recorded on; a copy or an opened file starts without one.
    // An opened file may be of an older form: it is read the way a stored board is.
    // An id the storage cannot take (a file written by hand or another tool) is given a new one.
    // An id already taken in the storage (a board made meanwhile elsewhere, not yet in the list) is
    // never written over: the new board takes another.
    const taken = BOARD_ID.test(doc.id) && !!(await b.load(doc.id).catch(() => null));
    const id = BOARD_ID.test(doc.id) && !taken ? doc.id : randomId();
    const next = await externalize(readBoard({ ...doc, id, revisions: undefined }) ?? { ...doc, id, revisions: undefined }, b);
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
    if (!get().viewing && !(await leave(b))) return;
    const base = live ?? get().doc;
    const all = base.revisions ?? [];
    const i = all.findIndex((r) => r.id === id);
    const snap = i < 0 ? null : await b.loadRevision(base.id, id).catch(() => null);
    // A state whose drawing is gone (an entry from an older copy of the board) says so plainly.
    if (!snap) return void tell('この時点の図が見つかりませんでした（図のファイルが残っていません）。');
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
    // Read anew first: another window may have saved presets of its own since this one read them.
    const now = await b.loadPresets().catch(() => get().presets);
    const presets = [preset, ...now.filter((p) => !same(p) && p.id !== preset.id)];
    await b.savePresets(presets);
    set({ presets });
  }),
  deletePreset: (id) => void run(async (b) => {
    const now = await b.loadPresets().catch(() => get().presets);
    const presets = now.filter((p) => p.id !== id);
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
      if (missed.length) void tell(`次のボードは案件名を変えられませんでした（ほかで更新中など）: ${missed.join('、')}`);
    }),
  resolveConflict: (choice) =>
    void run(async (b) => {
      const mine = get().doc;
      if (choice === 'overwrite') {
        await b.save(mine, true);
        stored = mine;
        // Edits made while it was being written go out after it.
        if (get().doc !== mine) {
          set({ saving: 'saving' });
          return void persist(get().doc);
        }
        return set({ saving: 'saved' });
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
        const doc = await switchTo(b, boardId);
        if (!doc || doc === 'stayed' || doc === 'superseded') return;
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
    // A deleted fellow of the project is no longer written to when something shared changes.
    set({ boards, others: get().others.filter((d) => d.id !== id) });
    if (id !== get().doc.id) return;
    let next: Doc | null = null;
    for (const info of boards) if ((next = await tryLoad(b, info.id))) break;
    if (next) return show(next);
    next = emptyDoc();
    show(next);
    await persist(next);
  }),
}));

/** Deleted boards that can be put back (none before storage is connected). */
export const deletedBoards = async (): Promise<TrashedBoard[]> => (backend ? backend.trash() : []);

/** Put a deleted board back and open it. Throws, in words for the user, when it cannot be. */
export async function restoreBoard(key: string): Promise<void> {
  if (!backend) return;
  const id = await backend.restore(key);
  useStore.setState({ boards: await backend.list() });
  useStore.getState().openBoard(id);
}

/** Run a storage action; a failure is said, and marks the board unsaved only if it is. */
async function run(fn: (b: Backend) => Promise<void>): Promise<void> {
  if (!backend) return;
  try {
    await fn(backend);
  } catch (e) {
    // Written elsewhere since it was read here: the user settles it (see resolveConflict).
    if (e instanceof Conflict) return void enterConflict('conflict');
    console.error(e);
    // Something done alongside the board (a preset, a state of its history, opening another)
    // failed: said so, without calling a board that is saved unsaved.
    if (useStore.getState().doc !== stored) useStore.setState({ saving: 'error' });
    void tell(`うまくいきませんでした: ${e instanceof Error ? e.message : String(e)}`);
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
  })()
    // Not kept after all (the board not yet written, storage full …): tried again at the next edit.
    .catch((e) => {
      if (snapBase === base) baseKept = false;
      throw e;
    })
    .finally(() => (keeping = null));
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

/**
 * Start the open board's session afresh: what was last written, the base of its history, and no
 * save, retry or keeping pending from the board before (whatever was wrong with that one is not
 * this one's). Every module-level piece of the session is reset here, and only here.
 */
function resetSession(doc: Doc, shown: Doc): void {
  stored = doc;
  live = null;
  clearTimeout(timer);
  clearTimeout(retryTimer);
  retries = 0;
  snapBase = shown;
  baseKept = false;
  keeping = null;
  clearTimeout(settleTimer);
}

/**
 * Boards left for another tab in this window: their undo steps and where they were looked at, for
 * coming back to them. They are taken up again only if the board is still the drawing it was
 * (not changed meanwhile from the command line, say), where those steps still apply.
 */
const kept = new Map<string, { past: Doc[]; future: Doc[]; view: View; print: string }>();

/** Put a freshly loaded (or created) board on screen. */
function show(doc: Doc): void {
  // The base is the board as shown (legends fitted), so fitting alone never reads as an edit.
  const shown = fitLegends(doc);
  resetSession(doc, shown);
  const back = kept.get(doc.id);
  kept.delete(doc.id);
  const same = !!back && back.print === fingerprint(shown);
  useStore.setState({ doc: shown, viewing: null, past: same ? back.past : [], future: same ? back.future : [], selection: [], editing: null, others: [], placing: null, saving: 'saved' });
  showInUrl(doc.id);
  if (same) useStore.setState({ view: back.view });
  else requestAnimationFrame(useStore.getState().fit);
  void readProject();
}

/** Bring a part of the board to the middle of the view, zooming in if it would be too small to read. */
export function showRect(r: Rect): void {
  const { view } = useStore.getState();
  const el = document.getElementById('canvas');
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const fits = Math.min((width - 120) / Math.max(1, r.w), (height - 120) / Math.max(1, r.h));
  const k = Math.min(Math.max(view.k, 0.8), Math.max(fits, 0.2), 1.5);
  useStore.setState({ view: { k, x: width / 2 - (r.x + r.w / 2) * k, y: height / 2 - (r.y + r.h / 2) * k } });
}

/**
 * Bring things (nodes, or lines by their two ends) into view when any of them is out of it: the
 * view moves to centre them, at the same zoom. Already in view, nothing moves.
 */
export function reveal(ids: string[]): void {
  const { doc, view } = useStore.getState();
  const want = new Set(ids);
  for (const e of doc.edges) if (want.has(e.id)) want.add(e.from.node).add(e.to.node);
  const rects = doc.nodes.filter((n) => want.has(n.id)).map(nodeRect);
  const el = document.getElementById('canvas');
  if (!rects.length || !el) return;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  const { width, height } = el.getBoundingClientRect();
  const inView = x0 * view.k + view.x >= 0 && y0 * view.k + view.y >= 0 && x1 * view.k + view.x <= width && y1 * view.k + view.y <= height;
  if (inView) return;
  useStore.setState({ view: { ...view, x: width / 2 - ((x0 + x1) / 2) * view.k, y: height / 2 - ((y0 + y1) / 2) * view.k } });
}

export function centerOn(nodeId: string): void {
  const { doc, view } = useStore.getState();
  const n = doc.nodes.find((x) => x.id === nodeId);
  const el = document.getElementById('canvas');
  if (!n || !el) return;
  const r = nodeRect(n);
  const { width, height } = el.getBoundingClientRect();
  useStore.setState({ view: { ...view, x: width / 2 - (r.x + r.w / 2) * view.k, y: height / 2 - (r.y + r.h / 2) * view.k } });
}

/**
 * Writes go out one after another. Two at once would both be made on the same version of the
 * board, and the second be refused as if the board had been changed elsewhere.
 */
let writing: Promise<void> = Promise.resolve();
/** Writes sent and not yet answered. */
let inFlight = 0;
function persist(doc: Doc): Promise<void> {
  inFlight++;
  const next = writing.then(() => write(doc)).finally(() => inFlight--);
  writing = next.catch(() => {});
  return next;
}

/**
 * A write that failed for no lasting reason (the folder busy with another writer, the dev server
 * restarting, a moment offline) is tried again a little later, longer each time, until one goes
 * through. Refusals the user has to settle (conflict, gone) are left to them.
 */
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];
let retryTimer = 0;
let retries = 0;
function retryLater(): void {
  clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    const s = useStore.getState();
    if (s.saving === 'error' && s.ready && !s.viewing && s.doc !== stored) void persist(s.doc);
  }, RETRY_MS[Math.min(retries++, RETRY_MS.length - 1)]);
}

/**
 * The board was written or deleted elsewhere since it was read here: nothing more goes out until the
 * user settles it (see resolveConflict), not even a save already waiting to fire.
 */
function enterConflict(kind: 'conflict' | 'gone'): void {
  clearTimeout(timer);
  useStore.setState({ saving: kind });
}

async function write(doc: Doc): Promise<void> {
  if (!backend) return;
  // A write left over from a board no longer on screen goes out, but says nothing about this one.
  const here = () => useStore.getState().doc.id === doc.id;
  // Once the board is in conflict, only the user's choice writes it (a save queued before goes nowhere).
  const held = useStore.getState().saving;
  if (here() && (held === 'conflict' || held === 'gone')) return;
  if (here()) useStore.setState({ saving: 'saving' });
  try {
    await backend.save(doc);
    stored = doc;
    retries = 0;
    clearTimeout(retryTimer);
    const info: BoardInfo = { id: doc.id, title: doc.meta.title, updated: Date.now(), project: doc.meta.project || undefined, kind: doc.kind };
    useStore.setState((s) => ({ boards: [info, ...s.boards.filter((x) => x.id !== doc.id)], ...(here() ? { saving: s.doc === doc ? 'saved' : 'saving', saveError: null } : {}) }));
  } catch (e) {
    if (!here()) return console.error(e);
    // Written or deleted elsewhere since it was read here: the user settles it (see resolveConflict).
    if (e instanceof Conflict) return void enterConflict('conflict');
    if (e instanceof Gone) return void enterConflict('gone');
    console.error(e);
    useStore.setState({ saving: 'error', saveError: e instanceof Error ? e.message : String(e) });
    retryLater();
  }
}

/** ⌘S, or "もう一度" after a failed write: what is pending is written now (it is otherwise written by itself). */
export async function saveNow(): Promise<void> {
  clearTimeout(retryTimer);
  retries = 0;
  const s = useStore.getState();
  const pending = s.doc !== stored;
  if (s.saving === 'error' && s.ready && !s.viewing && pending) await persist(s.doc).catch(() => {});
  else await flush();
  if (useStore.getState().saving === 'saved') say(pending ? '保存しました' : '保存済みです（変更は自動で保存されます）');
}

let noticeTimer = 0;
/** Show a short word for a moment. */
export function say(text: string): void {
  clearTimeout(noticeTimer);
  useStore.setState({ notice: text });
  noticeTimer = window.setTimeout(() => useStore.setState({ notice: null }), 4000);
}

/** Write any pending change now (before switching boards or leaving the page); whether it is all written. */
async function flush(): Promise<boolean> {
  clearTimeout(timer);
  if (pushTimer !== undefined) await pushOut().catch(() => {});
  const { doc, ready, viewing, saving } = useStore.getState();
  // An old revision on screen is never written over the live board, nor a conflict settled unasked.
  if (ready && !viewing && saving !== 'conflict' && saving !== 'gone' && doc !== stored) await persist(doc);
  else await writing;
  const s = useStore.getState();
  return !!s.viewing || !s.ready || (s.doc === stored && s.saving !== 'conflict' && s.saving !== 'gone' && s.saving !== 'error');
}

/** The latest request to open a board: an earlier one that finishes later is dropped. */
let opening = 0;

/** Leave the board on screen: its state kept in the history, its changes written (or let go). */
async function leave(b: Backend): Promise<boolean> {
  await quietly(() => settle(b));
  return mayLeave();
}

/**
 * Leave the board on screen for another and read that one in: the board, or null when it cannot
 * be read; 'stayed' when the user kept the one on screen, 'superseded' when another board was
 * asked for meanwhile (that one is shown, not this).
 */
async function switchTo(b: Backend, id: string): Promise<Doc | null | 'stayed' | 'superseded'> {
  const ticket = ++opening;
  if (!(await leave(b))) return 'stayed';
  const doc = await tryLoad(b, id);
  return ticket === opening ? doc : 'superseded';
}

/**
 * Whether the board on screen may be left: its changes written, or the user choosing to let go of
 * those that cannot be (changed or deleted elsewhere, or the store unreachable).
 */
async function mayLeave(): Promise<boolean> {
  if (await flush()) return true;
  const saving = useStore.getState().saving;
  if (saving === 'conflict') {
    await tell('このボードはほかの場所で更新されています。先に上の「読み込む」か「この画面で上書き」を選んでください。');
    return false;
  }
  const why = saving === 'gone' ? 'このボードはほかの場所で削除されています。' : 'このボードの変更を保存できていません。';
  return ask(`${why}\n保存されていない変更を捨てて、切り替えますか？`);
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

/** Boards read as they are stored, by id (those not found left out): what the project's export takes beside `others`. */
export async function loadBoards(ids: string[]): Promise<Doc[]> {
  const b = backend;
  if (!b) return [];
  const docs = await Promise.all(ids.map((id) => b.load(id).catch(() => null)));
  return docs.filter((d): d is Doc => !!d);
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
    void tell(`「${target.boardTitle}」に書き込めませんでした。少し待ってからもう一度試してください。`);
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
      // Read anew, so as not to write over a change made to it elsewhere meanwhile; one deleted
      // elsewhere is left deleted.
      const fresh = await b.load(d.id);
      if (!fresh) continue;
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
  if (!s.ready || s.viewing || s.doc === prev.doc || s.doc === stored || s.saving === 'conflict' || s.saving === 'gone') return;
  clearTimeout(timer);
  if (s.saving !== 'saving') useStore.setState({ saving: 'saving' });
  timer = window.setTimeout(() => void persist(useStore.getState().doc), 500);
});

/** Store a picture for the current board; returns the `src` an image node should keep. */
export async function storeImage(dataUrl: string): Promise<string> {
  if (!backend || !backend.assets) return dataUrl;
  // The board's folder must exist before a picture can go into it.
  if (!useStore.getState().boards.some((b) => b.id === useStore.getState().doc.id)) await flush();
  return backend.putAsset(useStore.getState().doc.id, dataUrl);
}

/** A board read, or nothing when it cannot be (gone, or its file broken): one bad board never stops the rest. */
async function tryLoad(b: Backend, id: string): Promise<Doc | null> {
  try {
    return await b.load(id);
  } catch (e) {
    console.warn(`[keito] ${id}: could not be read`, e);
    return null;
  }
}

/** First run against the on-disk store: carry over the boards this browser was keeping. */
async function migrate(b: Backend): Promise<void> {
  if (b.mode !== 'server' || localStorage.getItem('keito:migrated')) return;
  const have = new Set((await b.list()).map((x) => x.id));
  for (const doc of localBoards()) {
    // One that cannot be carried over (an id the folder cannot take …) stays in the browser.
    if (!have.has(doc.id)) await b.save(await externalize(doc, b)).catch((e) => console.warn(`[keito] ${doc.meta.title}: not carried over`, e));
  }
  // The browser copies are left in place as a backup.
  localStorage.setItem('keito:migrated', new Date().toISOString());
}

/**
 * Connect to storage and load the board named in the URL (or the last one used). The desktop app
 * hands in its own store; in a browser it is found (see connect).
 */
export async function boot(given?: Backend): Promise<void> {
  try {
    backend = await connect(given);
    await migrate(backend);
    let boards = await backend.list();
    const wanted = boardInUrl() ?? localStorage.getItem(CURRENT);
    let doc = wanted ? await tryLoad(backend, wanted) : null;
    for (const info of boards) {
      if (doc) break;
      doc = await tryLoad(backend, info.id);
    }
    // Boards there, and none of them could be read: never taken for a first run (the sample project
    // would be written in among them). The page says so and stays empty until reloaded.
    if (!doc && boards.length) throw new Error(`ボードを ${boards.length} 枚見つけましたが、どれも読み込めませんでした`);
    // A first run: the sample project, opened on its system diagram.
    if (!doc) {
      const docs = sampleBoards();
      for (const d of [...docs].reverse()) await backend.save(d);
      doc = docs[0];
      boards = await backend.list();
    }
    useStore.setState({ boards, mode: backend.mode, ready: true, presets: await backend.loadPresets().catch(() => []) });
    listen(backend);
    show(doc);
  } catch (e) {
    console.error(e);
    useStore.setState({ ready: true, saving: 'error' });
    void tell(`ボードを開けませんでした: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Following a link or the back button to another board.
window.addEventListener('hashchange', () => {
  const id = boardInUrl();
  if (id && useStore.getState().ready) useStore.getState().openBoard(id);
});

/** Whether two copies of a board say the same, whatever version number each was written at. */
const sameBoard = (a: Doc | null, b: Doc | null): boolean => !!a && !!b && JSON.stringify({ ...a, serial: undefined }) === JSON.stringify({ ...b, serial: undefined });

/** Take in the board as another writer left it, if nothing here is waiting to be saved. */
async function pickUp(b: Backend): Promise<void> {
  const s = useStore.getState();
  if (!s.ready || s.viewing) return;
  // Unsaved edits here (or text being typed) and a change on disk: the user decides which stays.
  if (s.editing || s.doc !== stored) return void enterConflict('conflict');
  const fresh = await b.load(s.doc.id);
  if (!fresh) return;
  // Reading it took the version on disk as the one to write on next. Something changed here
  // meanwhile must not go out over a change made elsewhere: the user decides which stays. (When the
  // disk holds what this page last wrote, there is nothing to decide.)
  if (useStore.getState().doc !== s.doc) return void (sameBoard(fresh, stored) ? undefined : enterConflict('conflict'));
  if (sameBoard(fresh, s.doc)) return;
  stored = fresh;
  const shown = fitLegends(fresh);
  // The board as written elsewhere is the new base; it goes into the history at the next edit here.
  adopt(shown, () => {
    // The history was made on the version just replaced: undoing into it would write that old
    // version back over what was saved elsewhere. It starts over from the version read in.
    const keep = (id: string) => fresh.nodes.some((n) => n.id === id) || fresh.edges.some((e) => e.id === id);
    useStore.setState({ doc: shown, selection: s.selection.filter(keep), past: [], future: [] });
  });
  pullIn();
}

// Coming back to the tab: pick up what another tab (or an edit to the file) saved meanwhile.
window.addEventListener('focus', () => {
  const s = useStore.getState();
  // Coming back with nothing unsaved: just look. A conflict is only claimed when something changed.
  if (s.ready && !s.viewing && !s.editing && s.doc === stored) void run(pickUp);
  // Other boards may have changed too (another tab, browser storage has no events): new ones,
  // other titles or projects for the tabs, and the project's boards themselves.
  if (s.ready && !s.viewing)
    void run(async (b) => {
      useStore.setState({ boards: await b.list() });
      await readProject();
    });
});

/**
 * Hear about boards written elsewhere (the command line, an edit to the file) as it happens: the
 * open board is read in again, and the list of boards follows new ones and new titles.
 */
function listen(b: Backend): void {
  b.watch?.((news) => {
    // Its own writes this page knows already.
    if (news.writer === WRITER) return;
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
  });
}

const unsaved = (): Doc | null => {
  const { doc, ready, viewing } = useStore.getState();
  return ready && !viewing && doc !== stored ? doc : null;
};

/**
 * Write what is unsaved now, before the app is closed: whether it all went (the desktop app waits
 * for this before letting its window go).
 */
export const flushBeforeClose = (): Promise<boolean> => flush();

// Closing within the autosave delay: what the store can take as the page goes is written then
// (see pagehide); a board it cannot, or changes that cannot be written at all (changed or deleted
// elsewhere, a failed write), make the browser ask before they are lost.
window.addEventListener('beforeunload', (e) => {
  const doc = unsaved();
  if (!doc || !backend) return;
  const stuck = ['conflict', 'gone', 'error'].includes(useStore.getState().saving);
  // A write still under way: the one sent on leaving would be made on the version before it and be
  // refused, the last edits lost. The page asks, and finishes writing meanwhile.
  if (!stuck && !inFlight && backend.fitsExitSave(doc)) return;
  if (!stuck) void flush();
  e.preventDefault();
  e.returnValue = '';
});

window.addEventListener('pagehide', () => {
  const doc = unsaved();
  if (!doc || !backend || ['conflict', 'gone'].includes(useStore.getState().saving)) return;
  backend.exitSave(doc);
});

/** What was copied, and from which board (and project). */
let clipboard: { nodes: Node[]; edges: Edge[]; board: string; project: string } | null = null;

/** Copy the selected nodes (and the lines between them); false when no node is selected. */
export function copySelection(): boolean {
  const { doc, selection } = useStore.getState();
  const ids = new Set(selection);
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  if (!nodes.length) return false;
  clipboard = { nodes, edges: doc.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node)), board: doc.id, project: doc.meta.project?.trim() ?? '' };
  return true;
}

/**
 * Copies of the given nodes, and the lines between them, right on top of them and selected: what
 * an Alt-drag moves away, leaving the originals. The clipboard is left alone, and the caller keeps
 * the undo step (the drag's). Says which copy is which: node and line ids, old → new.
 */
export function duplicateInPlace(ids: string[]): Map<string, string> {
  const s = useStore.getState();
  const keep = new Set(ids);
  const taken = allIds(s.doc);
  const map = new Map<string, string>();
  // A copy on its own board is another thing: the second PC is not the first.
  const nodes = s.doc.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => {
      const id = freshId(taken, n.id.replace(/\d+$/, '') || 'n');
      map.set(n.id, id);
      return { ...n, id, ...('shared' in n ? { shared: undefined, sharedAt: undefined } : {}) } as Node;
    });
  const edges = s.doc.edges
    .filter((e) => keep.has(e.from.node) && keep.has(e.to.node))
    .map((e) => {
      const id = freshId(taken, 'e');
      map.set(e.id, id);
      return { ...e, id, from: { ...e.from, node: map.get(e.from.node)! }, to: { ...e.to, node: map.get(e.to.node)! } };
    });
  s.mutate((d) => ({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] }), false);
  s.select(nodes.map((n) => n.id));
  return map;
}

/**
 * ⌘D: copies of the selected nodes (and the lines between them) a little down and right, selected,
 * as one step. The clipboard is left alone: what ⌘C copied is still what ⌘V pastes, and with no
 * node selected nothing happens (rather than pasting whatever was copied before).
 */
export function duplicateSelection(offset = 30): void {
  const s = useStore.getState();
  const ids = s.selection.filter((id) => s.doc.nodes.some((n) => n.id === id));
  if (!ids.length) return;
  s.checkpoint();
  const map = duplicateInPlace(ids);
  const copies = new Set(map.values());
  s.mutate((d) => ({
    ...d,
    nodes: d.nodes.map((n) => (copies.has(n.id) ? { ...n, x: n.x + offset, y: n.y + offset } : n)),
    edges: d.edges.map((e) => (copies.has(e.id) && e.route ? { ...e, route: e.route.map((p) => ({ x: p.x + offset, y: p.y + offset })) } : e)),
  }), false);
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
