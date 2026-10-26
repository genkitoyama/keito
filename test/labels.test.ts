import { describe, expect, it } from 'vitest';
import crowded from './fixtures/crowded-labels.json';
import { isTagged, labelPoint, routeEdges } from '../src/model/geometry';
import { edgeLabel, labelFont, labelSize, placeLabels, tagFont } from '../src/model/labels';
import { fromYaml, toYaml } from '../src/model/dsl';
import { readBoard } from '../src/model/load';
import { UI_FONT } from '../src/model/text';
import type { Doc, Edge, Rect } from '../src/model/types';
import { blank } from './helpers';

const line = (p: Partial<Edge> = {}): Edge => ({ id: 'e', from: { node: 'a' }, to: { node: 'b' }, signal: 'video', label: '', length: null, arrow: 'none', note: '', ...p }) as Edge;

describe('label size', () => {
  it("takes the line's own size first, then the board's", () => {
    const d: Doc = { ...blank(), labelSize: 9 };
    expect(labelFont(d, line())).toBe(9);
    expect(labelFont(d, line({ fontSize: 12 }))).toBe(12);
    expect(labelFont(blank(), line())).toBe(10.5);
  });

  it('scales a flow line and the end tags with the board', () => {
    const d: Doc = { ...blank(), labelSize: 9 };
    expect(labelFont(d, line({ signal: 'flow' }))).toBeCloseTo((12 * 9) / 10.5);
    expect(tagFont(d, line())).toBeCloseTo((10 * 9) / 10.5);
  });
});

/** Where each label of the board is drawn. */
function labelBoxes(doc: Doc): Rect[] {
  const routes = routeEdges(doc);
  return doc.edges
    .filter((e) => !isTagged(doc, e) && edgeLabel(doc, e))
    .map((e) => {
      const size = labelSize(edgeLabel(doc, e), labelFont(doc, e), UI_FONT);
      const p = labelPoint(routes.get(e.id)!, e.labelAt ?? 0.5);
      return { x: p.x - size.w / 2, y: p.y - size.h / 2, w: size.w, h: size.h };
    });
}
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clashes = (boxes: Rect[]): number => boxes.reduce((n, a, i) => n + boxes.slice(i + 1).filter((b) => overlap(a, b)).length, 0);

describe('placing labels on tidy', () => {
  const doc = readBoard(crowded)!;

  it('moves crowded labels apart', () => {
    // Three cables side by side, each label two rows high: in the middle of their lines they overlap.
    const crowd = fromYaml(
      `devices:
  - { id: a, name: A, out: [V1:video, V2:video, V3:video], pos: [0, 0] }
  - { id: b, name: B, in: [V1:video, V2:video, V3:video], pos: [600, 0] }
cables:
  - { from: a.V1, to: b.V1, type: video, spec: 光 HDMI AOC, length: 15, stacked: true }
  - { from: a.V2, to: b.V2, type: video, spec: 光 HDMI AOC, length: 15, stacked: true }
  - { from: a.V3, to: b.V3, type: video, spec: 光 HDMI AOC, length: 15, stacked: true }
`,
      blank('crowd'),
    );
    expect(clashes(labelBoxes(crowd))).toBeGreaterThan(0);
    expect(clashes(labelBoxes(placeLabels(crowd)))).toBe(0);
    // The board of many lines fanning out keeps its labels apart too.
    expect(clashes(labelBoxes(placeLabels(doc)))).toBe(0);
  });

  it('gives the same board back when run again', () => {
    const once = placeLabels(doc);
    expect(placeLabels(once)).toBe(once);
  });
});

describe('the type and port of a protocol line', () => {
  const board = (extra = '', cable = '') =>
    fromYaml(
      `kind: software
${extra}
devices:
  - { id: web, name: Web, out: [API:http] }
  - { id: api, name: API, in: [HTTP:http] }
cables:
  - { from: web.API, to: api.HTTP, type: http, spec: 443/tcp, label: 予約${cable} }
`,
      blank('proto'),
    );

  it('are in its label unless the board leaves them out', () => {
    expect(edgeLabel(board(), board().edges[0])).toBe('HTTP 443/tcp · 予約');
    const plain = board('protocolLabels: false');
    expect(edgeLabel(plain, plain.edges[0])).toBe('予約');
  });

  it('follow the line itself before the board, and come back through YAML', () => {
    const one = board('protocolLabels: false', ', showProtocol: true');
    expect(edgeLabel(one, one.edges[0])).toBe('HTTP 443/tcp · 予約');
    const back = fromYaml(toYaml(one), blank('proto'));
    expect(back.protocolLabels).toBe(false);
    expect(back.edges[0].showProtocol).toBe(true);
    // The port stays where it is listed.
    expect(back.edges[0].spec).toBe('443/tcp');
  });
});

describe('a label and a crossing', () => {
  // A line straight across, and one stepping down across it halfway: their crossing is right where
  // the first line's label would sit.
  const board = () =>
    fromYaml(
      `kind: software
protocolLabels: false
devices:
  - { id: a, name: A, out: [OUT:http], pos: [0, 100] }
  - { id: b, name: B, in: [IN:http], pos: [500, 100] }
  - { id: c, name: C, out: [OUT:http], pos: [0, -60] }
  - { id: d, name: D, in: [IN:http], pos: [500, 260] }
cables:
  - { id: across, from: a.OUT, to: b.IN, type: http, label: とても長い横切る線のラベルです }
  - { id: down, from: c.OUT, to: d.IN, type: http }
`,
      blank('cross'),
    );

  it('is not put over the crossing, where it would hide which way the lines go', () => {
    const doc = board();
    const routes = routeEdges(doc);
    const down = routes.get('down')!;
    const x = down.find((p, i) => i > 0 && Math.abs(p.x - down[i - 1].x) < 0.5 && Math.abs(p.y - down[i - 1].y) > 1)!.x;
    const y = routes.get('across')![0].y;
    const chip = (d: Doc) => labelBoxes(d)[0];
    const covers = (r: Rect) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
    expect(covers(chip(doc))).toBe(true);
    expect(covers(chip(placeLabels(doc)))).toBe(false);
  });
});
