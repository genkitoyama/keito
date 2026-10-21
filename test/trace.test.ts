import { describe, expect, it } from 'vitest';
import type { Anchor } from '../src/model/geometry';
import { straighten, traceRoute } from '../src/model/trace';
import type { Pt } from '../src/model/types';

const box = { x: 0, y: 0, w: 1, h: 1 };
const end = (x: number, y: number, dir: Anchor['dir']): Anchor => ({ x, y, dir, rect: box });

/** A hand-drawn path: the corners given, with a little wobble in between. */
function hand(...corners: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    for (let t = 0; t < 1; t += 0.1) out.push({ x: a.x + (b.x - a.x) * t + Math.sin(t * 9) * 2, y: a.y + (b.y - a.y) * t + Math.cos(t * 7) * 2 });
  }
  return [...out, corners.at(-1)!];
}

describe('tracing a line', () => {
  it('takes the wobble out of a stroke', () => {
    expect(straighten(hand({ x: 0, y: 0 }, { x: 300, y: 0 }), 10)).toHaveLength(2);
    expect(straighten(hand({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }), 10)).toHaveLength(3);
  });

  it('leaves a straight pull to the automatic route', () => {
    expect(traceRoute(hand({ x: 0, y: 0 }, { x: 400, y: 120 }), end(0, 0, 'right'), end(400, 120, 'left'), 16)).toBeUndefined();
  });

  it('goes around the way it was traced: down, across and back up', () => {
    // From the right side of one box to the left side of another level with it, traced below both.
    const trail = hand({ x: 100, y: 50 }, { x: 140, y: 50 }, { x: 140, y: 300 }, { x: 460, y: 300 }, { x: 460, y: 50 }, { x: 500, y: 50 });
    const route = traceRoute(trail, end(100, 50, 'right'), end(500, 50, 'left'), 16)!;
    expect(route).toEqual([
      { x: 140, y: 50 },
      { x: 140, y: 300 },
      { x: 460, y: 300 },
      { x: 460, y: 50 },
    ]);
  });

  it('leaves and enters square to the ends even when the stroke set off sideways', () => {
    // The stroke goes straight down first, though the line leaves to the right.
    const trail = hand({ x: 100, y: 50 }, { x: 100, y: 250 }, { x: 400, y: 250 }, { x: 400, y: 400 });
    const route = traceRoute(trail, end(100, 50, 'right'), end(400, 400, 'top'), 16)!;
    // Out of the box a little way before turning, never along its edge.
    expect(route[0]).toEqual({ x: 120, y: 50 });
    expect(route.at(-1)!.x).toBe(400);
    // Every stretch, ends included, is horizontal or vertical.
    const pts = [{ x: 100, y: 50 }, ...route, { x: 400, y: 400 }];
    expect(pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)).toBe(true);
  });
});
