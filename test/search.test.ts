import { describe, expect, it } from 'vitest';
import { fold, searchDoc } from '../src/model/search';
import { sampleBoards } from '../src/model/sample';

const system = () => sampleBoards()[0];

describe('search on the board', () => {
  it('folds width, case and the joining marks away', () => {
    expect(fold('ＬＡＮ－０３')).toBe('lan03');
    expect(fold('HDBaseT 送信機・1')).toBe('hdbaset送信機1');
  });

  it('finds a cable by its ID however it is typed', () => {
    const doc = system();
    for (const q of ['LAN-03', 'lan03', 'ｌａｎ０３']) expect(searchDoc(doc, q)[0]).toMatchObject({ kind: 'ケーブル', field: 'ケーブル ID', value: 'LAN-03' });
  });

  it('finds a device by its address and says that is what matched', () => {
    const hit = searchDoc(system(), '192.168.10.31')[0];
    expect(hit).toMatchObject({ kind: '機材', field: 'IP', value: '192.168.10.31' });
    expect(hit.name).toContain('プロジェクター');
  });

  it('lists a cable found by its spec with both its ends', () => {
    const hit = searchDoc(system(), 'PJLink')[0];
    expect(hit).toMatchObject({ kind: 'ケーブル', field: 'ラベル', value: 'PJLink' });
    expect(hit.name).toMatch(/^LAN-03 .*PoEスイッチ → プロジェクター/);
  });

  it('finds nothing for nothing', () => {
    expect(searchDoc(system(), '  ')).toEqual([]);
  });
});
