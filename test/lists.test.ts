import { describe, expect, it } from 'vitest';
import { bands, cableIds, checkTable, editCell, editable, equipmentTable, powerLoads, powerTable } from '../src/model/lists';
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

describe('venue equipment', () => {
  const board = (): Doc => ({
    ...blank(),
    nodes: [
      device('w1', '会場電源', [{ id: 'o', name: 'AC', side: 'right', signal: 'power' }], { venue: true, capacity: 1500, category: '電源' }),
      device('w2', '会場電源', [{ id: 'o', name: 'AC', side: 'right', signal: 'power' }], { venue: true, capacity: 1500, category: '電源' }),
      device('p1', 'プロジェクター', [{ id: 'ac', name: 'AC', side: 'left', signal: 'power' }], { watts: 560 }),
      device('p2', 'プロジェクター', [{ id: 'ac', name: 'AC', side: 'left', signal: 'power' }], { watts: 560 }),
    ],
    edges: [
      { id: 'e1', from: { node: 'w1', port: 'o' }, to: { node: 'p1', port: 'ac' }, signal: 'power', label: '', length: null, note: '', arrow: 'none' },
      { id: 'e2', from: { node: 'w2', port: 'o' }, to: { node: 'p2', port: 'ac' }, signal: 'power', label: '', length: null, note: '', arrow: 'none' },
    ],
  });

  it('leaves what the venue has off the equipment list, but weighs its load', () => {
    const d = board();
    expect(equipmentTable(d).rows.some((r) => r.includes('会場電源'))).toBe(false);
    expect(powerLoads(d).get('w1')?.watts).toBe(560);
    // Nor does it ask for a price for it.
    const priced = { ...d, nodes: d.nodes.map((n) => (n.id.startsWith('p') ? { ...n, price: 1 } : n)) };
    expect(checkTable(priced).rows.some((r) => r.includes('単価が未入力'))).toBe(false);
  });

  it('tells two power sources of one name apart by where they are', () => {
    const d = board();
    const frames = [
      { id: 'a1', type: 'frame' as const, x: -100, y: -100, w: 400, h: 400, text: 'ブース' },
      { id: 'a2', type: 'frame' as const, x: 400, y: -100, w: 400, h: 400, text: '展示室' },
    ];
    const placed = { ...d, nodes: [...frames, ...d.nodes.map((n) => (n.id === 'w2' ? { ...n, x: 500 } : n))] };
    const sources = new Set(powerTable(placed).rows.map((r) => r[0]));
    expect(sources).toEqual(new Set(['会場電源（ブース）', '会場電源（展示室）']));
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

  it('adds up watts with decimals as typed, not with binary leftovers', () => {
    const d: Doc = {
      ...blank(),
      nodes: [
        device('tap', '電源タップ', [ac('right', 'o1'), ac('right', 'o2'), ac('right', 'o3')], { capacity: 15 }),
        device('a', 'A', [ac('left')], { watts: 2.2 }),
        device('b', 'B', [ac('left')], { watts: 4.4 }),
        device('c', 'C', [ac('left')], { watts: 8.5 }),
      ],
      edges: [cord('e1', 'tap', 'o1', 'a'), cord('e2', 'tap', 'o2', 'b'), cord('e3', 'tap', 'o3', 'c')],
    };
    expect(powerLoads(d).get('tap')?.watts).toBe(15.1);
    const cells = [...powerTable(d).rows, ...checkTable(d).rows, ...equipmentTable(d).rows].flat().join(' ');
    expect(cells).toContain('15.1W / 容量 15W（0.1W 超過）');
    expect(cells).toContain('超過 0.1W');
    expect(cells).not.toMatch(/\d\.\d{6,}/);
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

describe('shaded rows', () => {
  it('shades every other row, the total apart', () => {
    const t = { title: '', head: ['a'], rows: [['1'], ['2'], ['3'], ['4'], ['計']], refs: [[], [], [], [], []], widths: [1], total: true };
    expect([...bands(t)]).toEqual([1, 3]);
    // In the order shown, while a row is being dragged.
    expect([...bands(t, [1, 0, 2, 3, 4])].sort()).toEqual([0, 3]);
  });

  it('shades a power source with its sum as one', () => {
    const rowClass = ['member', 'member', 'subtotal', 'member', 'subtotal', 'member', 'subtotal'];
    const t = { title: '', head: ['a'], rows: rowClass.map(() => ['x']), refs: rowClass.map(() => []), widths: [1], rowClass };
    expect([...bands(t)]).toEqual([3, 4]);
  });
});

describe('cable IDs typed by hand', () => {
  it('are not handed out again by the numbering', () => {
    const d: Doc = {
      ...blank(),
      nodes: [device('a', 'A', [{ id: 'o', name: 'HDMI', side: 'right', signal: 'video' }]), device('b', 'B', [{ id: 'i', name: 'HDMI', side: 'left', signal: 'video' }])],
      edges: [0, 1, 2].map((i) => ({ id: `e${i}`, from: { node: 'a', port: 'o' }, to: { node: 'b', port: 'i' }, signal: 'video', label: '', length: null, note: '', arrow: 'none' as const, ...(i === 0 ? { cableId: 'HDMI-02' } : {}) })),
    };
    const ids = [...cableIds(d).values()];
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('HDMI-02');
  });
});

describe('power and addresses in less usual drawings', () => {
  it('follows power through a junction dot', () => {
    const d: Doc = {
      ...blank(),
      nodes: [
        device('ups', 'UPS', [{ id: 'o', name: 'AC', side: 'right', signal: 'power' }], { capacity: 100 }),
        { id: 'j', type: 'junction', x: 0, y: 0, w: 10, h: 10, text: '' },
        device('a', 'A', [{ id: 'i', name: 'AC', side: 'left', signal: 'power' }], { watts: 80 }),
        device('b', 'B', [{ id: 'i', name: 'AC', side: 'left', signal: 'power' }], { watts: 80 }),
      ],
      edges: [
        { id: 'e1', from: { node: 'ups', port: 'o' }, to: { node: 'j' }, signal: 'power', label: '', length: null, note: '', arrow: 'none' },
        { id: 'e2', from: { node: 'j' }, to: { node: 'a', port: 'i' }, signal: 'power', label: '', length: null, note: '', arrow: 'none' },
        { id: 'e3', from: { node: 'j' }, to: { node: 'b', port: 'i' }, signal: 'power', label: '', length: null, note: '', arrow: 'none' },
      ],
    };
    expect(powerLoads(d).get('ups')).toMatchObject({ watts: 160, over: true });
  });

  it('does not call two devices set to DHCP a clash of addresses', () => {
    const d: Doc = { ...blank(), nodes: [device('a', 'A', [], { ip: 'DHCP' }), device('b', 'B', [], { ip: 'DHCP' })] };
    expect(checkTable(d).rows.some((r) => r.join(' ').includes('重複'))).toBe(false);
  });
});

describe('WebSocket on an HTTPS port', () => {
  it('is not a mismatch: one listener takes both', () => {
    const d: Doc = {
      ...blank(),
      kind: 'software',
      nodes: [device('b', 'ブラウザ', [{ id: 'o', name: 'WSS', side: 'right', signal: 'websocket' }]), device('lb', 'ALB', [{ id: 'i', name: 'HTTPS', side: 'left', signal: 'http' }])],
      edges: [{ id: 'e', from: { node: 'b', port: 'o' }, to: { node: 'lb', port: 'i' }, signal: 'websocket', label: '', length: null, note: '', arrow: 'end' }],
    };
    expect(checkTable(d).rows.some((r) => r.join(' ').includes('種別の不一致'))).toBe(false);
  });
});
