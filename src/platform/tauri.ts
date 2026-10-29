import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask as askDialog, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { boardKind, readBoard, readSerial } from '../model/load';
import { boot, flushBeforeClose, useStore } from '../model/store';
import { upgradePreset } from '../model/video';
import type { Doc, UserPreset } from '../model/types';
import { type Platform, usePlatform } from './io';
import { type Backend, type BoardInfo, type BoardNews, Conflict, Gone, type TrashedBoard, WRITER, assetOf } from './storage';

/**
 * The desktop app (Tauri): boards in a folder on this machine through the app's own commands
 * (src-tauri/src/commands.rs), and the system's own dialogs, browser and files.
 */

/** Pictures in a board's folder, as the app serves them (Windows reaches custom schemes over http). */
const ASSETS = navigator.userAgent.includes('Windows') ? 'http://keito-asset.localhost/' : 'keito-asset://localhost/';

// The version of each board on disk as this page last read or wrote it.
const serials = new Map<string, number>();

/** A refusal from the app's write, as the page's own errors. */
function refusal(e: unknown): Error {
  const said = String(e);
  if (said.startsWith('conflict:')) return new Conflict(Number(said.slice('conflict:'.length)) || 0);
  if (said === 'gone') return new Gone();
  return new Error(said);
}

const desktop: Backend = {
  // Boards are kept in files on this machine, as with the dev server.
  mode: 'server',
  assets: true,
  list: async () => (await invoke<BoardInfo[]>('list_boards')).map((b) => ({ ...b, kind: boardKind(b.kind) })),
  load: async (id) => {
    const text = await invoke<string | null>('load_board', { id });
    if (text == null) return null;
    const raw = JSON.parse(text);
    serials.set(id, readSerial(raw?.serial));
    return readBoard(raw);
  },
  save: async (doc, force) => {
    const known = serials.get(doc.id);
    try {
      // Written on the version read; a board never read here (just made) has nothing to check.
      const done = await invoke<{ serial: number }>('save_board', { doc, base: force || known === undefined ? null : known, writer: WRITER });
      serials.set(doc.id, done.serial);
    } catch (e) {
      throw refusal(e);
    }
  },
  serialOf: (id) => serials.get(id),
  remove: (id) => invoke('remove_board', { id }),
  trash: async () => (await invoke<TrashedBoard[]>('trashed_boards')).map((t) => ({ ...t, kind: boardKind(t.kind) })),
  restore: async (key) => {
    try {
      return await invoke<string>('restore_board', { key });
    } catch (e) {
      throw new Error(String(e));
    }
  },
  putAsset: async (boardId, dataUrl) => {
    const picture = await assetOf(dataUrl);
    if (!picture) return dataUrl;
    await invoke('put_asset', new Uint8Array(await picture.blob.arrayBuffer()), { headers: { board: boardId, name: picture.name } });
    return `asset:${picture.name}`;
  },
  saveRevision: (board, id, doc) => invoke('save_revision', { board, id, doc }),
  loadRevision: async (board, id) => {
    const text = await invoke<string | null>('load_revision', { board, id });
    return text == null ? null : readBoard(JSON.parse(text));
  },
  removeRevision: (board, id) => invoke('remove_revision', { board, id }),
  loadPresets: async () => {
    const v = JSON.parse(await invoke<string>('load_presets'));
    return Array.isArray(v) ? (v as UserPreset[]).map(upgradePreset) : [];
  },
  savePresets: (list) => invoke('save_presets', { list }),
  watch: (news) => {
    let stop: (() => void) | null = null;
    let stopped = false;
    void listen<BoardNews>('board-changed', (e) => news(e.payload)).then((unlisten) => (stopped ? unlisten() : (stop = unlisten)));
    return () => {
      stopped = true;
      stop?.();
    };
  },
  assetUrl: (boardId, src) => (src.startsWith('asset:') ? `${ASSETS}${boardId}/${src.slice('asset:'.length)}` : src),
  // The window waits for the last write as it closes (see below), so nothing is left to the last moment.
  fitsExitSave: () => true,
  exitSave: (doc: Doc) => void desktop.save(doc).catch(() => {}),
};

/** The kinds of file a picker shows, from an <input accept> list (".xlsx,.json" or "image/*"). */
function filters(accept: string): { name: string; extensions: string[] }[] {
  const extensions = accept
    .split(',')
    .map((x) => x.trim())
    .flatMap((x) => (x.startsWith('.') ? [x.slice(1)] : x === 'image/*' ? ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] : []));
  return extensions.length ? [{ name: extensions.join(', '), extensions }] : [];
}

const MIME: Record<string, string> = { json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

const system: Platform = {
  async saveFile(name, data, type, exported) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
    // The app shows the dialog: only a place the user picks there can be written.
    const path = await invoke<string | null>('pick_save', { name, extensions: ext ? [ext] : [], downloads: !!exported });
    if (!path) return false;
    const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
    await invoke('write_file', new Uint8Array(await blob.arrayBuffer()), { headers: { path: encodeURIComponent(path) } });
    return true;
  },
  async pickFile(accept) {
    const path = await invoke<string | null>('pick_open', { extensions: filters(accept).flatMap((f) => f.extensions) });
    if (typeof path !== 'string') return null;
    const bytes = await invoke<ArrayBuffer>('read_file', { path });
    const name = path.split(/[\\/]/).pop() ?? 'file';
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    return new File([bytes], name, { type: MIME[ext] ?? '' });
  },
  ask: (text) => askDialog(text, { title: 'keito', kind: 'warning', okLabel: 'はい', cancelLabel: 'いいえ' }),
  tell: async (text) => void (await message(text, { title: 'keito', okLabel: 'OK' })),
  openLink: (url) => void openUrl(url).catch(() => system.tell(`このリンクは開けませんでした。\n\n${url}`)),
  ownsLinks: true,
  // The webview's own clipboard works from within a click.
  copyText: (text) => navigator.clipboard.writeText(text),
  copyPng: (png) => navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]),
  boardsFolder: {
    where: async () => {
      const folder = await invoke<Folder>('boards_folder');
      return { path: folder.path, fixed: folder.source === 'env' || folder.source === 'config' };
    },
    // The page starts over on the new folder, its boards and all.
    change: async () => {
      if (!(await chooseFolder())) return false;
      location.reload();
      return true;
    },
  },
  // The app prints the page itself into the file picked, with no print dialog.
  async print(html, name, paper) {
    const path = await invoke<string | null>('pick_save', { name: `${name}.pdf`, extensions: ['pdf'], downloads: true });
    if (!path) return '';
    await invoke('save_pdf', { path, html, paper });
    return 'PDF を保存しました。';
  },
};

/** Where boards are kept, as the app knows it: the folder, and who named it. */
interface Folder {
  path: string;
  source: 'env' | 'config' | 'chosen' | 'default';
}

/** Ask for another folder for boards and keep them there from now on; false when called off. */
async function chooseFolder(): Promise<boolean> {
  const picked = await invoke<string | null>('pick_folder');
  if (typeof picked !== 'string') return false;
  await invoke('set_boards_folder', { path: picked });
  return true;
}

/**
 * On first launch, the user says where boards go: the documents folder's "keito" as offered, or a
 * folder of their own (one shared with the command line, a synced drive …).
 */
async function settleFolder(): Promise<void> {
  const folder = await invoke<Folder>('boards_folder');
  if (folder.source !== 'default') return;
  const offered = await askDialog(`ボードを保存するフォルダを決めてください。\n\n${folder.path}\n\nあとからメニューの「keito > 設定…」で変えられます。`, { title: 'keito', okLabel: 'このフォルダを使う', cancelLabel: '別の場所を選ぶ…' });
  if (!offered && (await chooseFolder())) return;
  await invoke('set_boards_folder', { path: folder.path });
}

/** Start the desktop app: its ways in, its folder settled, its store connected, and its window closing only once all is written. */
export async function startDesktop(): Promise<void> {
  usePlatform(system);
  // The ways out come first: quitting, closing and reloading work while the folder is still being
  // asked for on first launch, and when starting fails (there is then nothing unsaved to write).
  const leave = async () => {
    if ((await flushBeforeClose()) || (await system.ask('保存できていない変更があります。このまま終了しますか？'))) await invoke('quit');
  };
  void getCurrentWindow().onCloseRequested((e) => {
    e.preventDefault();
    void leave();
  });
  void listen('quit-requested', () => {
    // Heard: a second ⌘Q while this writes does not cut it short.
    void invoke('quit_heard');
    void leave();
  });
  // 表示 > 再読み込み (⌘R): the page starts afresh once what it has is written, as on quitting.
  void listen('reload-requested', async () => {
    if ((await flushBeforeClose()) || (await system.ask('保存できていない変更があります。このまま再読み込みしますか？'))) location.reload();
  });
  // keito > 設定… (⌘,)
  void listen('open-settings', () => useStore.getState().setPanel('settings'));
  try {
    await settleFolder();
    await boot(desktop);
  } catch (e) {
    console.error(e);
    await system.tell(`ボードのフォルダを開けませんでした。\n\n${e instanceof Error ? e.message : String(e)}\n\n表示 > 再読み込み（⌘R）でやり直せます。`);
  }
}
