import { create } from 'zustand';
import { flushBeforeClose } from '../model/store';
import { ask, openLink, tell } from './io';

/**
 * Updating the app itself, where it can (the desktop app, which hands in what it finds with
 * `offerUpdate`): a newer version is offered in the top bar, and one press fetches it, puts it in
 * place of the app on disk and starts the app again on it, once the boards open are written.
 */

/** A newer version of the app, as the system that updates it hands it over. */
export interface Update {
  version: string;
  /** Fetch it, telling how far along it is (0 to 1, or null while its size is not known). */
  download(progress: (share: number | null) => void): Promise<void>;
  /** Put what was fetched in place of the app on disk. */
  install(): Promise<void>;
  /** Start the app again, on the version put in. */
  relaunch(): Promise<void>;
  /** Let go of it, when another is offered in its place. */
  close(): void;
}

/**
 * How far the update on offer has come: offered, being fetched, fetched (and waiting for the boards
 * to be written), being put in, put in (waiting for the app to start again), starting again.
 */
export type Phase = 'offered' | 'downloading' | 'downloaded' | 'installing' | 'installed' | 'restarting';

export const useUpdate = create<{ update: Update | null; phase: Phase; share: number | null }>(() => ({ update: null, phase: 'offered', share: null }));

/** Where every version can be had by hand, for when updating in the app does not work. */
export const RELEASES = 'https://github.com/genkitoyama/keito/releases/latest';

/** Whether this is the Windows app, put in by its installer (the macOS one is copied out of a dmg). */
const WINDOWS = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

/**
 * What is said when updating in the app fails, as this system's app is put in: on macOS, the app
 * copied from a dmg into the Applications folder (an app opened elsewhere cannot be replaced); on
 * Windows, the installer run (with keito quit first, or the installer closes it unwritten).
 */
export const failureWords = (windows = WINDOWS): { install: string; byHand: string } =>
  windows
    ? {
        install: 'アップデートのインストーラーを起動できませんでした。',
        byHand: 'リリースのページからインストーラー（keito_<バージョン>_x64-setup.exe）をダウンロードし、keito を終了してから実行して入れ替えることもできます。ページを開きますか？',
      }
    : {
        install: 'アップデートを入れられませんでした。「アプリケーション」フォルダに入れた keito を開いているか確かめてください。',
        byHand: 'リリースのページから dmg をダウンロードして入れ替えることもできます。ページを開きますか？',
      };

/** Whether a press is being taken through (asking, writing the boards …). */
let going = false;

const busy = (phase: Phase) => phase === 'downloading' || phase === 'installing' || phase === 'restarting';

/**
 * Offer a newer version, as found. The app looks again from time to time: one already on offer
 * stays (the same version, or any one pressed for), and a newer one found later takes its place.
 */
export function offerUpdate(update: Update): void {
  const { update: offered, phase } = useUpdate.getState();
  if (offered && (offered.version === update.version || phase !== 'offered' || going)) return update.close();
  offered?.close();
  useUpdate.setState({ update, phase: 'offered', share: null });
}

const UNSAVED = '保存できていない変更があります。このまま再起動してアップデートしますか？';

/**
 * Take the update on offer as far as it goes from where it is: asked once, fetched, put in and
 * started again on. The boards open are written first, as on quitting: with changes that cannot be
 * written, the user says whether to go on, and it waits at that step for the next press otherwise.
 */
export async function startUpdate(): Promise<void> {
  const { update, phase } = useUpdate.getState();
  // Pressed again while it asks or writes the boards, it goes on with the press already made.
  if (!update || busy(phase) || going) return;
  going = true;
  try {
    await go(update, phase);
  } finally {
    going = false;
  }
}

async function go(update: Update, phase: Phase): Promise<void> {
  const set = (next: Phase, share: number | null = null) => useUpdate.setState({ phase: next, share });
  if (phase === 'offered') {
    if (!(await ask(`keito ${update.version} にアップデートしますか？\n\nダウンロードが済んだら、ボードを保存してから keito を再起動します。`))) return;
    set('downloading');
    try {
      // The share is told in whole percents: a redraw for each piece fetched is no use to anyone.
      let shown: number | null = null;
      await update.download((share) => {
        const percent = share == null ? null : Math.floor(share * 100);
        if (percent === shown) return;
        shown = percent;
        set('downloading', percent == null ? null : percent / 100);
      });
    } catch (e) {
      set('offered');
      return failed('ダウンロードできませんでした。', e);
    }
    set('downloaded');
  }
  // Agreed once to go on with changes unwritten, it is not asked again before starting again.
  let letGo = false;
  if (useUpdate.getState().phase === 'downloaded') {
    // Written before the app is replaced too: elsewhere than macOS, putting it in quits the app.
    if (!(await flushBeforeClose())) {
      if (!(await ask(UNSAVED))) return;
      letGo = true;
    }
    set('installing');
    try {
      await update.install();
    } catch (e) {
      set('downloaded');
      return failed(failureWords().install, e);
    }
    set('installed');
  }
  // What was changed while it was put in is written too.
  if (!(await flushBeforeClose()) && !letGo && !(await ask(UNSAVED))) return;
  set('restarting');
  try {
    await update.relaunch();
  } catch (e) {
    set('installed');
    return tell(`再起動できませんでした。keito を終了して開き直すと、新しい版になります。\n\n理由: ${reasonOf(e)}`);
  }
}

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Say what went wrong, and offer the page to update by hand from. */
async function failed(what: string, e: unknown): Promise<void> {
  if (await ask(`${what}\n\n理由: ${reasonOf(e)}\n\n${failureWords().byHand}`)) openLink(RELEASES);
}
