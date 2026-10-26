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

describe('ports in the order of what they lead to', () => {
  // A server whose first port leads to the lower of two services, its second to the upper: the two
  // lines cross between them.
  const crossed = (kind: string) =>
    fromYaml(
      `kind: ${kind}
devices:
  - { id: api, name: API, out: [A:http, B:http], pos: [0, 100] }
  - { id: up, name: 上, in: [IN:http], pos: [400, 0] }
  - { id: down, name: 下, in: [IN:http], pos: [400, 300] }
cables:
  - { from: api.A, to: down.IN, type: http }
  - { from: api.B, to: up.IN, type: http }
`,
      blank(kind),
    );
  const names = (doc: Doc) => (doc.nodes.find((n) => n.id === 'api') as { ports: { name: string }[] }).ports.map((p) => p.name);

  it('puts them so the lines no longer cross, on a software board', () => {
    const doc = crossed('software');
    const after = tidy(doc);
    expect(names(after)).toEqual(['B', 'A']);
    expect(tangle(after)).toBeLessThan(tangle(doc));
  });

  it('leaves them as they are on the back of the device, on a system board', () => {
    expect(names(tidy(crossed('system')))).toEqual(['A', 'B']);
  });
});

describe('lines on top of each other', () => {
  // The CDN's second output and the WAF's second input stand at one height, between them a narrow
  // gap; one line goes on from the first far down, the other comes up into the second.
  const board = () =>
    fromYaml(
      `kind: software
protocolLabels: false
devices:
  - { id: cdn, name: CDN, in: [IN:http], out: [動的:http, 静的:http], pos: [300, 0] }
  - { id: waf, name: WAF, in: [HTTPS:http, 管理:http], out: [OUT:http], pos: [560, 0] }
  - { id: admin, name: 管理画面, out: [HTTPS:http], pos: [0, 300] }
  - { id: s3, name: ストレージ, in: [HTTPS:http], pos: [1100, 600] }
cables:
  - { from: cdn.動的, to: waf.HTTPS, type: http }
  - { from: cdn.静的, to: s3.HTTPS, type: http }
  - { from: admin.HTTPS, to: waf.管理, type: http }
`,
      blank('top'),
    );
  /** Stretches where two lines without an end in common run within a pixel or two of each other. */
  const onTop = (doc: Doc): number => {
    const routes = routeEdges(doc);
    const ends = (id: string) => [routes.get(id)![0], routes.get(id)!.at(-1)!].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);
    const runs = doc.edges.flatMap((e) =>
      routes.get(e.id)!.slice(1).map((b, i) => ({ id: e.id, a: routes.get(e.id)![i], b })),
    );
    let n = 0;
    for (const [i, p] of runs.entries())
      for (const q of runs.slice(i + 1)) {
        if (p.id === q.id || ends(p.id).some((k) => ends(q.id).includes(k))) continue;
        const flat = (r: typeof p) => Math.abs(r.a.y - r.b.y) < 0.5;
        if (!flat(p) || !flat(q) || Math.abs(p.a.y - q.a.y) > 2) continue;
        const shared = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) - Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
        if (shared > 4) n++;
      }
    return n;
  };

  it('are laid apart, a crossing being clearer than one line hiding another', () => {
    expect(onTop(tidy(board()))).toBe(0);
  });
});

describe('a line crossing another', () => {
  // A line from below merges into one across; a websocket line from beside crosses its way up.
  const board = () =>
    fromYaml(
      `kind: software
protocolLabels: false
devices:
  - { id: browser, name: ブラウザ, out: [HTTPS:http, WSS:websocket], pos: [0, 0] }
  - { id: app, name: アプリ, out: [HTTPS:http], pos: [0, 160] }
  - { id: cdn, name: CDN, in: [HTTPS:http], pos: [330, 0] }
  - { id: lb, name: LB, in: [WSS:websocket], pos: [700, 0] }
cables:
  - { id: page, from: browser.HTTPS, to: cdn.HTTPS, type: http }
  - { id: api, from: app.HTTPS, to: cdn.HTTPS, type: http }
  - { id: ws, from: browser.WSS, to: lb.WSS, type: websocket }
`,
      blank('detour'),
    );
  const length = (pts: { x: number; y: number }[]) => pts.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

  it('keeps crossing it rather than go far out of its way round the boxes', () => {
    const before = length(routeEdges(board()).get('api')!);
    expect(length(routeEdges(tidy(board())).get('api')!)).toBeLessThanOrEqual(before + 80);
  });
});

describe('an area round a network and more', () => {
  // The cloud holds the edge and a network; the network's middle falls inside one of its own subnets.
  const board = () =>
    fromYaml(
      `kind: software
areas:
  - { name: クラウド, rect: [0, 0, 1000, 640] }
  - { name: エッジ, rect: [30, 80, 220, 200] }
  - { name: VPC, rect: [290, 50, 680, 560] }
  - { name: 公開, rect: [320, 100, 340, 470] }
  - { name: データ, rect: [690, 100, 250, 470] }
devices:
  - { id: cdn, name: CDN, area: エッジ, out: [OUT:http], pos: [60, 140] }
  - { id: lb, name: LB, area: 公開, in: [IN:http], out: [OUT:tcp], pos: [360, 160] }
  - { id: db, name: DB, area: データ, in: [IN:tcp], pos: [730, 160] }
cables:
  - { from: cdn.OUT, to: lb.IN, type: http }
  - { from: lb.OUT, to: db.IN, type: tcp }
`,
      blank('cloud'),
    );
  const holds = (o: Rect, f: Rect) => o.x <= f.x && o.y <= f.y && o.x + o.w >= f.x + f.w && o.y + o.h >= f.y + f.h;

  it('still holds the network after tidying', () => {
    const after = tidy(board());
    const frame = (name: string) => nodeRect(after.nodes.find((n) => n.type === 'frame' && n.text === name)!);
    expect(holds(frame('クラウド'), frame('VPC'))).toBe(true);
    expect(holds(frame('クラウド'), frame('エッジ'))).toBe(true);
    expect(holds(frame('VPC'), frame('公開'))).toBe(true);
  });
});
