import { describe, expect, it } from 'vitest';
import { cableIds, checkTable, editCell, editable, equipmentTable } from '../src/model/lists';
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
