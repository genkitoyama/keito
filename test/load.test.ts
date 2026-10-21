import { describe, expect, it } from 'vitest';
import { fromYaml, toYaml } from '../src/model/dsl';
import { routeEdges } from '../src/model/geometry';
import { BOARD_ID, readBoard } from '../src/model/load';
import type { DeviceNode } from '../src/model/types';
import { sample } from './helpers';

describe('reading a board', () => {
  it('passes a board keito wrote through unchanged', () => {
    const d = sample();
    const back = readBoard(JSON.parse(JSON.stringify(d)))!;
    expect(back.nodes.map((n) => n.id)).toEqual(d.nodes.map((n) => n.id));
    expect(back.edges).toEqual(d.edges);
  });

  it('makes a hand-written or broken board safe to draw and write', () => {
    const junk = {
      version: 1,
      id: 'junk',
      nodes: [null, 'x', { id: 'a', type: 'device', text: 'A' }, { id: 'a', type: 'shape', shape: 'rect', text: 'B', x: 'NaN' }, { id: 'c', type: 'shape', shape: 'rect', text: 'C', x: 0, y: 0, w: 100, h: 40 }],
      edges: [{ id: 'e1', from: { node: 'a' }, to: { node: 'c' } }, { id: 'e1', from: { node: 'c' }, to: { node: 'a' } }, { id: 'e3', from: { node: 'a' } }, { id: 'e4', from: { node: 'a' }, to: { node: 'gone' } }],
    };
    const d = readBoard(junk)!;
    expect(d.meta).toEqual({ title: '', project: '' });
    expect(d.nodes.map((n) => n.id)).toEqual(['a', 'a_2', 'c']);
    expect((d.nodes[0] as DeviceNode).ports).toEqual([]);
    expect(d.nodes[1].x).toBe(0);
    expect(d.edges.map((e) => e.id)).toEqual(['e1', 'e1_1']);
    // It can be routed and written as YAML without throwing.
    expect(() => routeEdges(d)).not.toThrow();
    expect(() => fromYaml(toYaml(d), d)).not.toThrow();
  });

  it('refuses what is not a board', () => {
    expect(readBoard(null)).toBeNull();
    expect(readBoard({ version: 1, nodes: [], edges: [] })).toBeNull();
    expect(readBoard({ version: 2, id: 'x', nodes: [], edges: [] })).toBeNull();
  });

  it('takes only ids a board folder can hold', () => {
    for (const ok of ['az8pg29c', 'kizai0807', 'a-b_c']) expect(BOARD_ID.test(ok)).toBe(true);
    for (const bad of ['スタジオA', 'studio.v2', 'a__b', '', 'x'.repeat(65)]) expect(BOARD_ID.test(bad)).toBe(false);
  });
});
