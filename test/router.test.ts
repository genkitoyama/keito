import { describe, expect, it } from 'vitest';
import { collides, routeAround } from '../src/model/router';
import type { Rect } from '../src/model/types';

describe('the way round boxes', () => {
  it('is still found on a large board, between ends close together', () => {
    // 220 boxes, each a little off the grid as placed by hand: the whole board's grid of lines is
    // past what one search may take.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const boxes: Rect[] = [];
    for (let k = 0; k < 220; k++) boxes.push({ x: (k % 15) * 300 + Math.round(rnd() * 10) * 10, y: Math.floor(k / 15) * 200 + Math.round(rnd() * 8) * 10, w: 140, h: 66 + Math.round(rnd() * 4) * 22 });
    const a0 = boxes[0];
    const b0 = boxes[2];
    const pts = routeAround({ x: a0.x + a0.w, y: a0.y + 30, dir: 'right', rect: a0 }, { x: b0.x, y: b0.y + 30, dir: 'left', rect: b0 }, boxes, 8);
    expect(pts).not.toBeNull();
    expect(collides(pts!.slice(1, -1), boxes)).toBe(false);
  });
});

describe('lines leaving one box the same way round', () => {
  it('lie side by side, not on top of each other', async () => {
    const { routeEdges } = await import('../src/model/geometry');
    const { blank } = await import('./helpers');
    const dev = (id: string, x: number, y: number, ports: { id: string; side: 'left' | 'right' }[]) => ({ id, type: 'device' as const, x, y, w: 160, h: 0, text: id, maker: '', model: '', category: '', note: '', ports: ports.map((p) => ({ ...p, name: p.id, signal: 'video' })) });
    // Right ports to right ports, the far box lower down: both lines go out past it and back.
    const doc = {
      ...blank(),
      nodes: [dev('a', 0, 0, [{ id: 'o1', side: 'right' }, { id: 'o2', side: 'right' }]), dev('b', 400, 300, [{ id: 'r1', side: 'right' }, { id: 'r2', side: 'right' }])],
      edges: [
        { id: 'e1', from: { node: 'a', port: 'o1' }, to: { node: 'b', port: 'r1' }, signal: 'video', label: '', arrow: 'none' as const },
        { id: 'e2', from: { node: 'a', port: 'o2' }, to: { node: 'b', port: 'r2' }, signal: 'video', label: '', arrow: 'none' as const },
      ],
    };
    const r = routeEdges(doc);
    const far = (id: string) => Math.max(...r.get(id)!.map((p) => p.x));
    expect(far('e1')).not.toBe(far('e2'));
  });
});

describe('a line from a port back to the same port', () => {
  it('loops out and back, rather than being drawn with no length', async () => {
    const { routeEdges } = await import('../src/model/geometry');
    const { blank } = await import('./helpers');
    const doc = {
      ...blank(),
      nodes: [{ id: 'a', type: 'device' as const, x: 0, y: 0, w: 160, h: 0, text: 'A', maker: '', model: '', category: '', note: '', ports: [{ id: 'o', name: 'OUT', side: 'right' as const, signal: 'video' }] }],
      edges: [{ id: 'e', from: { node: 'a', port: 'o' }, to: { node: 'a', port: 'o' }, signal: 'video', label: '', arrow: 'none' as const }],
    };
    const pts = routeEdges(doc).get('e')!;
    const length = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    expect(length).toBeGreaterThan(20);
  });
});
