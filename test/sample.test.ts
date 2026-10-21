import { afterEach, describe, expect, it } from 'vitest';
import { checkTable, ipIssues, powerLoads } from '../src/model/lists';
import { catalog, pull } from '../src/model/shared';
import { registerSignals } from '../src/model/signals';
import type { DeviceNode, Doc } from '../src/model/types';
import { blank, sampleProject } from './helpers';

afterEach(() => registerSignals(undefined));

describe('the sample project', () => {
  const boards = () => {
    const docs = sampleProject();
    return docs.map((d) => pull(d, catalog(docs)));
  };

  it('is three boards of one project, each saying it is a sample', () => {
    const docs = boards();
    expect(docs.map((d) => d.kind ?? 'system')).toEqual(['system', 'software', 'sequence']);
    expect(new Set(docs.map((d) => d.meta.project)).size).toBe(1);
    for (const d of docs) {
      expect(d.meta.title).toMatch(/^【サンプル】/);
      expect(d.nodes.some((n) => 'text' in n && n.text.startsWith('これはサンプルです'))).toBe(true);
    }
  });

  it('passes its own checks', () => {
    for (const d of boards()) {
      registerSignals(d.signals);
      expect(checkTable(d).rows).toEqual([]);
    }
  });

  it('keeps its power within what each source gives', () => {
    const [system] = boards();
    for (const load of powerLoads(system).values()) expect(load.over).toBe(false);
  });

  it('runs its software on the PCs of its system diagram', () => {
    const [, software] = boards();
    const parts = software.nodes.filter((n): n is DeviceNode => n.type === 'device');
    expect(parts.every((p) => p.host && p.ip)).toBe(true);
  });
});

describe('addresses on a software board', () => {
  const part = (id: string, host: string, ip: string): DeviceNode => ({ id, type: 'device', x: 0, y: 0, w: 160, h: 0, text: id, maker: '', model: '', category: '', note: '', ports: [], host, ip });
  const board = (...nodes: DeviceNode[]): Doc => ({ ...blank(), kind: 'software', nodes });

  it('lets programs on one machine share its address', () => {
    expect(ipIssues(board(part('a', 'td-main', '10.0.0.5'), part('b', 'td-main', '10.0.0.5'))).size).toBe(0);
  });

  it('still flags one address on two machines', () => {
    expect(ipIssues(board(part('a', 'td-main', '10.0.0.5'), part('b', 'sensor-pc', '10.0.0.5'))).get('a')).toBe('dup');
  });
});
