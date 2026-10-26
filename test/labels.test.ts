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
    expect(clashes(labelBoxes(doc))).toBeGreaterThan(0);
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
