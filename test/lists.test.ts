import { describe, expect, it } from 'vitest';
import { cableIds, checkTable, editCell, editable, equipmentTable, powerLoads } from '../src/model/lists';
import type { DeviceNode, Doc } from '../src/model/types';
import { blank, sample } from './helpers';

const device = (id: string, text: string, ports: DeviceNode['ports'] = [], p: Partial<DeviceNode> = {}): DeviceNode => ({ id, type: 'device', x: 0, y: 0, w: 160, h: 0, text, maker: 'M', model: 'X1', category: '映像', note: '', ports, ...p });

describe('equipment list', () => {
  it('puts a price typed on a row on every device of that row', () => {
    const d: Doc = { ...blank(), nodes: [device('d1', 'ディスプレイ'), device('d2', 'ディスプレイ')] };
    const t = equipmentTable(d);
    const row = t.rows.findIndex((r) => r.includes('ディスプレイ'));
    const col = t.head.indexOf('単価(円)');
    const next = editCell(d, editable(t, row, col)!, t.refs[row], '12000');
    expect(next.nodes.map((n) => (n as DeviceNode).price)).toEqual([12000, 12000]);
    const after = equipmentTable(next);
    expect(after.rows[row][after.head.indexOf('金額(円)')]).toBe('24000');
  });

  it("does not take a quantity on a row that stands for several boxes", () => {
    const d: Doc = { ...blank(), nodes: [device('d1', 'ディスプレイ'), device('d2', 'ディスプレイ')] };
    const t = equipmentTable(d);
    const row = t.rows.findIndex((r) => r.includes('ディスプレイ'));
    expect(editable(t, row, t.head.indexOf('数量'))).toBeNull();
  });
});

describe('cables', () => {
  it('numbers cables by type, the new types included', () => {
    const d: Doc = {
      ...blank(),
      nodes: [device('a', 'A', [{ id: 'o', name: 'REF OUT', side: 'right', signal: 'sync' }]), device('b', 'B', [{ id: 'i', name: 'REF IN', side: 'left', signal: 'sync' }])],
      edges: [{ id: 'e1', from: { node: 'a', port: 'o' }, to: { node: 'b', port: 'i' }, signal: 'sync', label: '', length: 3, arrow: 'none', note: '' }],
    };
    expect(cableIds(d).get('e1')).toBe('SYNC-01');
  });

  it('flags a fibre cable plugged into a video port', () => {
    const d: Doc = {
      ...blank(),
      nodes: [device('tx', '光TX', [{ id: 'o', name: 'FIBER', side: 'right', signal: 'fiber' }]), device('pj', 'PJ', [{ id: 'i', name: 'HDMI', side: 'left', signal: 'video' }])],
      edges: [{ id: 'e1', from: { node: 'tx', port: 'o' }, to: { node: 'pj', port: 'i' }, signal: 'fiber', label: '', length: 30, arrow: 'none', note: '' }],
    };
    expect(checkTable(d).rows.some((r) => r.includes('種別の不一致'))).toBe(true);
  });

  it('finds nothing wrong in the type of the sample board', () => {
    expect(checkTable(sample()).rows.some((r) => r.includes('種別の不一致'))).toBe(false);
  });
});

describe('power', () => {
  const ac = (side: 'left' | 'right', id = side === 'left' ? 'in' : 'out') => ({ id, name: id, side, signal: 'power' });
  const cord = (id: string, from: string, fromPort: string, to: string) => ({ id, from: { node: from, port: fromPort }, to: { node: to, port: 'in' }, signal: 'power', label: '', length: null, arrow: 'none' as const, note: '' });
  // UPS 300W: two speakers (x2, 100W each) directly, two 250W projectors through a power strip.
  const board = (): Doc => ({
    ...blank(),
    nodes: [
      device('ups', 'UPS', [ac('right', 'o1'), ac('right', 'o2')], { capacity: 300 }),
      device('sp', 'スピーカー x2', [ac('left')], { watts: 100 }),
      device('tap', '電源タップ', [ac('left'), ac('right', 'o1'), ac('right', 'o2')]),
      device('pj1', 'プロジェクター', [ac('left')], { watts: 250 }),
      device('pj2', 'プロジェクター', [ac('left')], { watts: 250 }),
    ],
    edges: [cord('e1', 'ups', 'o1', 'sp'), cord('e2', 'ups', 'o2', 'tap'), cord('e3', 'tap', 'o1', 'pj1'), cord('e4', 'tap', 'o2', 'pj2')],
  });

  it('counts every unit and what is fed through a strip', () => {
    const loads = powerLoads(board());
    expect(loads.get('ups')).toMatchObject({ watts: 700, over: true });
    expect(loads.get('tap')).toMatchObject({ watts: 500 });
    expect(checkTable(board()).rows.some((r) => r.includes('給電容量の超過'))).toBe(true);
  });

  it('follows a loop of power lines only once', () => {
    const d = board();
    d.edges.push(cord('e5', 'pj1', 'in', 'ups'));
    expect(powerLoads(d).get('ups')?.watts).toBe(700);
  });
});

describe('figures typed into a list', () => {
  const one = (): Doc => ({ ...blank(), nodes: [device('d1', 'ディスプレイ')] });
  const typed = (col: string, raw: string) => {
    const d = one();
    const t = equipmentTable(d);
    const row = t.rows.findIndex((r) => r.includes('ディスプレイ'));
    const next = editCell(d, editable(t, row, t.head.indexOf(col))!, t.refs[row], raw);
    return next.nodes[0] as DeviceNode;
  };

  it('reads prices as they are written in Japanese', () => {
    expect(typed('単価(円)', '120,000').price).toBe(120000);
    expect(typed('単価(円)', '¥3,500').price).toBe(3500);
    expect(typed('単価(円)', '３５００円').price).toBe(3500);
  });

  it('takes a quantity only as a whole number of units', () => {
    expect(typed('数量', '3').qty).toBe(3);
    expect(typed('数量', '2.6').qty).toBe(3);
    expect(typed('数量', '0').qty).toBeUndefined();
    expect(typed('数量', '-3').qty).toBeUndefined();
  });
});
