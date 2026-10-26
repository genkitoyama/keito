import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromYaml } from '../src/model/dsl';
import { crossingGaps, crossings, isTagged, nodeRect, routeEdges } from '../src/model/geometry';
import { collides, routeAround } from '../src/model/router';
import { sampleBoards } from '../src/model/sample';
import { tangle, tidy } from '../src/model/tidy';
import type { Doc, Rect } from '../src/model/types';
import { blank } from './helpers';

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

describe('lines kept off the edges of boxes and areas', () => {
  // How long each line runs right along the side of a box or an area's border, closer than `near`.
  const along = (doc: Doc, near: number, kinds: string[], least = 12): string[] => {
    const routes = routeEdges(doc);
    const out: string[] = [];
    for (const e of doc.edges) {
      if (isTagged(doc, e)) continue;
      const pts = routes.get(e.id) ?? [];
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const flat = Math.abs(a.y - b.y) < 0.5;
        const [lo, hi] = flat ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        for (const n of doc.nodes) {
          if (!kinds.includes(n.type)) continue;
          const r = nodeRect(n);
          const [s0, s1] = flat ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
          if (Math.min(hi, s1) - Math.max(lo, s0) < least) continue;
          for (const side of flat ? [r.y, r.y + r.h] : [r.x, r.x + r.w]) if (Math.abs((flat ? a.y : a.x) - side) < near) out.push(`${e.id} along ${n.text}`);
        }
      }
    }
    return out;
  };
  const nested = () => fromYaml(fs.readFileSync(new URL('./fixtures/web-nested.yaml', import.meta.url), 'utf8'), blank('nested'));

  it('never runs a line down the side of a box', () => {
    for (const doc of [nested(), tidy(nested()), ...sampleBoards()]) expect(along(doc, 6, ['device', 'shape'])).toEqual([]);
  });

  it('keeps tidied lines off the borders of the areas', () => {
    // A short step beside a border may stay where moving it off would cross another line.
    expect(along(tidy(nested()), 6, ['frame'], 30)).toEqual([]);
  });
});

describe('crossings drawn without hops', () => {
  it('break the line running down where a line across crosses it', () => {
    const doc = fromYaml(
      `kind: software
devices:
  - { id: a, name: A, out: [OUT:http], pos: [0, 100] }
  - { id: b, name: B, in: [IN:http], pos: [500, 100] }
  - { id: c, name: C, out: [OUT:http], pos: [0, -60] }
  - { id: d, name: D, in: [IN:http], pos: [500, 260] }
cables:
  - { id: across, from: a.OUT, to: b.IN, type: http }
  - { id: down, from: c.OUT, to: d.IN, type: http }
`,
      blank('gaps'),
    );
    const gaps = crossingGaps(doc);
    expect(gaps.get('down')).toEqual([{ x: expect.any(Number), y: routeEdges(doc).get('across')![0].y }]);
    expect(gaps.has('across')).toBe(false);
  });
});

describe('lines close beside each other', () => {
  it('count as tangled, as lines on top of each other do', () => {
    const pair = (gap: number) =>
      fromYaml(
        `kind: software
devices:
  - { id: a, name: A, out: [P:http, Q:http], pos: [0, 0] }
  - { id: b, name: B, in: [P:http], pos: [600, 400] }
  - { id: c, name: C, in: [Q:http], pos: [600, 600] }
cables:
  - { id: p, from: a.P, to: b.P, type: http, route: [[300, 0], [300, 400]] }
  - { id: q, from: a.Q, to: c.Q, type: http, route: [[${300 + gap}, 0], [${300 + gap}, 600]] }
`,
        blank('beside'),
      );
    expect(tangle(pair(7))).toBeGreaterThan(tangle(pair(40)));
  });
});

describe('crossings drawn with hops', () => {
  it('break the line down where a crossing is too near a corner for a hop', () => {
    // The line across turns just past where the line down crosses it: no room for a hop there.
    const doc = fromYaml(
      `kind: software
hops: true
devices:
  - { id: a, name: A, out: [OUT:http], pos: [0, 100] }
  - { id: b, name: B, in: [IN:http], pos: [500, 200] }
  - { id: c, name: C, out: [OUT:http], pos: [0, -60] }
  - { id: d, name: D, in: [IN:http], pos: [500, 300] }
cables:
  - { id: across, from: a.OUT, to: b.IN, type: http, route: [[330, 137], [330, 237]] }
  - { id: down, from: c.OUT, to: d.IN, type: http, route: [[325, -23], [325, 337]] }
`,
      blank('near'),
    );
    expect(crossings(doc).get('across')?.size ?? 0).toBe(0);
    expect(crossingGaps(doc).get('down')).toHaveLength(1);
  });
});
