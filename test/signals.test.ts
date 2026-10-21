import { afterEach, describe, expect, it } from 'vitest';
import { allSignals, groupSignals, isBuiltInSignal, registerSignals, signalOf } from '../src/model/signals';

afterEach(() => registerSignals(undefined));

describe('signal types', () => {
  it('lists cable types by connector, fibre and radio apart', () => {
    const groups = groupSignals(allSignals().filter((s) => s.cable || s.id === 'wireless'));
    expect(groups.map((g) => g.label)).toEqual(['ケーブル（端子の種類）', '光・無線（中身は問わない）', 'その他']);
    expect(groups[0].items.map((s) => s.id)).toContain('sync');
    expect(groups[1].items.map((s) => s.id)).toEqual(['fiber', 'wireless']);
  });

  it("keeps a board's own type over a built-in one added later", () => {
    registerSignals([{ id: 'sync', label: '自前の同期', prefix: 'S', color: '#000000' }]);
    expect(signalOf('sync').label).toBe('自前の同期');
    expect(allSignals().filter((s) => s.id === 'sync')).toHaveLength(1);
    expect(isBuiltInSignal('sync')).toBe(false);
  });

  it('never lets a board redefine an original type', () => {
    registerSignals([{ id: 'video', label: '偽の映像', prefix: 'X', color: '#000000' }]);
    expect(signalOf('video').label).toBe('映像');
    expect(isBuiltInSignal('video')).toBe(true);
  });
});
