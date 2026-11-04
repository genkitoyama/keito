import { beforeEach, describe, expect, it, vi } from 'vitest';

// Whether the boards open could all be written, as each press finds it.
const written = vi.hoisted(() => ({ answers: [] as boolean[] }));
vi.mock('../src/model/store', () => ({ flushBeforeClose: async () => written.answers.shift() ?? true }));

import { usePlatform } from '../src/platform/io';
import { RELEASES, type Update, failureWords, offerUpdate, startUpdate, useUpdate } from '../src/platform/update';

/** The user's answers to the questions asked, in turn, and what was asked and opened. */
const user = { answers: [] as boolean[], asked: [] as string[], told: [] as string[], opened: [] as string[] };
usePlatform({
  ask: async (text) => (user.asked.push(text), user.answers.shift() ?? false),
  tell: async (text) => void user.told.push(text),
  openLink: (url) => void user.opened.push(url),
} as Parameters<typeof usePlatform>[0]);

/** An update that records what was done with it, and fails a step when told to. */
function fake(version = '0.2.0', fail: Partial<Record<'download' | 'install' | 'relaunch', number>> = {}) {
  const done: string[] = [];
  const failing = { ...fail };
  const step = (name: 'download' | 'install' | 'relaunch') => {
    done.push(name);
    if ((failing[name] ?? 0) > 0) {
      failing[name]!--;
      throw new Error(`${name} failed`);
    }
  };
  const update: Update = {
    version,
    download: async (progress) => {
      progress(null);
      progress(0.25);
      progress(0.251);
      progress(1);
      step('download');
    },
    install: async () => step('install'),
    relaunch: async () => step('relaunch'),
    close: () => void done.push('close'),
  };
  return { update, done };
}

beforeEach(() => {
  useUpdate.setState({ update: null, phase: 'offered', share: null });
  Object.assign(user, { answers: [], asked: [], told: [], opened: [] });
  written.answers = [];
});

describe('updating the app', () => {
  it('fetches, puts in and starts again on the version offered, once asked', async () => {
    const { update, done } = fake();
    offerUpdate(update);
    const shares: (number | null)[] = [];
    const stop = useUpdate.subscribe((s) => s.phase === 'downloading' && shares.push(s.share));
    user.answers = [true];
    await startUpdate();
    stop();
    expect(done).toEqual(['download', 'install', 'relaunch']);
    expect(user.asked).toHaveLength(1);
    expect(user.asked[0]).toContain('0.2.0 にアップデートしますか');
    // Told in whole percents: 25.1% is no news after 25%, nor an unknown size before the first piece.
    expect(shares).toEqual([null, 0.25, 1]);
    expect(useUpdate.getState().phase).toBe('restarting');
  });

  it('does nothing when the user says no', async () => {
    const { update, done } = fake();
    offerUpdate(update);
    await startUpdate();
    expect(done).toEqual([]);
    expect(useUpdate.getState().phase).toBe('offered');
  });

  it('offers it again after a failed download, and the releases page to update by hand', async () => {
    const { update, done } = fake('0.2.0', { download: 1 });
    offerUpdate(update);
    user.answers = [true, true];
    await startUpdate();
    expect(done).toEqual(['download']);
    expect(useUpdate.getState().phase).toBe('offered');
    expect(user.asked[1]).toContain('download failed');
    expect(user.opened).toEqual([RELEASES]);
  });

  it('waits with the boards unwritten until the next press, without fetching again', async () => {
    const { update, done } = fake();
    offerUpdate(update);
    written.answers = [false];
    user.answers = [true, false];
    await startUpdate();
    expect(done).toEqual(['download']);
    expect(useUpdate.getState().phase).toBe('downloaded');
    // Pressed again ("再起動して 0.2.0 に"), with the boards written this time.
    await startUpdate();
    expect(done).toEqual(['download', 'install', 'relaunch']);
    expect(user.asked).toHaveLength(2);
  });

  it('asks about unwritten changes only once', async () => {
    const { update, done } = fake();
    offerUpdate(update);
    written.answers = [false, false];
    user.answers = [true, true];
    await startUpdate();
    expect(done).toEqual(['download', 'install', 'relaunch']);
    expect(user.asked.filter((q) => q.includes('保存できていない'))).toHaveLength(1);
  });

  it('keeps what was fetched when putting it in fails, for another try', async () => {
    const { update, done } = fake('0.2.0', { install: 1 });
    offerUpdate(update);
    user.answers = [true, false];
    await startUpdate();
    expect(useUpdate.getState().phase).toBe('downloaded');
    expect(user.asked[1]).toContain('アプリケーション');
    await startUpdate();
    expect(done).toEqual(['download', 'install', 'install', 'relaunch']);
  });

  it('says to quit and open the app again when it cannot start again by itself', async () => {
    const { update } = fake('0.2.0', { relaunch: 1 });
    offerUpdate(update);
    user.answers = [true];
    await startUpdate();
    expect(useUpdate.getState().phase).toBe('installed');
    expect(user.told[0]).toContain('開き直す');
  });

  it('takes no second press while one is under way', async () => {
    const { update, done } = fake();
    offerUpdate(update);
    user.answers = [true];
    await Promise.all([startUpdate(), startUpdate()]);
    expect(done).toEqual(['download', 'install', 'relaunch']);
  });
});

describe('offering an update', () => {
  it('keeps the one on offer when the same version is found again', () => {
    const first = fake();
    const again = fake();
    offerUpdate(first.update);
    offerUpdate(again.update);
    expect(useUpdate.getState().update).toBe(first.update);
    expect(again.done).toEqual(['close']);
  });

  it('puts a newer version found later in place of the one on offer', () => {
    const first = fake('0.2.0');
    const newer = fake('0.3.0');
    offerUpdate(first.update);
    offerUpdate(newer.update);
    expect(useUpdate.getState().update).toBe(newer.update);
    expect(first.done).toEqual(['close']);
  });

  it('keeps the one being put in', () => {
    const first = fake('0.2.0');
    const newer = fake('0.3.0');
    offerUpdate(first.update);
    useUpdate.setState({ phase: 'downloaded' });
    offerUpdate(newer.update);
    expect(useUpdate.getState().update).toBe(first.update);
    expect(newer.done).toEqual(['close']);
  });
});

describe('saying how to update by hand', () => {
  it('names the dmg and the Applications folder on macOS', () => {
    const { install, byHand } = failureWords(false);
    expect(install).toContain('「アプリケーション」フォルダ');
    expect(byHand).toContain('dmg');
  });

  it('names the installer on Windows, with keito quit first, and nothing of a Mac', () => {
    const { install, byHand } = failureWords(true);
    expect(install).toContain('インストーラー');
    expect(byHand).toContain('x64-setup.exe');
    expect(byHand).toContain('keito を終了してから');
    expect(install + byHand).not.toMatch(/dmg|アプリケーション/);
  });
});
