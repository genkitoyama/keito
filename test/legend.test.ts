import { describe, expect, it } from 'vitest';
import { deviceRows, legendLayout, legendRows } from '../src/model/legend';
import type { DeviceNode, Doc, LegendNode, Node } from '../src/model/types';
import { blank } from './helpers';

const device = (id: string, p: Partial<DeviceNode> = {}): DeviceNode => ({ id, type: 'device', x: 0, y: 0, w: 160, h: 0, text: id, maker: '', model: '', category: '', note: '', ports: [], ...p });
const legend = (p: Partial<LegendNode> = {}): LegendNode => ({ id: 'lg', type: 'legend', x: 0, y: -400, w: 200, h: 0, text: '凡例', devices: true, ...p });
const board = (nodes: Node[]): Doc => ({ ...blank(), nodes, edges: [{ id: 'e', from: { node: 'a' }, to: { node: 'b' }, signal: 'video', label: '', length: null, note: '', arrow: 'none' }] });
// A colour key drawn by hand: free-standing shapes named after who supplies each colour.
const key = (id: string, color: 'blue' | 'orange', text: string): Node => ({ id, type: 'shape', shape: 'rect', x: 0, y: -600, w: 100, h: 40, text, color, fill: 'tint' });

describe('legend of devices', () => {
  it('names each device colour after the hand-made key, and adds the venue last', () => {
    const doc = board([device('a', { color: 'blue' }), device('b', { color: 'orange' }), device('w', { venue: true, color: 'blue' }), key('k1', 'blue', '自社'), key('k2', 'orange', 'レンタル')]);
    expect(deviceRows(doc, legend()).map((r) => [r.color, r.name])).toEqual([
      ['blue', '自社'],
      ['orange', 'レンタル'],
      ['venue', '会場の設備'],
    ]);
  });

  it('leaves a legend placed before it was offered as it was', () => {
    const doc = board([device('a', { color: 'blue' }), device('b', { color: 'orange' })]);
    expect(deviceRows(doc, legend({ devices: undefined }))).toEqual([]);
  });

  it('puts lines and devices side by side once the legend is wide enough, else one above the other', () => {
    const doc = board([device('a', { color: 'blue' }), device('b', { color: 'orange' })]);
    const narrow = legendLayout(doc, legend({ w: 220 }));
    expect(narrow.devices.x).toBe(narrow.lines.x);
    expect(narrow.devices.y).toBeGreaterThan(narrow.lines.y);
    const wide = legendLayout(doc, legend({ w: 420 }));
    expect(wide.devices.y).toBe(wide.lines.y);
    expect(wide.devices.x).toBeGreaterThan(wide.lines.x);
    expect(wide.h).toBeLessThan(narrow.h);
  });
});

describe('legend of lines', () => {
  it('draws each sample as its lines are drawn: radio dashed, power drawn as tags as a tag', () => {
    const doc: Doc = {
      ...blank(),
      nodes: [device('a'), device('b')],
      edges: [
        { id: 'w', from: { node: 'a' }, to: { node: 'b' }, signal: 'wireless', label: '', length: null, note: '', arrow: 'none' },
        { id: 'p', from: { node: 'a' }, to: { node: 'b' }, signal: 'power', label: '', length: null, note: '', arrow: 'none' },
        { id: 'v', from: { node: 'a' }, to: { node: 'b' }, signal: 'video', label: '', length: null, note: '', arrow: 'none' },
      ],
    };
    const rows = new Map(legendRows(doc, legend()).map((r) => [r.usual, r]));
    expect(rows.get('無線')).toMatchObject({ dashed: true, tagged: false });
    expect(rows.get('電源')).toMatchObject({ dashed: false, tagged: true });
    expect(rows.get('映像')).toMatchObject({ dashed: false, tagged: false });
  });
});
