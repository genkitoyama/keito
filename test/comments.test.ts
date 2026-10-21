import { describe, expect, it } from 'vitest';
import { pinComments, pinLabel } from '../src/model/comments';
import { seqBands } from '../src/model/sequence';
import type { Doc, SequenceNode, StickyNode } from '../src/model/types';
import { blank } from './helpers';

const SOURCE = ['participant A', 'participant B', 'A -> B: 起動', 'B --> A: OK', 'A -> B: 再生'].join('\n');
const seq = (text = SOURCE): SequenceNode => ({ id: 'seq', type: 'sequence', x: 0, y: 0, w: 0, h: 0, text });
const sticky = (y: number, x = 20): StickyNode => ({ id: 'memo', type: 'sticky', x, y, w: 120, h: 60, text: '確認', color: 'yellow' });
const board = (...nodes: Doc['nodes']): Doc => ({ ...blank(), nodes });

/** A sticky put down over the given item of the diagram, pinned as the store would pin it. */
function pinnedOver(item: number): Doc {
  const band = seqBands(seq())[item];
  return pinComments(board(seq()), board(seq(), sticky(band.y + band.h / 2 - 30)));
}
const memo = (d: Doc) => d.nodes.find((n): n is StickyNode => n.id === 'memo')!;

describe('comments pinned to a sequence', () => {
  it('pins a sticky to the item under it', () => {
    const d = pinnedOver(2);
    expect(memo(d).on).toMatchObject({ seq: 'seq', item: 2 });
    expect(pinLabel(d, memo(d))?.text).toContain('再生');
  });

  it('follows its item when a line is added above it', () => {
    const before = pinnedOver(2);
    const text = SOURCE.replace('A -> B: 起動', 'A -> B: 準備\nA -> B: 起動');
    const after = pinComments(before, { ...before, nodes: before.nodes.map((n) => (n.type === 'sequence' ? seq(text) : n)) });
    expect(memo(after).on).toMatchObject({ item: 3 });
    expect(memo(after).on?.lost).toBeFalsy();
    expect(memo(after).y).toBeGreaterThan(memo(before).y);
  });

  it('is marked lost when its item is removed', () => {
    const before = pinnedOver(2);
    const text = SOURCE.replace('\nA -> B: 再生', '');
    const after = pinComments(before, { ...before, nodes: before.nodes.map((n) => (n.type === 'sequence' ? seq(text) : n)) });
    expect(memo(after).on?.lost).toBe(true);
    expect(pinLabel(after, memo(after))?.lost).toBe(true);
  });

  it('is not pinned when put well away from the diagram', () => {
    const d = pinComments(board(seq()), board(seq(), sticky(0, 2000)));
    expect(memo(d).on).toBeUndefined();
  });
});

describe('highlighted rows', () => {
  const text = ['participant A', 'participant B', 'A -> B: 一つ目', 'B --> A: 二つ目', 'A -> B: 三つ目'].join('\n');
  // As drawn: lifelines start below the boxes (16 + 34), and each message's text is centred 10px
  // above its arrow, 11px high.
  const arrows = (step: number) => [1, 2, 3].map((row) => 50 + row * step);
  const textTop = (arrow: number) => arrow - 10 - 11 / 2;

  it("covers a message's text above its arrow, and the arrow", () => {
    const bands = seqBands(seq(text));
    arrows(42).forEach((y, i) => {
      expect(bands[i].y - bands[i].h / 2).toBeLessThanOrEqual(textTop(y));
      expect(bands[i].y + bands[i].h / 2).toBeGreaterThanOrEqual(y + 4);
    });
  });

  it("stays clear of the next row's text even when the rows are squeezed", () => {
    // Resized by hand to the smallest height: rows as close as they go (26px apart).
    const bands = seqBands({ ...seq(text), h: 1 });
    const ys = arrows(26);
    for (let i = 0; i < ys.length - 1; i++) expect(bands[i].y + bands[i].h / 2).toBeLessThan(textTop(ys[i + 1]));
  });
});
