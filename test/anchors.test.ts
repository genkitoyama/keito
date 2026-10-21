import { describe, expect, it } from 'vitest';
import { fromYaml, toYaml } from '../src/model/dsl';
import { routeEdges } from '../src/model/geometry';
import type { Doc, Node } from '../src/model/types';
import { blank } from './helpers';

const rect = (id: string, x: number, y: number): Node => ({ id, type: 'shape', shape: 'rect', x, y, w: 200, h: 80, text: id, color: 'blue' }) as Node;

/** Two boxes side by side, a line from the first's right side into the second's top, at `at` along it. */
function board(at?: number): Doc {
  return {
    ...blank(),
    nodes: [rect('a', 0, 200), rect('b', 400, 0)],
    edges: [{ id: 'e', from: { node: 'a', side: 'right' }, to: { node: 'b', side: 'top', ...(at == null ? {} : { at }) }, signal: 'flow', label: '', length: null, arrow: 'end', note: '' }],
  };
}

describe('lines into any place on an edge', () => {
  it('goes into the middle of the side by default', () => {
    const pts = routeEdges(board()).get('e')!;
    expect(pts.at(-1)).toMatchObject({ x: 500, y: 0 });
  });

  it('goes in where along the side it was let go', () => {
    const pts = routeEdges(board(0.25)).get('e')!;
    expect(pts.at(-1)).toMatchObject({ x: 450, y: 0 });
    // Square into the box: the last stretch runs straight down onto the edge.
    expect(pts.at(-2)!.x).toBe(450);
  });

  it('keeps the place through YAML', () => {
    const d = board(0.25);
    const back = fromYaml(toYaml(d), d);
    expect(back.edges[0].to).toMatchObject({ side: 'top', at: 0.25 });
    expect(toYaml(d)).toContain('toAt: 0.25');
  });
});

describe('a line back into its own box', () => {
  it('loops out and back round the corner instead of vanishing', () => {
    const d: Doc = { ...blank(), nodes: [rect('a', 0, 0)], edges: [{ id: 'e', from: { node: 'a', side: 'right' }, to: { node: 'a', side: 'right' }, signal: 'flow', label: '', length: null, arrow: 'end', note: '' }] };
    const pts = routeEdges(d).get('e')!;
    expect(pts.length).toBeGreaterThan(2);
    // It leaves the right side and comes back in from above.
    expect(pts[0]).toMatchObject({ x: 200, y: 40 });
    expect(pts.at(-1)).toMatchObject({ x: 100, y: 0 });
  });
});
