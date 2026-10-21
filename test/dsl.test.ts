import { describe, expect, it } from 'vitest';
import { fromYaml, toYaml } from '../src/model/dsl';
import type { DeviceNode } from '../src/model/types';
import { sample } from './helpers';

describe('YAML', () => {
  it('keeps label sizes, quantities and prices through a round trip', () => {
    const d = sample();
    const dev = d.nodes.find((n): n is DeviceNode => n.type === 'device')!;
    const edge = d.edges.find((e) => e.signal === 'video')!;
    const edited = {
      ...d,
      labelSize: 9,
      nodes: d.nodes.map((n) => (n === dev ? { ...dev, qty: 3, price: 120000 } : n)),
      edges: d.edges.map((e) => (e === edge ? { ...e, fontSize: 12 } : e)),
    };
    const back = fromYaml(toYaml(edited), edited);
    expect(back.labelSize).toBe(9);
    expect(back.nodes.find((n) => n.id === dev.id)).toMatchObject({ qty: 3, price: 120000 });
    expect(back.edges.find((e) => e.id === edge.id)?.fontSize).toBe(12);
  });

  it('gives the same YAML back for the sample board', () => {
    const d = sample();
    expect(toYaml(fromYaml(toYaml(d), d))).toBe(toYaml(d));
  });
});
