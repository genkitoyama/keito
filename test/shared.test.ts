import { describe, expect, it } from 'vitest';
import { catalog, deviceOf, newest } from '../src/model/shared';
import type { DeviceNode, Doc } from '../src/model/types';
import { blank } from './helpers';

const device = (id: string, text: string, p: Partial<DeviceNode> = {}): DeviceNode => ({ id, type: 'device', x: 0, y: 0, w: 160, h: 0, text, maker: '', model: '', category: '', note: '', ports: [], ...p });

describe('shared things', () => {
  it('takes a host from the system board when no copy says when it changed', () => {
    const system: Doc = { ...blank('sys'), nodes: [device('pc', 'main-pc', { shared: 'k1' })] };
    const software: Doc = { ...blank('soft'), kind: 'software', nodes: [device('pc', 'old-host', { shared: 'k1' })] };
    const entries = catalog([software, system]);
    expect(newest(entries, 'k1')?.node.text).toBe('main-pc');
    expect(deviceOf(entries, 'k1')?.text).toBe('main-pc');
  });

  it('takes the newer copy when they say when they changed', () => {
    const system: Doc = { ...blank('sys'), nodes: [device('pc', 'main-pc', { shared: 'k1', sharedAt: 1 })] };
    const other: Doc = { ...blank('sys2'), nodes: [device('pc', 'renamed', { shared: 'k1', sharedAt: 2 })] };
    expect(deviceOf(catalog([system, other]), 'k1')?.text).toBe('renamed');
  });
});
