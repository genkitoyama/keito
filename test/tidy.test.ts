import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deviceTagRects } from '../src/model/badges';
import { frameOf, frameTitles, isTagged, labelPoint, nodeRect, routeEdges, tagChips } from '../src/model/geometry';
import { fromYaml } from '../src/model/dsl';
import { sampleBoards } from '../src/model/sample';
import { tangle, tidy } from '../src/model/tidy';
import type { Doc, Rect } from '../src/model/types';
import { blank } from './helpers';

const system = () => sampleBoards()[0];

/** The board with every device nudged up or down a little, as boxes end up after dragging by hand. */
function nudged(doc: Doc, seed: number): Doc {
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return { ...doc, nodes: doc.nodes.map((n) => (n.type === 'device' ? { ...n, y: n.y + Math.round((rand() - 0.5) * 60) } : n)), edges: doc.edges.map(({ route: _, ...e }) => e) };
}

const inside = (r: Rect, f: Rect) => r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h;

describe('tidy', () => {
  it('keeps the bends drawn by hand on lines whose ends stay put', () => {
    const doc = system();
    const drawn = doc.edges.filter((e) => e.route);
    expect(drawn.length).toBeGreaterThan(0);
    const after = tidy(doc);
    for (const e of drawn) expect(after.edges.find((x) => x.id === e.id)!.route).toEqual(e.route);
  });

  it('never leaves the wiring more tangled than it found it', () => {
    for (const doc of sampleBoards().filter((d) => d.edges.length)) {
      expect(tangle(tidy(doc))).toBeLessThanOrEqual(tangle(doc));
      for (const seed of [3, 11, 29]) {
        const messy = nudged(doc, seed);
        expect(tangle(tidy(messy))).toBeLessThanOrEqual(tangle(messy));
      }
    }
  });

  it('routes lines knocked off line by hand round the others', () => {
    const doc = system();
    for (const seed of [3, 11, 29]) expect(tangle(tidy(nudged(doc, seed)))).toBeLessThanOrEqual(tangle(doc) * 1.25);
  });

  it('lines up the labels of lines running side by side', () => {
    const after = tidy(system());
    const routes = routeEdges(after);
    // The switch's lines out to the room run side by side: their labels line up.
    const xs = after.edges.filter((e) => e.from.node === 'sw1' && !isTagged(after, e)).map((e) => Math.round(labelPoint(routes.get(e.id)!, e.labelAt ?? 0.5).x));
    const column = Math.max(...xs.map((x) => xs.filter((v) => v === x).length));
    expect(column).toBeGreaterThanOrEqual(2);
  });

  it('fits the areas round the tags hanging off what they hold', () => {
    const after = tidy(system());
    const chips = tagChips(after);
    for (const n of after.nodes) {
      if (n.type !== 'device') continue;
      const frame = frameOf(after, n);
      if (!frame) continue;
      const box = nodeRect(n);
      const near = { x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 };
      const hung = [...deviceTagRects(after, n), ...chips.filter((c) => c.x < near.x + near.w && near.x < c.x + c.w && c.y < near.y + near.h && near.y < c.y + c.h)];
      for (const r of hung) expect(inside(r, nodeRect(frame)), `${n.id} tag sticks out of ${frame.id}`).toBe(true);
    }
  });
});

describe('a floor plan laid under the drawing', () => {
  const plan = { id: 'plan', type: 'image' as const, x: -200, y: -200, w: 3000, h: 2000, text: '平面図', src: 'data:image/png;base64,', under: true };

  it('is not in the way of lines', () => {
    const doc = system();
    const under = { ...doc, nodes: [plan, ...doc.nodes] };
    expect(tangle(under)).toBe(tangle(doc));
    const r1 = routeEdges(doc);
    const r2 = routeEdges(under);
    for (const e of doc.edges) expect(r2.get(e.id)).toEqual(r1.get(e.id));
  });

  it('stays where it is, and out of every area, when the board is tidied', () => {
    const doc = system();
    const under = { ...doc, nodes: [plan, ...doc.nodes] };
    const after = tidy(under);
    expect(after.nodes.find((n) => n.id === 'plan')).toEqual(plan);
    const plain = tidy(doc);
    for (const n of plain.nodes) expect(after.nodes.find((m) => m.id === n.id)).toEqual(n);
  });
});

describe('areas within areas', () => {
  // A web system as drawn by hand: subnets inside a network, inside nothing else.
  const nested = () => fromYaml(fs.readFileSync(new URL('./fixtures/web-nested.yaml', import.meta.url), 'utf8'), blank('nested'));
  const frames = (doc: Doc) => doc.nodes.filter((n) => n.type === 'frame');

  it('fits the outer area round the areas within it, with room for its title', () => {
    const after = tidy(nested());
    const vpc = frames(after).find((f) => f.text.startsWith('AWS'))!;
    const subnets = frames(after).filter((f) => f.text.includes('サブネット'));
    expect(subnets).toHaveLength(3);
    for (const s of subnets) expect(inside({ x: s.x - 20, y: s.y - 40, w: s.w + 40, h: s.h + 60 }, nodeRect(vpc))).toBe(true);
    // Snug: no more than a margin's worth of room past the subnets on any side.
    const right = Math.max(...subnets.map((s) => s.x + s.w));
    const bottom = Math.max(...subnets.map((s) => s.y + s.h));
    expect(vpc.x + vpc.w - right).toBeLessThanOrEqual(60);
    expect(vpc.y + vpc.h - bottom).toBeLessThanOrEqual(60);
  });

  it('keeps lines off the titles of the areas', () => {
    for (const doc of [nested(), tidy(nested())]) {
      const routes = routeEdges(doc);
      for (const t of frameTitles(doc))
        for (const e of doc.edges) {
          if (isTagged(doc, e)) continue;
          const pts = routes.get(e.id)!;
          for (let i = 1; i < pts.length; i++) {
            const [a, b] = [pts[i - 1], pts[i]];
            const seg = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
            const through = seg.x < t.x + t.w && t.x < seg.x + seg.w && seg.y < t.y + t.h && t.y < seg.y + seg.h;
            expect(through, `${e.id} through a title`).toBe(false);
          }
        }
    }
  });
});
