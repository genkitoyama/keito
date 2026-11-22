import { describe, expect, it } from 'vitest';
import { equalGaps, spacingSnap } from '../src/model/spacing';
import type { Rect } from '../src/model/types';

const box = (x: number, y = 0, w = 100, h = 50): Rect => ({ x, y, w, h });

describe('snapping to an even spacing', () => {
  it('finds the middle between two boxes', () => {
    // 100–200 is free: a 40-wide box stands at 130 with 30 either side.
    expect(spacingSnap(box(133, 0, 40), [box(0), box(200)], 'x', 6)).toBe(-3);
  });

  it('finds the place a gap past a pair, on either side', () => {
    const pair = [box(0), box(140)]; // a gap of 40
    expect(spacingSnap(box(284), pair, 'x', 6)).toBe(-4); // 240 + 40
    expect(spacingSnap(box(-137), pair, 'x', 6)).toBe(-3); // 0 − 40 − 100
  });

  it('works down a column too', () => {
    const column = [box(0, 0), box(0, 80)]; // 50 high, a gap of 30
    expect(spacingSnap(box(0, 162), column, 'y', 6)).toBe(-2); // 130 + 30
  });

  it('leaves a box that is not near such a place', () => {
    expect(spacingSnap(box(300), [box(0), box(140)], 'x', 6)).toBeNull();
  });

  it('takes no boxes out of its row', () => {
    expect(spacingSnap(box(282), [box(0, 500), box(140, 500)], 'x', 6)).toBeNull();
  });

  it('does not land on another box', () => {
    expect(spacingSnap(box(282), [box(0), box(140), box(300)], 'x', 6)).toBeNull();
  });

  it('does not take the middle of a space too narrow for the box', () => {
    expect(spacingSnap(box(25, 0, 100), [box(0, 0, 50), box(100, 0, 50)], 'x', 40)).toBeNull();
  });

  it('takes the nearest of several places', () => {
    // Between (a gap of 80 either side of a 40-wide box) and past the pair are both within reach.
    const pair = [box(0), box(300)];
    expect(spacingSnap(box(182, 0, 40), pair, 'x', 6)).toBe(-2);
  });
});

describe('the equal gaps shown', () => {
  it('shows both gaps of a box in the middle', () => {
    expect(equalGaps(box(130, 0, 40), [box(0), box(200)], 'x')).toEqual([
      { axis: 'x', from: 100, to: 130, at: 25 },
      { axis: 'x', from: 170, to: 200, at: 25 },
    ]);
  });

  it('goes on along the row while the gap stays the same', () => {
    const row = [box(0), box(140), box(280)];
    expect(equalGaps(box(420), row, 'x').map((g) => [g.from, g.to])).toEqual([
      [380, 420],
      [240, 280],
      [100, 140],
    ]);
  });

  it('stops at the first gap that differs', () => {
    const row = [box(0), box(150), box(290)]; // 50, then 40
    expect(equalGaps(box(430), row, 'x').map((g) => g.from)).toEqual([390, 250]);
  });

  it('shows none when no two gaps are equal', () => {
    expect(equalGaps(box(130, 0, 40), [box(0), box(210)], 'x')).toEqual([]);
  });

  it('shows none while the box overlaps another', () => {
    expect(equalGaps(box(90), [box(0), box(230)], 'x')).toEqual([]);
  });

  it('does not count touching boxes as a gap', () => {
    expect(equalGaps(box(200), [box(0), box(100)], 'x')).toEqual([]);
  });

  it('does not measure across a box that stands in the gap', () => {
    // The box at 60 overlaps the one at 0: the gap from it to the dragged box is not that one's.
    expect(equalGaps(box(300), [box(0), box(60), box(200)], 'x').map((g) => g.from)).toEqual([]);
  });

  it('does not take what holds the box for a neighbour', () => {
    const note = box(-100, -100, 600, 300);
    expect(equalGaps(box(130, 0, 40), [note, box(0), box(200)], 'x').map((g) => [g.from, g.to])).toEqual([
      [100, 130],
      [170, 200],
    ]);
  });

  it('measures a column at the middle of what the two boxes share', () => {
    expect(equalGaps(box(0, 80), [box(0, 0), box(0, 160)], 'y')[0]).toEqual({ axis: 'y', from: 50, to: 80, at: 50 });
  });
});
